"use strict";

// A favicon that is slow to read must not repaint a window whose active tab
// has changed meanwhile: the newer tab's colour stays.
const assert = require("node:assert/strict");

const listeners = {};
const on = (name) => ({ addListener: (listener) => { listeners[name] = listener; } });
const colours = { "slow.ico": [255, 0, 0], "fast.ico": [0, 0, 255] };
const delays = { "slow.ico": 50, "fast.ico": 0 };
const updates = [];
let activeTab = null;
let lastSource = null;

globalThis.fetch = async (url) => {
  await new Promise((resolve) => setTimeout(resolve, delays[url]));
  return { blob: async () => ({ url }) };
};
globalThis.URL = { createObjectURL: (blob) => blob.url, revokeObjectURL() {} };
globalThis.Image = class {
  set src(value) {
    lastSource = value;
    setTimeout(() => this.onload());
  }
};
globalThis.document = {
  createElement: () => ({
    getContext: () => ({
      drawImage() {},
      getImageData: () => {
        const data = new Uint8ClampedArray(32 * 32 * 4);
        for (let i = 0; i < data.length; i += 4) data.set([...colours[lastSource], 255], i);
        return { data };
      }
    })
  })
};
globalThis.browser = {
  tabs: { query: async () => [activeTab], onActivated: on("activated"), onUpdated: on("updated") },
  windows: { getAll: async () => [{ id: 1 }], onCreated: on("created"), onRemoved: on("removed") },
  permissions: { contains: async () => true, onAdded: on("added"), onRemoved: on("revoked") },
  storage: { local: { get: async () => ({ siteColorTabs: true }) }, onChanged: on("storage") },
  theme: { update: async (_windowId, theme) => { updates.push(theme.colors.tab_loading); }, reset: async () => {} }
};

const glow = require("../extension/tabglow.js");

(async () => {
  glow.start();
  await glow.onBaseTheme({ colors: { tab_loading: "#accent" } }, "dark");
  await new Promise((resolve) => setTimeout(resolve, 20));
  updates.length = 0;

  activeTab = { id: 1, windowId: 1, favIconUrl: "slow.ico" };
  listeners.activated({ windowId: 1 });
  activeTab = { id: 2, windowId: 1, favIconUrl: "fast.ico" };
  listeners.activated({ windowId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.deepEqual(updates, ["hsl(240 85% 62%)"]);
  console.log("tabglow-race.test.js: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
