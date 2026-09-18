"use strict";

const assert = require("node:assert/strict");
const manifest = require("../extension/manifest.json");
const nativeManifest = require("../packaging/org.omarchy.omafox.json");
const themeApi = require("../extension/theme.js");
const featuresApi = require("../extension/features.js");

const memory = {};
const themeUpdates = [];
const nativeSent = [];
let startupListener;
let nativeHostName;
let nativeMessageListener;
let nativeDisconnectListener;
let runtimeMessageListener;
let alarmListener;
let menuClickListener;
let menuShownListener;
const discardedTabs = [];
let fakeTabs = [];

const nativePort = {
  error: null,
  postMessage(message) {
    nativeSent.push(message);
  },
  onMessage: {
    addListener(listener) {
      nativeMessageListener = listener;
    }
  },
  onDisconnect: {
    addListener(listener) {
      nativeDisconnectListener = listener;
    }
  }
};

function keysFromRequest(keys) {
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys || memory);
}

global.browser = {
  theme: {
    async update(theme) {
      themeUpdates.push(theme);
    }
  },
  storage: {
    local: {
      async get(keys) {
        return Object.fromEntries(
          keysFromRequest(keys)
            .filter((key) => Object.hasOwn(memory, key))
            .map((key) => [key, memory[key]])
        );
      },
      async set(values) {
        Object.assign(memory, values);
      },
      async remove(keys) {
        for (const key of keysFromRequest(keys)) delete memory[key];
      }
    }
  },
  runtime: {
    connectNative(name) {
      nativeHostName = name;
      return nativePort;
    },
    onMessage: {
      addListener(listener) {
        runtimeMessageListener = listener;
      }
    },
    onStartup: {
      addListener(listener) {
        startupListener = listener;
      }
    },
    onInstalled: {
      addListener() {}
    }
  },
  alarms: {
    create(name, info) {
      this.created = { name, info };
    },
    onAlarm: {
      addListener(listener) {
        alarmListener = listener;
      }
    }
  },
  tabs: {
    async query(queryInfo) {
      return fakeTabs.filter((tab) =>
        Object.entries(queryInfo).every(
          ([key, value]) => tab[key] === value
        )
      );
    },
    async discard(id) {
      discardedTabs.push(id);
      const tab = fakeTabs.find((t) => t.id === id);
      if (tab) tab.discarded = true;
      return tab;
    }
  },
  contextMenus: {
    created: [],
    refreshed: 0,
    onClicked: {
      addListener(listener) {
        menuClickListener = listener;
      }
    },
    onShown: {
      addListener(listener) {
        menuShownListener = listener;
      }
    },
    create(spec) {
      this.created.push(spec);
    },
    async remove(id) {
      this.created = this.created.filter((item) => item.id !== id);
    },
    async refresh() {
      this.refreshed += 1;
    }
  },
  windows: {
    created: [],
    async getCurrent() {
      return { left: 100, top: 100 };
    },
    async create(spec) {
      this.created.push(spec);
      return { id: 9000 + this.created.length };
    }
  }
};

require("../extension/background.js");

function waitFor(predicate, message) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 1000;
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error(message));
      setTimeout(check, 5);
    };
    check();
  });
}

