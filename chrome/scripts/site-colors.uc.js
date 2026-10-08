// Omafire site-coloured tabs (omafire.site-colors): the active tab's glow
// takes the colour of its page's favicon instead of the palette accent.
//
// The favicon is drawn on a chrome canvas, which any origin may be read
// from, and its saturated pixels give one hue; the lightness is fixed so
// the glow reads on the palette: bright on dark, deep on light. The colour
// is --omafire-site-color on the window's root, which tokens.css prefers
// over the accent; without the setting, or for a grey icon, it is unset.
// Loaded into each browser window by omafire.cfg.
(function () {
  "use strict";
  if (window.OmafireSiteColors) {
    return;
  }

  const PREF = "omafire.site-colors";
  const PROP = "--omafire-site-color";
  const root = document.documentElement;
  const cache = new Map();
  let painting = 0;      // the latest paint; an older one that lands late is dropped

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) {
      return [0, 0, l];
    }
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    return [h * 60, s, l];
  }

  // Weighted circular mean of the saturated, visible pixels' hue (RGBA
  // bytes), at a lightness for the palette mode; null for a grey icon.
  function dominantColor(data, mode) {
    let x = 0, y = 0, weight = 0, sat = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha < 0.5) {
        continue;
      }
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.25 || l < 0.12 || l > 0.92) {
        continue;
      }
      const w = s * alpha;
      x += Math.cos((h * Math.PI) / 180) * w;
      y += Math.sin((h * Math.PI) / 180) * w;
      sat += s * w;
      weight += w;
    }
    if (weight < 4) {
      return null;
    }
    const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const s = Math.min(0.85, Math.max(0.45, sat / weight));
    const l = mode === "light" ? 0.42 : 0.62;
    return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  function iconPixels(url) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = canvas.height = 32;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, 32, 32);
          resolve(context.getImageData(0, 0, 32, 32).data);
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  const mode = () =>
    window.getComputedStyle(root).colorScheme.includes("light") ? "light" : "dark";

  async function paint() {
    const run = ++painting;
    // The page's own icon URL: the tab's image attribute is a
    // moz-remote-image: URL, which only the tab itself can draw.
    const url = Services.prefs.getBoolPref(PREF, false)
      ? gBrowser.selectedTab?.linkedBrowser?.mIconURL
      : null;
    let color = null;
    if (url) {
      const key = `${mode()} ${url}`;
      if (!cache.has(key)) {
        const data = await iconPixels(url);
        cache.set(key, data && dominantColor(data, mode()));
      }
      color = cache.get(key);
    }
    // The window moved on while the icon loaded: that paint owns the glow.
    if (run !== painting) {
      return;
    }
    if (color) {
      root.style.setProperty(PROP, color);
    } else {
      root.style.removeProperty(PROP);
    }
  }

  const repaint = () => void paint().catch(e => console.error("[omafire:site-colors]", e));
  const onAttr = e => {
    if (e.target.selected && e.detail.changed.includes("image")) {
      repaint();
    }
  };
  gBrowser.tabContainer.addEventListener("TabSelect", repaint);
  gBrowser.tabContainer.addEventListener("TabAttrModified", onAttr);
  const observer = {observe: repaint};
  Services.prefs.addObserver(PREF, observer);
  window.addEventListener("unload", () => {
    Services.prefs.removeObserver(PREF, observer);
  }, {once: true});
  repaint();

  window.OmafireSiteColors = {dominantColor, paint};
})();
