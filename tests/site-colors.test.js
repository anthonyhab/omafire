// site-colors.uc.js: the favicon's dominant hue, at a lightness for the
// palette mode; the active tab's root variable follows the setting.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../chrome/scripts/site-colors.uc.js"), "utf8");

function load(on, icon) {
  const style = new Map();
  const listeners = {};
  const observers = [];
  const tab = { selected: true, linkedBrowser: { mIconURL: "https://example.org/favicon.ico" } };
  const window = {
    addEventListener() {},
    getComputedStyle: () => ({ colorScheme: "dark" }),
  };
  class Image {
    set src(url) { this.url = url; queueMicrotask(() => this.onload()); }
  }
  const document = {
    documentElement: {
      style: { setProperty: (k, v) => style.set(k, v), removeProperty: k => style.delete(k) },
    },
    createElementNS: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: icon }) }) }),
  };
  const gBrowser = {
    selectedTab: tab,
    tabContainer: { addEventListener: (type, fn) => (listeners[type] ??= []).push(fn) },
  };
  const prefs = { getBoolPref: () => on, addObserver: (_, o) => observers.push(o), removeObserver() {} };
  vm.runInNewContext(source, { window, document, gBrowser, Image, console, Services: { prefs } });
  return { api: window.OmafireSiteColors, style };
}

function pixels(list) {
  return Uint8ClampedArray.from(list.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
}

(async () => {
  const { api } = load(false, null);
  const { dominantColor } = api;

  // A mostly-orange icon with a white glyph: the glow is orange, bright for
  // a dark palette and deep for a light one.
  const orangeIcon = pixels([...Array(60).fill([255, 102, 0]), ...Array(40).fill([255, 255, 255])]);
  assert.match(dominantColor(orangeIcon, "dark"), /^hsl\((2[0-9]) \d+% 62%\)$/);
  assert.match(dominantColor(orangeIcon, "light"), /^hsl\((2[0-9]) \d+% 42%\)$/);

  // Greyscale and transparent icons have no colour to offer.
  assert.equal(dominantColor(pixels(Array(100).fill([128, 128, 128])), "dark"), null);
  assert.equal(dominantColor(pixels(Array(100).fill([255, 0, 0, 0])), "dark"), null);

  // Hue averaging is circular: reds either side of 0° average to red, not cyan.
  const red = dominantColor(pixels([...Array(50).fill([255, 0, 30]), ...Array(50).fill([255, 30, 0])]), "dark");
  assert.match(red, /^hsl\((35[0-9]|[0-9]) /);

  // On: the window root carries the colour. Off: nothing.
  const lit = load(true, orangeIcon);
  await lit.api.paint();
  assert.match(lit.style.get("--omafire-site-color"), /^hsl\(2[0-9] /);
  const dark = load(false, orangeIcon);
  await dark.api.paint();
  assert.equal(dark.style.has("--omafire-site-color"), false);

  console.log("site-colors.test.js: ok");
})().catch(e => { console.error(e); process.exit(1); });
