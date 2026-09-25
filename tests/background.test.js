"use strict";

const assert = require("node:assert/strict");
const manifest = require("../extension/manifest.json");
const nativeManifest = require("../packaging/org.omarchy.omafox.json");
const themeApi = require("../extension/theme.js");

const memory = {};
const themeUpdates = [];
const nativeSent = [];
let startupListener;
let nativeHostName;
let nativeMessageListener;
let nativeDisconnectListener;
let runtimeMessageListener;
let connectCount = 0;

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
      connectCount += 1;
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
  // Theme sync is the extension's only job; the permission set says so.
  assert.deepEqual(manifest.permissions, ["nativeMessaging", "storage", "theme"]);
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "156.0");
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

  // A real MV3 wake is a fresh JS context: re-require the module so the
  // in-memory dedup signature resets exactly like it does in Firefox. The
  // persistent storage mock keeps the stored theme across the boundary.
  const updatesBeforeRestart = themeUpdates.length;
  delete require.cache[require.resolve("../extension/background.js")];
  require("../extension/background.js");
  await waitFor(
    () => themeUpdates.length === updatesBeforeRestart + 1,
    "stored theme was not re-applied on restart"
  );
  assert.equal(themeUpdates.at(-1).colors.frame, "#654321");

  // Within one context, a same-payload resend (the host re-pushes
  // theme.json on every connect) must not trigger a second restyle.
  const updatesBeforeResend = themeUpdates.length;
  nativeMessageListener(nativeMessage);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(themeUpdates.length, updatesBeforeResend);

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

  // The popup's Clear resets the tinted action icon through the runtime.
  assert.equal(typeof runtimeMessageListener, "function");
  assert.equal(runtimeMessageListener({ type: "unknown" }), undefined);

  // A dropped host connection is re-established on the next lifecycle
  // event instead of leaving the extension deaf to theme changes.
  const connectsBefore = connectCount;
  nativeDisconnectListener();
  await startupListener();
  assert.equal(connectCount, connectsBefore + 1);
  assert.equal(memory.nativeStatus.connected, true);

  console.log("background.test.js: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
