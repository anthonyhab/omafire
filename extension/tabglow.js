"use strict";

/* Site-coloured active tab.
 *
 * The theme draws the active tab's glow from the lightweight theme's
 * tab_loading color (--tab-loading-fill). By default that is the palette
 * accent. With the optional <all_urls> host permission (granted from the
 * popup), each window's theme is re-applied with tab_loading set to the
 * dominant colour of its active tab's favicon, so the glow follows the
 * page. Host access is what lets the favicon be read without tainting the
 * canvas; nothing else is read from pages. */
(function (root) {
  const ENABLED_KEY = "siteColorTabs";
  const ORIGINS = { origins: ["<all_urls>"] };
  const cache = new Map();
  let baseTheme = null;
  let mode = "dark";
  let enabled = false;
  const applied = new Map();

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  /* Weighted circular mean of the saturated, visible pixels' hue, then
   * a lightness that reads on the palette: bright on dark, deep on light. */
  function dominantColor(data) {
    let x = 0, y = 0, weight = 0, sat = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha < 0.5) continue;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.25 || l < 0.12 || l > 0.92) continue;
      const w = s * alpha;
      x += Math.cos((h * Math.PI) / 180) * w;
      y += Math.sin((h * Math.PI) / 180) * w;
      sat += s * w;
      weight += w;
    }
    if (weight < 4) return null;
    const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const s = Math.min(0.85, Math.max(0.45, sat / weight));
    const l = mode === "light" ? 0.42 : 0.62;
    return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  async function faviconColor(url) {
    if (!url) return null;
    if (cache.has(url)) return cache.get(url);
    let color = null;
    try {
      const blob = await (await fetch(url)).blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = objectUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, 32, 32);
        color = dominantColor(context.getImageData(0, 0, 32, 32).data);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      color = null;
    }
    cache.set(url, color);
    return color;
  }

  function withGlow(color) {
    return { ...baseTheme, colors: { ...baseTheme.colors, tab_loading: color } };
  }

  async function paintWindow(windowId) {
    if (!baseTheme || !enabled) return;
    const [tab] = await browser.tabs.query({ active: true, windowId });
    /* No active tab yet (a window mid-creation, or a theme re-apply racing
     * a tab switch): leave the window as it is rather than flash the
     * accent over the page's colour. */
    if (!tab) return;
    const color = (await faviconColor(tab.favIconUrl)) || baseTheme.colors.tab_loading;
    if (applied.get(windowId) === color) return;
    applied.set(windowId, color);
    await browser.theme.update(windowId, withGlow(color));
  }

  async function paintAll() {
    const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    await Promise.all(windows.map((w) => paintWindow(w.id).catch(() => {})));
  }

  /* Permission and storage events can arrive back to back (a toggle
   * removes, then re-adds); re-check strictly in order. */
  let refreshQueue = Promise.resolve();
  function refreshEnabled() {
    refreshQueue = refreshQueue.then(checkEnabled, checkEnabled);
    return refreshQueue;
  }

  async function checkEnabled() {
    const stored = (await browser.storage.local.get(ENABLED_KEY))[ENABLED_KEY] === true;
    const granted = await browser.permissions.contains(ORIGINS);
    const next = stored && granted;
    if (next === enabled) return;
    enabled = next;
    applied.clear();
    if (enabled) {
      await paintAll();
    } else if (baseTheme) {
      /* Drop the per-window overrides: back to the global theme. */
      const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
      await Promise.all(windows.map((w) => browser.theme.reset(w.id).catch(() => {})));
    }
  }

  const api = {
    ENABLED_KEY,
    ORIGINS,
    dominantColor,
    /* Called whenever the global theme is (re)applied. */
    async onBaseTheme(theme, paletteMode) {
      baseTheme = theme;
      mode = paletteMode || "dark";
      applied.clear();
      if (enabled) await paintAll();
    },
    start() {
      browser.tabs.onActivated.addListener(({ windowId }) => void paintWindow(windowId).catch(() => {}));
      browser.tabs.onUpdated.addListener((tabId, change, tab) => {
        if (tab.active && ("favIconUrl" in change || change.status === "complete")) {
          void paintWindow(tab.windowId).catch(() => {});
        }
      });
      browser.windows.onCreated.addListener((w) => void paintWindow(w.id).catch(() => {}));
      browser.windows.onRemoved.addListener((id) => applied.delete(id));
      browser.permissions.onAdded.addListener(() => void refreshEnabled());
      browser.permissions.onRemoved.addListener(() => void refreshEnabled());
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && ENABLED_KEY in changes) void refreshEnabled();
      });
      void refreshEnabled();
    }
  };

  root.OmafoxTabGlow = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
