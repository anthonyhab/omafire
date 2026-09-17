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
  assert.deepEqual(manifest.permissions, ["nativeMessaging", "storage", "theme"]);
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
