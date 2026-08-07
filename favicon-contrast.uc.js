/*
 * Favicon contrast helper
 *
 * Loaded only when the Firefox autoconfig bridge is installed. It samples
 * favicon pixels once, caches them by SHA-256, and chooses the least
 * destructive filter that reaches the practical favicon contrast threshold
 * tab background. No polling is used.
 */
(() => {

    if (window.__faviconContrastController) {
        return;
    }

    const HTML_NS = "http://www.w3.org/1999/xhtml";
    const SAMPLE_SIZE = 32;
    // Favicons are tiny branded graphics, not body text. A pragmatic average
    // threshold avoids destroying orange Hacker News or Firefox's colorful
    // default icon while still catching nearly invisible white-on-light icons.
    const CONTRAST_TARGET = 2.25;
    const CACHE_VERSION = "v4";
    const MAX_SOURCE_CACHE = 96;
    const MAX_DECISION_CACHE = 256;

    const sourceCache = new Map();
    const decisionCache = new Map();
    const tabRuns = new WeakMap();
    const pendingTabs = new Set();
    let pendingTimer = null;
    let destroyed = false;

    const lruGet = (cache, key) => {
        if (!cache.has(key)) {
            return undefined;
        }
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return value;
    };

    const lruSet = (cache, key, value, limit) => {
        cache.delete(key);
        cache.set(key, value);
        while (cache.size > limit) {
            cache.delete(cache.keys().next().value);
        }
    };

    const report = error => {
        try {
            Components.utils.reportError(`[favicon-contrast] ${error}`);
        } catch (_) {
            // Error reporting must never affect favicon rendering.
        }
    };

    const toLinear = value => {
        value /= 255;
        return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
    };

    const relativeLuminance = (r, g, b) =>
        0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

    const contrastRatio = (first, second) => {
        const lighter = Math.max(first, second);
        const darker = Math.min(first, second);
        return (lighter + 0.05) / (darker + 0.05);
    };

    const parseCssColor = value => {
        if (!value || value === "transparent") {
            return null;
        }

        const hex = value
            .trim()
            .match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
        if (hex) {
            const digits = hex[1].length;
            let expanded = hex[1];
            if (digits <= 4) {
                expanded = expanded.split("").map(digit => digit + digit).join("");
            }
            const hasAlpha = expanded.length === 8;
            const color = {
                r: Number.parseInt(expanded.slice(0, 2), 16),
                g: Number.parseInt(expanded.slice(2, 4), 16),
                b: Number.parseInt(expanded.slice(4, 6), 16),
                a: hasAlpha ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
            };
            return color.a === 0 ? null : color;
        }

        const modern = value.trim().match(
            /^color\(\s*srgb\s+([^\s]+)\s+([^\s]+)\s+([^\s/]+)(?:\s*\/\s*([^\s]+))?\s*\)$/i,
        );
        if (modern) {
            const component = part => {
                const number = Number.parseFloat(part);
                if (!Number.isFinite(number)) {
                    return 0;
                }
                const scaled = part.endsWith("%") ? number * 2.55 : number * 255;
                return Math.max(0, Math.min(255, scaled));
            };
            let alpha = 1;
            if (modern[4] !== undefined) {
                alpha = Number.parseFloat(modern[4]);
                if (modern[4].endsWith("%")) {
                    alpha /= 100;
                }
                alpha = Math.max(0, Math.min(1, alpha));
            }
            const color = {
                r: component(modern[1]),
                g: component(modern[2]),
                b: component(modern[3]),
                a: Number.isFinite(alpha) ? alpha : 1,
            };
            return color.a === 0 ? null : color;
        }

        const match = value.match(/rgba?\(([^)]+)\)/i);
        if (!match) {
            return null;
        }

        const parts = match[1]
            .replace(/\//g, " ")
            .replace(/,/g, " ")
            .trim()
            .split(/\s+/);

        if (parts.length < 3) {
            return null;
        }

        const channel = part => {
            const number = Number.parseFloat(part);
            if (!Number.isFinite(number)) {
                return 0;
            }
            const scaled = part.endsWith("%") ? number * 2.55 : number;
            return Math.max(0, Math.min(255, scaled));
        };

        let alpha = 1;
        if (parts[3] !== undefined) {
            alpha = Number.parseFloat(parts[3]);
            if (parts[3].endsWith("%")) {
                alpha /= 100;
            }
            alpha = Math.max(0, Math.min(1, alpha));
        }

        const color = {
            r: channel(parts[0]),
            g: channel(parts[1]),
            b: channel(parts[2]),
            a: Number.isFinite(alpha) ? alpha : 1,
        };
        return color.a === 0 ? null : color;
    };

    const composite = (foreground, background) => ({
        r: foreground.r * foreground.a + background.r * (1 - foreground.a),
        g: foreground.g * foreground.a + background.g * (1 - foreground.a),
        b: foreground.b * foreground.a + background.b * (1 - foreground.a),
        a: 1,
    });

    const tabBackground = tab => {
        const rootStyle = getComputedStyle(document.documentElement);
        const toolbar = document.getElementById("TabsToolbar");
        const fallback = [
            parseCssColor(rootStyle.getPropertyValue("--lwt-accent-color")),
            parseCssColor(rootStyle.getPropertyValue("--toolbar-bgcolor")),
            parseCssColor(toolbar && getComputedStyle(toolbar).backgroundColor),
        ].find(Boolean) || { r: 128, g: 128, b: 128, a: 1 };

        const tabBackgroundNode = tab.querySelector(".tab-background");
        const foreground = tabBackgroundNode
            ? parseCssColor(getComputedStyle(tabBackgroundNode).backgroundColor)
            : null;
        const color = foreground ? composite(foreground, fallback) : fallback;

        // Quantization prevents animated/theme-generated subpixel colors from
        // growing the decision cache without affecting the result materially.
        const quantize = channel => Math.round(channel / 4) * 4;
        return {
            color,
            key: `${quantize(color.r)},${quantize(color.g)},${quantize(color.b)}`,
        };
    };

    const sha256 = async bytes => {
        if (window.crypto?.subtle) {
            const digest = await window.crypto.subtle.digest("SHA-256", bytes);
            return Array.from(new Uint8Array(digest), byte =>
                byte.toString(16).padStart(2, "0"),
            ).join("");
        }

        // Firefox has WebCrypto, but retain a deterministic fallback for
        // unusual hardened profiles where it has been disabled.
        let hash = 2166136261;
        for (const byte of bytes) {
            hash ^= byte;
            hash = Math.imul(hash, 16777619);
        }
        return `fnv-${(hash >>> 0).toString(16)}`;
    };

    const iconSource = tab => {
        const icon = tab.querySelector(".tab-icon-image");
        const source = tab.getAttribute("image") || icon?.getAttribute("src");
        if (!source || source === "none") {
            return null;
        }

        // Reuse the already-loaded element where Firefox exposes an HTML img.
        if (
            icon?.namespaceURI === HTML_NS &&
            typeof icon.naturalWidth === "number" &&
            icon.complete &&
            icon.naturalWidth > 0
        ) {
            return { key: source, image: icon };
        }

        return { key: source, image: null };
    };

    const loadImage = source =>
        new Promise((resolve, reject) => {
            const image = document.createElementNS(HTML_NS, "img");
            let settled = false;

            const finish = (callback, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                image.onload = null;
                image.onerror = null;
                callback(value);
            };

            image.onload = () => finish(resolve, image);
            image.onerror = () => finish(reject, new Error(`Unable to load ${source}`));
            image.decoding = "async";
            image.src = source;

            if (image.complete) {
                if (image.naturalWidth > 0) {
                    finish(resolve, image);
                } else {
                    finish(reject, new Error(`Empty favicon ${source}`));
                }
            }
        });

    const readIcon = async (tab, source) => {
        const cached = lruGet(sourceCache, source.key);
        if (cached) {
            return cached;
        }

        const promise = (async () => {
            const image = source.image || (await loadImage(source.key));
            const width = image.naturalWidth || image.width || 16;
            const height = image.naturalHeight || image.height || 16;
            const scale = Math.min(SAMPLE_SIZE / width, SAMPLE_SIZE / height);
            const drawWidth = Math.max(1, Math.round(width * scale));
            const drawHeight = Math.max(1, Math.round(height * scale));
            const canvas = document.createElementNS(HTML_NS, "canvas");
            canvas.width = SAMPLE_SIZE;
            canvas.height = SAMPLE_SIZE;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
            context.drawImage(
                image,
                Math.round((SAMPLE_SIZE - drawWidth) / 2),
                Math.round((SAMPLE_SIZE - drawHeight) / 2),
                drawWidth,
                drawHeight,
            );

            const imageData = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
            const bytes = new Uint8Array(imageData.data.buffer);
            const hash = await sha256(bytes);
            const pixelCount = SAMPLE_SIZE * SAMPLE_SIZE;
            const red = new Uint8Array(pixelCount);
            const green = new Uint8Array(pixelCount);
            const blue = new Uint8Array(pixelCount);
            const alphas = new Float32Array(pixelCount);

            for (let index = 0, offset = 0; index < pixelCount; index++, offset += 4) {
                red[index] = imageData.data[offset];
                green[index] = imageData.data[offset + 1];
                blue[index] = imageData.data[offset + 2];
                alphas[index] = imageData.data[offset + 3] / 255;
            }

            return { hash, red, green, blue, alphas };
        })();

        lruSet(sourceCache, source.key, promise, MAX_SOURCE_CACHE);
        promise.catch(() => {
            if (sourceCache.get(source.key) === promise) {
                sourceCache.delete(source.key);
            }
        });
        return promise;
    };

    const hueRotateColor = (red, green, blue) => {
        // This is the SVG color-matrix used by CSS hue-rotate(), rather than
        // an HSL approximation. Keeping the scorer and the rendered filter
        // identical prevents false-positive contrast decisions.
        const angle = Math.PI;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const r = red / 255;
        const g = green / 255;
        const b = blue / 255;
        const rotatedRed = Math.max(
            0,
            Math.min(
                1,
                (0.213 + 0.787 * cosine - 0.213 * sine) * r +
                    (0.715 - 0.715 * cosine - 0.715 * sine) * g +
                    (0.072 - 0.072 * cosine + 0.928 * sine) * b,
            ),
        );
        const rotatedGreen = Math.max(
            0,
            Math.min(
                1,
                (0.213 - 0.213 * cosine + 0.143 * sine) * r +
                    (0.715 + 0.285 * cosine + 0.140 * sine) * g +
                    (0.072 - 0.072 * cosine - 0.283 * sine) * b,
            ),
        );
        const rotatedBlue = Math.max(
            0,
            Math.min(
                1,
                (0.213 - 0.213 * cosine - 0.787 * sine) * r +
                    (0.715 - 0.715 * cosine + 0.715 * sine) * g +
                    (0.072 + 0.928 * cosine + 0.072 * sine) * b,
            ),
        );
        return {
            r: rotatedRed * 255,
            g: rotatedGreen * 255,
            b: rotatedBlue * 255,
        };
    };

    const transformedColor = (icon, index, mode) => {
        if (mode === "dark") {
            return { r: 0, g: 0, b: 0 };
        }
        if (mode === "light") {
            return { r: 255, g: 255, b: 255 };
        }
        if (mode === "invert") {
            return {
                r: 255 - icon.red[index],
                g: 255 - icon.green[index],
                b: 255 - icon.blue[index],
            };
        }
        if (mode === "hue") {
            return hueRotateColor(
                icon.red[index],
                icon.green[index],
                icon.blue[index],
            );
        }
        return {
            r: icon.red[index],
            g: icon.green[index],
            b: icon.blue[index],
        };
    };

    const score = (icon, background, mode) => {
        const backgroundLuminance = relativeLuminance(
            background.r,
            background.g,
            background.b,
        );
        let visible = 0;
        let poor = 0;
        let weightedContrast = 0;

        for (let index = 0; index < icon.alphas.length; index++) {
            const alpha = icon.alphas[index];
            if (alpha < 0.06) {
                continue;
            }

            const transformed = transformedColor(icon, index, mode);
            const composited = {
                r: transformed.r * alpha + background.r * (1 - alpha),
                g: transformed.g * alpha + background.g * (1 - alpha),
                b: transformed.b * alpha + background.b * (1 - alpha),
            };
            const contrast = contrastRatio(
                relativeLuminance(composited.r, composited.g, composited.b),
                backgroundLuminance,
            );
            visible += alpha;
            poor += contrast < CONTRAST_TARGET ? alpha : 0;
            weightedContrast += Math.min(contrast, 10) * alpha;
        }

        if (!visible) {
            return { badFraction: 0, average: 10 };
        }

        return {
            badFraction: poor / visible,
            average: weightedContrast / visible,
        };
    };

    const scoreValue = result =>
        (1 - result.badFraction) * 10 + Math.min(result.average, 10);

    const chooseFilter = (icon, background) => {
        const backgroundKey = [background.r, background.g, background.b]
            .map(channel => Math.round(channel / 4) * 4)
            .join(",");
        const cacheKey = `${CACHE_VERSION}|${icon.hash}|${backgroundKey}`;
        const cached = lruGet(decisionCache, cacheKey);
        if (cached) {
            return cached;
        }

        const candidates = [
            { name: "original", result: score(icon, background, "original") },
            { name: "invert", result: score(icon, background, "invert") },
            { name: "hue", result: score(icon, background, "hue") },
            { name: "dark", result: score(icon, background, "dark") },
            { name: "light", result: score(icon, background, "light") },
        ];
        const isLegible = candidate =>
            candidate.result.average >= CONTRAST_TARGET &&
            candidate.result.badFraction <= 0.35;
        const colorfulCandidates = candidates.slice(1, 3).filter(isLegible);
        const monochromeCandidates = candidates.slice(3).filter(isLegible);
        const original = candidates[0];
        let choice = original;

        if (!isLegible(original)) {
            // Preserve color whenever inversion or hue rotation can solve the
            // problem. Only flatten to black/white as a last resort.
            let eligible = colorfulCandidates;
            if (!eligible.length) {
                eligible = monochromeCandidates;
            }
            if (!eligible.length) {
                eligible = candidates.slice(1);
            }
            choice = eligible.sort(
                (first, second) => scoreValue(second.result) - scoreValue(first.result),
            )[0];
        }

        lruSet(decisionCache, cacheKey, choice.name, MAX_DECISION_CACHE);
        return choice.name;
    };

    const setDecision = (tab, decision) => {
        if (decision === "original") {
            tab.removeAttribute("data-favicon-contrast");
        } else if (tab.getAttribute("data-favicon-contrast") !== decision) {
            tab.setAttribute("data-favicon-contrast", decision);
        }
    };

    const processTab = async tab => {
        if (destroyed || !tab?.isConnected) {
            return;
        }

        const run = (tabRuns.get(tab) || 0) + 1;
        tabRuns.set(tab, run);
        const source = iconSource(tab);
        if (!source) {
            tab.removeAttribute("data-favicon-contrast");
            return;
        }

        // Avoid a flash of the optional symbolic-icon filter while sampling.
        setDecision(tab, "original");
        const background = tabBackground(tab);
        const expectedKey = `${source.key}|${background.key}`;

        try {
            const icon = await readIcon(tab, source);
            if (
                !icon ||
                destroyed ||
                !tab.isConnected ||
                tabRuns.get(tab) !== run
            ) {
                return;
            }

            const currentSource = iconSource(tab);
            const currentBackground = tabBackground(tab);
            if (
                !currentSource ||
                currentSource.key !== source.key ||
                `${currentSource.key}|${currentBackground.key}` !== expectedKey
            ) {
                scheduleTab(tab);
                return;
            }

            setDecision(tab, chooseFilter(icon, background.color));
        } catch (error) {
            // Failure is fail-open: retain the original favicon and never
            // let an older asynchronous load overwrite a newer decision.
            if (tabRuns.get(tab) === run && !destroyed && tab.isConnected) {
                setDecision(tab, "original");
            }
            report(error);
        }
    };

    const flush = () => {
        pendingTimer = null;
        const tabs = [...pendingTabs];
        pendingTabs.clear();
        for (const tab of tabs) {
            processTab(tab);
        }
    };

    const scheduleTab = tab => {
        if (destroyed || !tab) {
            return;
        }
        pendingTabs.add(tab);
        if (pendingTimer === null) {
            pendingTimer = window.setTimeout(flush, 80);
        }
    };

    const scheduleAll = () => {
        for (const tab of gBrowser.tabs) {
            scheduleTab(tab);
        }
    };

    const style = document.createElementNS(HTML_NS, "style");
    style.id = "favicon-contrast-runtime-style";
    style.textContent = `
        tab[data-favicon-contrast="dark"] .tab-icon-image {
            filter: brightness(0) saturate(100%) !important;
        }
        tab[data-favicon-contrast="invert"] .tab-icon-image {
            filter: invert(1) !important;
        }
        tab[data-favicon-contrast="hue"] .tab-icon-image {
            filter: hue-rotate(180deg) !important;
        }
        tab[data-favicon-contrast="light"] .tab-icon-image {
            filter: brightness(0) saturate(100%) invert(1) !important;
        }
    `;
    document.documentElement.appendChild(style);

    // Session restore can retain custom tab attributes from an older script
    // version. Remove them before the first fresh classification.
    for (const tab of gBrowser.tabs) {
        tab.removeAttribute("data-favicon-contrast");
    }

    const tabContainer = gBrowser.tabContainer;
    const onTabEvent = event => {
        if (event.type === "TabAttrModified") {
            if (!event.detail?.changed?.includes("image")) {
                return;
            }
            const source = iconSource(event.target);
            if (source) {
                // The image URL can be reused for new pixels (notably blob and
                // extension resources), so an image mutation invalidates it.
                sourceCache.delete(source.key);
            }
        }
        scheduleTab(event.target);
    };
    const onThemeMutation = () => scheduleAll();

    tabContainer.addEventListener("TabOpen", onTabEvent);
    tabContainer.addEventListener("TabSelect", onTabEvent);
    tabContainer.addEventListener("TabAttrModified", onTabEvent);

    const themeObserver = new MutationObserver(onThemeMutation);
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lwtheme", "lwtheme-brighttext", "style"],
    });

    const toolbar = document.getElementById("TabsToolbar");
    const toolbarObserver = toolbar && new MutationObserver(onThemeMutation);
    toolbarObserver?.observe(toolbar, { attributes: true });

    const cleanup = () => {
        destroyed = true;
        themeObserver.disconnect();
        toolbarObserver?.disconnect();
        tabContainer.removeEventListener("TabOpen", onTabEvent);
        tabContainer.removeEventListener("TabSelect", onTabEvent);
        tabContainer.removeEventListener("TabAttrModified", onTabEvent);
        if (pendingTimer !== null) {
            window.clearTimeout(pendingTimer);
        }
        style.remove();
        for (const tab of gBrowser.tabs) {
            tab.removeAttribute("data-favicon-contrast");
        }
        delete window.__faviconContrastController;
    };

    window.addEventListener("unload", cleanup, { once: true });
    window.__faviconContrastController = {
        cleanup,
        clearCache: () => {
            sourceCache.clear();
            decisionCache.clear();
            for (const tab of gBrowser.tabs) {
                tab.removeAttribute("data-favicon-contrast");
            }
            scheduleAll();
        },
        sourceCache,
        decisionCache,
    };
    scheduleAll();
})();
