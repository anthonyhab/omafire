/*
 * Favicon contrast helper
 *
 * Loaded only when the Firefox autoconfig bridge is installed. It samples
 * favicon pixels once, caches them by SHA-256, renders each candidate
 * treatment into a simulated composited map, and scores edge-pair contrast
 * (silhouette + internal detail + treatment-created edges) to pick the
 * least destructive treatment that keeps the icon readable on the tab
 * background. No polling is used.
 */
(() => {

    if (window.__faviconContrastController) {
        return;
    }

    const HTML_NS = "http://www.w3.org/1999/xhtml";
    const SAMPLE_SIZE = 32;
    const CACHE_VERSION = "v6";
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

    // The scorer calls relativeLuminance per pixel per candidate; a byte LUT
    // keeps that cheap. Composited channels land within a quarter step.
    const LINEAR_LUT = new Float32Array(256 * 4);
    for (let index = 0; index < LINEAR_LUT.length; index++) {
        LINEAR_LUT[index] = toLinear(index / 4);
    }

    const relativeLuminance = (r, g, b) =>
        0.2126 * LINEAR_LUT[Math.min(1023, Math.round(r * 4))] +
        0.7152 * LINEAR_LUT[Math.min(1023, Math.round(g * 4))] +
        0.0722 * LINEAR_LUT[Math.min(1023, Math.round(b * 4))];

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

    /*
     * Legibility model
     *
     * A favicon reads when its edges survive: the silhouette boundary against
     * the tab surface, and the internal detail edges that carry the glyph.
     * Pixel-vs-background averaging misses both — a white glyph on a light
     * tab has no internal edges at all, yet still disappears.
     *
     * Each candidate treatment is therefore *rendered* into a simulated
     * composited map (icon over optional halo ring or plate over the tab
     * background) and scored on adjacent pixel-pair luminance contrast:
     *
     * - silhouette pairs: an opaque pixel next to a clear one. These carry
     *   the outline; under a plate they measure icon-vs-plate, which is the
     *   separation the plate actually provides.
     * - info pairs: opaque neighbors whose original luminance differs. These
     *   carry glyphs and shading; flattening modes lose them and score
     *   accordingly.
     * - created pairs: edges the treatment itself paints (halo rim). They
     *   count, but with reduced weight.
     * - rim pairs: canvas-border pixels vs the background, catching
     *   full-bleed icons that have no silhouette pairs at all.
     */
    const PIXELS = SAMPLE_SIZE * SAMPLE_SIZE;
    const PAIR_TARGET = 1.9;
    const AVG_TARGET = 2.0;
    const BAD_MAX = 0.16;
    const DETAIL_MAX = 0.35;
    const EDGE_WEIGHT = 1.6;
    const CREATED_WEIGHT = 0.45;
    // An interior edge counts as legible content at a modest contrast —
    // glyphs inside a tile read at lower ratios than silhouette-vs-bg.
    const INTERNAL_FLOOR = 1.2;
    // Interior channel legibility bar and the minimum edge weight that
    // qualifies as real content (keeps speckle noise from passing).
    const INTERNAL_AVG = 1.5;
    const INTERIOR_MIN = 15;
    // Preservation is judged in contrast-ratio terms: a brightness scale
    // compresses absolute luminance diffs far more (gamma) than the edge
    // it leaves behind. Flattening still collapses the ratio to 1.
    const PRESERVE_MIN = 0.35;
    // Minimum fallback-value gain a treatment must show before it may
    // replace an illegible-but-best-left-alone original.
    const TREAT_MARGIN = 1.5;

    const PAIR_I = new Int16Array(SAMPLE_SIZE * (SAMPLE_SIZE - 1) * 2);
    const PAIR_J = new Int16Array(SAMPLE_SIZE * (SAMPLE_SIZE - 1) * 2);
    const RIM = new Int16Array(SAMPLE_SIZE * 4 - 4);
    for (let y = 0, pair = 0, rim = 0; y < SAMPLE_SIZE; y++) {
        for (let x = 0; x < SAMPLE_SIZE; x++) {
            const index = y * SAMPLE_SIZE + x;
            if (x + 1 < SAMPLE_SIZE) {
                PAIR_I[pair] = index;
                PAIR_J[pair] = index + 1;
                pair++;
            }
            if (y + 1 < SAMPLE_SIZE) {
                PAIR_I[pair] = index;
                PAIR_J[pair] = index + SAMPLE_SIZE;
                pair++;
            }
            if (
                x === 0 ||
                y === 0 ||
                x === SAMPLE_SIZE - 1 ||
                y === SAMPLE_SIZE - 1
            ) {
                RIM[rim++] = index;
            }
        }
    }
    const PAIR_COUNT = PAIR_I.length;

    const hueRotateColor = (red, green, blue, out, offset) => {
        // This is the SVG color-matrix used by CSS hue-rotate(), rather than
        // an HSL approximation. Keeping the scorer and the rendered filter
        // identical prevents false-positive contrast decisions.
        const r = red / 255;
        const g = green / 255;
        const b = blue / 255;
        out[offset] =
            Math.max(0, Math.min(1, -0.574 * r + 1.43 * g + 0.144 * b)) * 255;
        out[offset + 1] =
            Math.max(0, Math.min(1, 0.426 * r + 0.43 * g + 0.144 * b)) * 255;
        out[offset + 2] =
            Math.max(0, Math.min(1, 0.426 * r + 1.43 * g - 0.856 * b)) * 255;
    };

    const NEAR_BLACK = [15, 15, 19];
    const NEAR_WHITE = [250, 250, 252];
    const MODES = {
        "halo-d": { kind: "halo", color: NEAR_BLACK },
        "halo-l": { kind: "halo", color: NEAR_WHITE },
        "plate-d": { kind: "plate", color: NEAR_BLACK },
        "plate-l": { kind: "plate", color: NEAR_WHITE },
    };

    // Least-destructive-first preference. Sparse glyph icons read best after
    // a recolor; opaque tile icons keep their pixels when a halo or plate can
    // supply the missing boundary instead.
    const GLYPH_ORDER = [
        "original",
        "huefix",
        "dim",
        "lift",
        "halo-l",
        "halo-d",
        "plate-l",
        "plate-d",
        "invert",
        "hue",
        "light",
        "dark",
    ];
    const TILE_ORDER = [
        "original",
        "halo-l",
        "halo-d",
        "plate-l",
        "plate-d",
        "huefix",
        "dim",
        "lift",
        "invert",
        "hue",
        "light",
        "dark",
    ];

    const analyzeIcon = icon => {
        // pairKind: 1 = silhouette (opaque beside clear), 2 = interior pair
        // (both pixels covered — its luminance edge, if any, is measured
        // against the original render at score time), 0 = dead pair.
        const pairKind = new Uint8Array(PAIR_COUNT);
        const pairWeight = new Float32Array(PAIR_COUNT);
        const ring = new Float32Array(PIXELS);
        let opaque = 0;

        for (let index = 0; index < PIXELS; index++) {
            opaque += icon.alphas[index];
        }

        for (let pair = 0; pair < PAIR_COUNT; pair++) {
            const first = PAIR_I[pair];
            const second = PAIR_J[pair];
            const alphaMin = Math.min(icon.alphas[first], icon.alphas[second]);
            const alphaMax = Math.max(icon.alphas[first], icon.alphas[second]);
            if (alphaMin < 0.15 && alphaMax - alphaMin > 0.25) {
                pairKind[pair] = 1;
                pairWeight[pair] = (alphaMax - alphaMin) * EDGE_WEIGHT;
            } else if (alphaMin >= 0.15) {
                pairKind[pair] = 2;
            }
        }

        // 3x3 max-alpha dilation approximates the drop-shadow blur closely
        // enough to score halo treatments against what Firefox paints.
        for (let y = 0; y < SAMPLE_SIZE; y++) {
            for (let x = 0; x < SAMPLE_SIZE; x++) {
                const index = y * SAMPLE_SIZE + x;
                let strongest = icon.alphas[index];
                for (let dy = -1; dy <= 1; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= SAMPLE_SIZE) {
                        continue;
                    }
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= SAMPLE_SIZE) {
                            continue;
                        }
                        const alpha = icon.alphas[ny * SAMPLE_SIZE + nx];
                        if (alpha > strongest) {
                            strongest = alpha;
                        }
                    }
                }
                ring[index] = strongest;
            }
        }

        return { pairKind, pairWeight, ring, opaqueShare: opaque / PIXELS };
    };

    // Render a candidate straight into per-pixel composited luminance,
    // exactly as the tab strip would paint it, plus the "ground" the icon's
    // silhouette fades into locally (tab surface, halo ring, or plate).
    // Single pass, no pixel temporaries.
    const treatedLuminance = (icon, analysis, background, mode, scratch) => {
        const lum = new Float32Array(PIXELS);
        const ground = new Float32Array(PIXELS);
        const definition = MODES[mode];
        const br = background.r;
        const bg = background.g;
        const bb = background.b;
        const backgroundLuminance = relativeLuminance(br, bg, bb);

        if (definition?.kind === "halo") {
            const [hr, hg, hb] = definition.color;
            const solid = new Float32Array(PIXELS);
            for (let index = 0; index < PIXELS; index++) {
                const alpha = icon.alphas[index];
                const ring = analysis.ring[index];
                const halo = ring * (1 - alpha);
                const clear = (1 - alpha) * (1 - ring);
                lum[index] = relativeLuminance(
                    icon.red[index] * alpha + hr * halo + br * clear,
                    icon.green[index] * alpha + hg * halo + bg * clear,
                    icon.blue[index] * alpha + hb * halo + bb * clear,
                );
                solid[index] = relativeLuminance(
                    icon.red[index],
                    icon.green[index],
                    icon.blue[index],
                );
                ground[index] = relativeLuminance(
                    hr * ring + br * (1 - ring),
                    hg * ring + bg * (1 - ring),
                    hb * ring + bb * (1 - ring),
                );
            }
            // The halo leaves the icon untouched, so its silhouette weight
            // is the icon's own color against the ring it sits on.
            return { lum, solid, ground };
        }

        if (definition?.kind === "plate") {
            const [pr, pg, pb] = definition.color;
            const plateLuminance = relativeLuminance(pr, pg, pb);
            ground.fill(plateLuminance);
            for (let index = 0; index < PIXELS; index++) {
                const clear = 1 - icon.alphas[index];
                lum[index] = relativeLuminance(
                    icon.red[index] + (pr - icon.red[index]) * clear,
                    icon.green[index] + (pg - icon.green[index]) * clear,
                    icon.blue[index] + (pb - icon.blue[index]) * clear,
                );
            }
            return { lum, solid: lum, ground };
        }

        const solid = new Float32Array(PIXELS);
        ground.fill(backgroundLuminance);

        for (let index = 0; index < PIXELS; index++) {
            let r = icon.red[index];
            let g = icon.green[index];
            let b = icon.blue[index];
            switch (mode) {
                case "invert":
                    r = 255 - r;
                    g = 255 - g;
                    b = 255 - b;
                    break;
                case "hue":
                    hueRotateColor(r, g, b, scratch, 0);
                    r = scratch[0];
                    g = scratch[1];
                    b = scratch[2];
                    break;
                case "huefix":
                    // invert(1) hue-rotate(180deg): flips lightness while
                    // preserving the brand hue — the clean fix for
                    // white-on-transparent icons.
                    hueRotateColor(255 - r, 255 - g, 255 - b, scratch, 0);
                    r = scratch[0];
                    g = scratch[1];
                    b = scratch[2];
                    break;
                case "dim":
                    r *= 0.55;
                    g *= 0.55;
                    b *= 0.55;
                    break;
                case "lift":
                    r = Math.min(255, r * 1.9);
                    g = Math.min(255, g * 1.9);
                    b = Math.min(255, b * 1.9);
                    break;
                case "dark":
                    r = g = b = 0;
                    break;
                case "light":
                    r = g = b = 255;
                    break;
            }
            const clear = 1 - icon.alphas[index];
            lum[index] = relativeLuminance(
                r + (br - r) * clear,
                g + (bg - g) * clear,
                b + (bb - b) * clear,
            );
            solid[index] = relativeLuminance(r, g, b);
        }
        return { lum, solid, ground };
    };

    const score = (icon, analysis, background, mode, rendered, originalLuminance) => {
        const definition = MODES[mode];
        const mapLuminance = rendered.lum;
        // The covered side of a silhouette pair is judged by the treated
        // color it carries (unblended) — the pair weight already discounts
        // for coverage, so soft antialias ramps aren't double-penalized.
        const solid = rendered.solid;
        const ground = rendered.ground;
        const backgroundLuminance = relativeLuminance(
            background.r,
            background.g,
            background.b,
        );

        // A halo or plate whose added surface blends into the tab is a
        // no-op: it cannot create a boundary, so it cannot rescue a
        // failing icon (and must not win the fallback either).
        if (definition) {
            const surfaceLuminance = relativeLuminance(
                definition.color[0],
                definition.color[1],
                definition.color[2],
            );
            if (
                contrastRatio(surfaceLuminance, backgroundLuminance) <
                PAIR_TARGET
            ) {
                return {
                    badFraction: 1,
                    average: 1,
                    detailLoss: 1,
                    boundaryBad: 1,
                    boundaryAvg: 0,
                    boundaryWeight: 0,
                    interiorBad: 1,
                    interiorAvg: 0,
                    interiorWeight: 0,
                };
            }
        }

        // Legibility is judged on two independent channels: the icon's
        // boundary against the surface (silhouette, created, and rim
        // edges) and its interior content edges. Either one can carry an
        // icon — a glyph needs its outline, a full-bleed tile reads
        // through whatever it paints inside.
        let boundaryTotal = 0;
        let boundaryPoor = 0;
        let boundaryWeighted = 0;
        let interiorTotal = 0;
        let interiorPoor = 0;
        let interiorWeighted = 0;
        let infoPoor = 0;
        const accumulate = (channel, weight, contrast, bad) => {
            if (channel === 0) {
                boundaryTotal += weight;
                boundaryWeighted += Math.min(contrast, 12) * weight;
                boundaryPoor += bad ? weight : 0;
            } else {
                interiorTotal += weight;
                interiorWeighted += Math.min(contrast, 12) * weight;
                interiorPoor += bad ? weight : 0;
            }
        };

        for (let pair = 0; pair < PAIR_COUNT; pair++) {
            const first = PAIR_I[pair];
            const second = PAIR_J[pair];
            const kind = analysis.pairKind[pair];

            if (kind === 1) {
                // Silhouette edge: the covered side against the ground the
                // clear side fades into — tab surface, halo ring, or plate.
                const strong =
                    icon.alphas[first] >= icon.alphas[second]
                        ? first
                        : second;
                const weak = strong === first ? second : first;
                const contrast = contrastRatio(
                    solid[strong],
                    ground[weak],
                );
                accumulate(
                    0,
                    analysis.pairWeight[pair],
                    contrast,
                    contrast < PAIR_TARGET,
                );
            } else if (kind === 2) {
                const original = Math.abs(
                    originalLuminance[first] - originalLuminance[second],
                );
                if (original <= 0.012) {
                    continue;
                }
                const alphaMin = Math.min(
                    icon.alphas[first],
                    icon.alphas[second],
                );
                // Interior edges are the icon's content. They count toward
                // legibility — a tile icon reads through its internal
                // structure even when its rim blends into the surface —
                // and toward detailLoss, which keeps flattening modes
                // honest: a silhouette-only recolor erases them.
                const weight =
                    Math.min(alphaMin, 1) * Math.min(original * 10, 3);
                const treated = contrastRatio(
                    mapLuminance[first],
                    mapLuminance[second],
                );
                const originalContrast = contrastRatio(
                    originalLuminance[first],
                    originalLuminance[second],
                );
                if (
                    treated <
                    Math.max(1.12, originalContrast * PRESERVE_MIN)
                ) {
                    infoPoor += weight;
                }
                accumulate(1, weight, treated, treated < INTERNAL_FLOOR);
            } else if (definition?.kind === "halo") {
                // Only a halo adds coverage, so only it can paint an edge
                // where the original had none — the ring's own boundary.
                const difference = Math.abs(
                    mapLuminance[first] - mapLuminance[second],
                );
                if (difference < 0.02) {
                    continue;
                }
                const strong =
                    analysis.ring[first] >= analysis.ring[second]
                        ? first
                        : second;
                const weak = strong === first ? second : first;
                const created = contrastRatio(
                    mapLuminance[strong],
                    ground[weak],
                );
                accumulate(
                    0,
                    Math.min(1, difference * 6) * CREATED_WEIGHT,
                    created,
                    created < PAIR_TARGET,
                );
            }
        }

        // Icons that bleed to the frame edge have no silhouette pairs; their
        // only boundary is the canvas rim against the tab surface. Under a
        // plate the rim is always painted, so it always counts.
        for (let index = 0; index < RIM.length; index++) {
            const pixel = RIM[index];
            const alpha = icon.alphas[pixel];
            const weight =
                definition?.kind === "plate"
                    ? 0.35
                    : alpha * 1.3 +
                      (definition?.kind === "halo"
                          ? analysis.ring[pixel] * (1 - alpha) * 0.5
                          : 0);
            if (weight < 0.01) {
                continue;
            }
            // Under a halo the rim shows ring coverage, so judge the
            // rendered pixel; everything else judges the treated color.
            const edge =
                definition?.kind === "halo"
                    ? mapLuminance[pixel]
                    : solid[pixel];
            accumulate(
                0,
                weight,
                contrastRatio(edge, backgroundLuminance),
                contrastRatio(edge, backgroundLuminance) < PAIR_TARGET,
            );
        }

        const total = boundaryTotal + interiorTotal;
        if (!total) {
            return { badFraction: 0, average: 12, detailLoss: 0 };
        }
        return {
            badFraction: (boundaryPoor + interiorPoor) / total,
            average: (boundaryWeighted + interiorWeighted) / total,
            detailLoss: interiorTotal ? infoPoor / interiorTotal : 0,
            boundaryBad: boundaryTotal ? boundaryPoor / boundaryTotal : 1,
            boundaryAvg: boundaryTotal ? boundaryWeighted / boundaryTotal : 0,
            boundaryWeight: boundaryTotal,
            interiorBad: interiorTotal ? interiorPoor / interiorTotal : 1,
            interiorAvg: interiorTotal ? interiorWeighted / interiorTotal : 0,
            interiorWeight: interiorTotal,
        };
    };

    const evaluate = (icon, background, all = false) => {
        const analysis =
            icon.analysis || (icon.analysis = analyzeIcon(icon));
        // A fully transparent icon has nothing to make visible — and a
        // plate would paint a phantom tile where the tab shows nothing.
        if (!analysis.opaqueShare) {
            return { choice: "original", results: {} };
        }
        const order =
            analysis.opaqueShare < 0.55 ? GLYPH_ORDER : TILE_ORDER;
        const scratch = new Float32Array(3);
        const originalLuminance = treatedLuminance(
            icon,
            analysis,
            background,
            "original",
            scratch,
        ).lum;
        const results = {};
        let fallback = null;
        let choice = null;

        for (const mode of order) {
            const rendered = treatedLuminance(
                icon,
                analysis,
                background,
                mode,
                scratch,
            );
            const result = score(
                icon,
                analysis,
                background,
                mode,
                rendered,
                originalLuminance,
            );
            result.mode = mode;
            // Either channel can carry the icon: a readable boundary
            // (glyph on transparency) or readable content (a tile that
            // paints its own contrast). The detail gate still applies —
            // a mode can't be legible by erasing what was there.
            const boundaryOK =
                result.boundaryWeight > 0 &&
                result.boundaryBad <= BAD_MAX &&
                result.boundaryAvg >= AVG_TARGET;
            const interiorOK =
                result.interiorWeight >= INTERIOR_MIN &&
                result.interiorBad <= BAD_MAX &&
                result.interiorAvg >= INTERNAL_AVG;
            result.legible =
                (boundaryOK || interiorOK) &&
                result.detailLoss <= DETAIL_MAX;
            // Fallback ordering for the case where nothing is legible:
            // channel averages are capped at their legibility bars —
            // contrast beyond them doesn't read any better, so
            // silhouette-only recolors can't win on raw strength while
            // erasing the icon's detail.
            const boundaryValue =
                result.boundaryWeight > 0
                    ? (1 - result.boundaryBad) * 10 +
                      Math.min(result.boundaryAvg, AVG_TARGET)
                    : -Infinity;
            const interiorValue =
                result.interiorWeight >= INTERIOR_MIN
                    ? (1 - result.interiorBad) * 10 +
                      Math.min(result.interiorAvg, INTERNAL_AVG)
                    : -Infinity;
            result.value =
                Math.max(boundaryValue, interiorValue) -
                result.detailLoss * 10;
            results[mode] = result;
            if (mode !== "original" && (!fallback || result.value > fallback.value)) {
                fallback = result;
            }
            if (!choice && result.legible) {
                choice = mode;
                if (!all) {
                    return { choice, results };
                }
            }
        }
        // Nothing passed the legibility gate. Only treat the icon if the
        // best candidate is clearly better than leaving it alone — a
        // no-op hue shift or a slightly-less-bad render isn't worth
        // touching the icon over.
        const improves =
            fallback &&
            fallback.value > results.original.value + TREAT_MARGIN;
        return { choice: choice || (improves ? fallback.mode : "original"), results };
    };

    const chooseFilter = (icon, background) => {
        const backgroundKey = [background.r, background.g, background.b]
            .map(channel => Math.round(channel / 4) * 4)
            .join(",");
        const cacheKey = `${CACHE_VERSION}|${icon.hash}|${backgroundKey}`;
        const cached = lruGet(decisionCache, cacheKey);
        if (cached) {
            return cached;
        }

        const choice = evaluate(icon, background).choice;
        lruSet(decisionCache, cacheKey, choice, MAX_DECISION_CACHE);
        return choice;
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
        tab[data-favicon-contrast="huefix"] .tab-icon-image {
            filter: invert(1) hue-rotate(180deg) !important;
        }
        tab[data-favicon-contrast="dim"] .tab-icon-image {
            filter: brightness(0.55) !important;
        }
        tab[data-favicon-contrast="lift"] .tab-icon-image {
            filter: brightness(1.9) !important;
        }
        tab[data-favicon-contrast="light"] .tab-icon-image {
            filter: brightness(0) saturate(100%) invert(1) !important;
        }
        tab[data-favicon-contrast="halo-d"] .tab-icon-image {
            filter: drop-shadow(0 0 0.9px rgb(15 15 19 / 0.9)) !important;
        }
        tab[data-favicon-contrast="halo-l"] .tab-icon-image {
            filter: drop-shadow(0 0 0.9px rgb(250 250 252 / 0.9)) !important;
        }
        tab[data-favicon-contrast="plate-d"] .tab-icon-image {
            background: rgb(15 15 19) !important;
            border-radius: 3.5px !important;
        }
        tab[data-favicon-contrast="plate-l"] .tab-icon-image {
            background: rgb(250 250 252) !important;
            border-radius: 3.5px !important;
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