(async () => {
  assert.deepEqual(manifest.permissions, [
    "alarms",
    "contextMenus",
    "nativeMessaging",
    "storage",
    "tabs",
    "theme"
  ]);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);
  assert.equal(nativeHostName, nativeManifest.name);
  assert.ok(
    nativeManifest.allowed_extensions.includes(
      manifest.browser_specific_settings.gecko.id
    )
  );
  assert.equal(typeof nativeMessageListener, "function");
  assert.equal(typeof nativeDisconnectListener, "function");

  const palette = Object.fromEntries(
    themeApi.PALETTE_KEYS.map((key) => [key, key === "mode" ? "light" : "#123456"])
  );
  const message = {
    protocol: themeApi.PROTOCOL,
    version: themeApi.SCHEMA_VERSION,
    action: themeApi.ACTION,
    theme: "test-light",
    palette
  };

  nativeMessageListener(message);
  await waitFor(
    () => memory.storedTheme?.themeName === "test-light",
    "native theme update was not applied"
  );
  assert.equal(memory.storedTheme.palette.mode, "light");
  assert.equal(themeUpdates.at(-1).properties.color_scheme, "light");
  assert.equal(memory.lastError, undefined);

  const nativePalette = Object.fromEntries(
    themeApi.PALETTE_KEYS.map((key) => [key, key === "mode" ? "dark" : "#654321"])
  );
  const nativeMessage = {
    protocol: themeApi.PROTOCOL,
    version: themeApi.SCHEMA_VERSION,
    action: themeApi.ACTION,
    theme: "native-dark",
    palette: nativePalette
  };
  nativeMessageListener(nativeMessage);
  await waitFor(
    () => memory.storedTheme?.themeName === "native-dark",
    "native theme update was not applied"
  );
  assert.equal(themeUpdates.at(-1).properties.color_scheme, "dark");
  assert.equal(memory.nativeStatus.connected, true);

  const updatesBeforeRestart = themeUpdates.length;
  await startupListener();
  assert.equal(themeUpdates.length, updatesBeforeRestart + 1);
  assert.equal(themeUpdates.at(-1).colors.frame, "#654321");

  const originalConsoleError = console.error;
  console.error = () => {};
  nativeMessageListener({
    protocol: themeApi.PROTOCOL,
    version: themeApi.SCHEMA_VERSION,
    action: themeApi.ACTION,
    theme: "broken",
    palette: {}
  });
  await waitFor(() => memory.lastError, "invalid native update was not rejected");
  console.error = originalConsoleError;
  assert.match(memory.lastError.message, /mode/);
  assert.equal(memory.storedTheme.themeName, "native-dark");

  // features-set from the popup merges into storage and relays to the host;
  // ids outside the registry and non-boolean values are dropped.
  await runtimeMessageListener({
    type: "features-set",
    features: { debug: true, "not-a-feature": true, "urlbar-actions": "yes" }
  });
  assert.deepEqual(memory.features, { debug: true });
  assert.deepEqual(nativeSent.at(-1), {
    action: "features-set",
    features: { debug: true }
  });
  assert.deepEqual(featuresApi.normalizeFeatures({ debug: "1" }), {});

  // Range features accept finite numbers, clamp to their bounds, and reject
  // non-numeric input.
  assert.deepEqual(featuresApi.normalizeFeatures({ transparency: 0.7 }), {
    transparency: 0.7
  });
  assert.deepEqual(featuresApi.normalizeFeatures({ transparency: 9 }), {
    transparency: 1
  });
  assert.deepEqual(featuresApi.normalizeFeatures({ transparency: 0 }), {
    transparency: 0.55
  });
  assert.deepEqual(featuresApi.normalizeFeatures({ transparency: "x" }), {});
  assert.deepEqual(featuresApi.normalizeFeatures({ translucency: true }), {
    translucency: true
  });
  assert.deepEqual(featuresApi.normalizeFeatures({ translucency: 1 }), {});
  // Translucent pages is a plain boolean feature dependent on translucency.
  assert.deepEqual(featuresApi.normalizeFeatures({ "content-glass": true }), {
    "content-glass": true
  });
  assert.deepEqual(featuresApi.normalizeFeatures({ "content-glass": 1 }), {});
  // Idle timeout is a minutes-range feature dependent on tab-unload.
  assert.deepEqual(featuresApi.normalizeFeatures({ "unload-minutes": 45 }), {
    "unload-minutes": 45
  });
  assert.deepEqual(featuresApi.normalizeFeatures({ "unload-minutes": 999 }), {
    "unload-minutes": 120
  });
  assert.deepEqual(featuresApi.normalizeFeatures({ "tab-unload": true }), {
    "tab-unload": true
  });

  // Auto-unload: only background tabs past the idle cutoff are discarded;
  // active, pinned, audible, already-discarded, no-discard and mid-load
  // tabs are all left alone.
  const hour = 60 * 60 * 1000;
  const idle = Date.now() - hour;
  fakeTabs = [
    { id: 1, lastAccessed: idle, status: "complete", active: false, pinned: false, audible: false, discarded: false, autoDiscardable: true },
    { id: 2, lastAccessed: Date.now(), status: "complete", active: false, pinned: false, audible: false, discarded: false, autoDiscardable: true },
    { id: 3, lastAccessed: idle, status: "loading", active: false, pinned: false, audible: false, discarded: false, autoDiscardable: true },
    { id: 4, lastAccessed: idle, status: "complete", active: false, pinned: true, audible: false, discarded: false, autoDiscardable: true },
    { id: 5, lastAccessed: idle, status: "complete", active: false, pinned: false, audible: true, discarded: false, autoDiscardable: true },
    { id: 6, lastAccessed: idle, status: "complete", active: true, pinned: false, audible: false, discarded: false, autoDiscardable: true },
    { id: 7, lastAccessed: idle, status: "complete", active: false, pinned: false, audible: false, discarded: false, autoDiscardable: false },
    { id: 8, lastAccessed: idle, status: "complete", active: false, pinned: false, audible: false, discarded: true, autoDiscardable: true }
  ];
  discardedTabs.length = 0;
  memory.features = { "tab-unload": true, "unload-minutes": 5 };
  assert.equal(typeof alarmListener, "function");
  alarmListener({ name: "omarchy-tab-unload" });
  await waitFor(() => discardedTabs.length > 0, "idle tab was never discarded");
  assert.deepEqual(discardedTabs, [1]);

  // Feature off → the sweep is a no-op even with ancient tabs.
  discardedTabs.length = 0;
  memory.features = { "tab-unload": false, "unload-minutes": 5 };
  alarmListener({ name: "omarchy-tab-unload" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(discardedTabs, []);

  // Glance: enabling the feature installs a link-context menu entry whose
  // click opens a floating popup window; disabling removes the entry.
  memory.features = { glance: true };
  await runtimeMessageListener({
    type: "features-set",
    features: { glance: true }
  });
  await waitFor(
    () => browser.contextMenus.created.some((m) => m.id === "omarchy-glance"),
    "glance menu entry was not created"
  );
  menuClickListener({ menuItemId: "omarchy-glance", linkUrl: "https://a.b/c" });
  await waitFor(
    () => browser.windows.created.length > 0,
    "glance window was not opened"
  );
  assert.equal(browser.windows.created[0].url, "https://a.b/c");
  assert.equal(browser.windows.created[0].type, "popup");
  await runtimeMessageListener({
    type: "features-set",
    features: { glance: false }
  });
  await waitFor(
    () => !browser.contextMenus.created.some((m) => m.id === "omarchy-glance"),
    "glance menu entry was not removed"
  );

  // MV3 wake reconcile: an event-page suspension drops dynamically created
  // menu items, so onShown must recreate the entry and refresh while the
  // menu is already open.
  memory.features = { glance: true };
  browser.contextMenus.created = [];
  await menuShownListener({ contexts: ["link"], linkUrl: "https://a.b/" });
  assert.ok(
    browser.contextMenus.created.some((m) => m.id === "omarchy-glance"),
    "onShown did not recreate the glance entry"
  );
  assert.ok(
    browser.contextMenus.refreshed > 0,
    "onShown did not refresh the open menu"
  );

  // Non-link contexts must not trigger the reconcile.
  const createdBefore = browser.contextMenus.created.length;
  await menuShownListener({ contexts: ["page"] });
  assert.equal(browser.contextMenus.created.length, createdBefore);

  memory.features = { glance: false };
  await menuShownListener({ contexts: ["link"], linkUrl: "https://a.b/" });
  assert.ok(
    !browser.contextMenus.created.some((m) => m.id === "omarchy-glance"),
    "onShown did not remove the glance entry when disabled"
  );

  memory.features = { debug: true };
  fakeTabs = [];

  // A numeric feature relays through the same merge + host path.
  await runtimeMessageListener({
    type: "features-set",
    features: { transparency: 0.9 }
  });
  assert.deepEqual(memory.features, { debug: true, transparency: 0.9 });
  assert.deepEqual(nativeSent.at(-1), {
    action: "features-set",
    features: { debug: true, transparency: 0.9 }
  });

  // A features-ack is control traffic, not a theme payload.
  const updatesBeforeAck = themeUpdates.length;
  nativeMessageListener({ type: "features-ack", ok: true, applied: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(themeUpdates.length, updatesBeforeAck);

  // Reconnecting the host re-pushes the stored toggle state.
  nativeSent.length = 0;
  nativeDisconnectListener();
  await startupListener();
  await waitFor(
    () => nativeSent.length > 0,
    "stored features were not re-pushed on reconnect"
  );
  assert.deepEqual(nativeSent.at(-1), {
    action: "features-set",
    features: { debug: true, transparency: 0.9 }
  });

  console.log("background.test.js: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
