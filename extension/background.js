"use strict";

(function startOmafox() {
  const STORAGE_KEY = "storedTheme";
  const ERROR_KEY = "lastError";
  const NATIVE_STATUS_KEY = "nativeStatus";
  const NATIVE_HOST = "org.omarchy.omafox";
  const { parseThemeMessage, toFirefoxTheme } = globalThis.OmafoxTheme;
  const { STORAGE_KEY: FEATURES_KEY, normalizeFeatures } =
    globalThis.OmafoxFeatures;
  let updateQueue = Promise.resolve();
  let nativePort = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;

  function errorRecord(error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      occurredAt: new Date().toISOString()
    };
  }

  async function tintActionIcon(theme) {
    if (typeof document === "undefined" || typeof Image === "undefined") return;
    const color = theme.colors.icons;
    const iconUrl = browser.runtime.getURL("icons/omarchy.svg");
    const source = await (await fetch(iconUrl)).text();
    const tinted = source
      .replace('fill="context-fill"', `fill="${color}"`)
      .replace('fill-opacity="context-fill-opacity"', 'fill-opacity="1"');
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not rasterize the Omarchy icon"));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}`;
    });
    const imageData = {};
    for (const size of [16, 32]) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, size, size);
      imageData[size] = context.getImageData(0, 0, size, size);
    }
    await browser.action.setIcon({ imageData });
  }

  async function resetActionIcon() {
    try {
      await browser.action.setIcon({
        path: browser.runtime.getManifest().action.default_icon
      });
    } catch (error) {
      console.error("Omafox could not restore its toolbar icon", error);
    }
  }

  async function applyRecord(record) {
    const theme = toFirefoxTheme(record);
    await browser.theme.update(theme);
    try {
      await tintActionIcon(theme);
    } catch (error) {
      console.error("Omafox could not tint its toolbar icon", error);
    }
  }

  async function restoreStoredTheme() {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        await applyRecord(result[STORAGE_KEY]);
      }
    } catch (error) {
      await browser.storage.local.set({ [ERROR_KEY]: errorRecord(error) });
      console.error("Omafox could not restore its stored theme", error);
    }
  }

  async function receiveThemeMessage(message) {
    try {
      const record = parseThemeMessage(message);
      await applyRecord(record);
      await browser.storage.local.set({ [STORAGE_KEY]: record });
      await browser.storage.local.remove(ERROR_KEY);
    } catch (error) {
      await browser.storage.local.set({ [ERROR_KEY]: errorRecord(error) });
      console.error("Omafox rejected a theme update", error);
    }
  }

  function enqueue(operation, label) {
    updateQueue = updateQueue
      .then(operation)
      .catch((error) => console.error(`Omafox ${label} queue failed`, error));
    return updateQueue;
  }

  function queueRestore() {
    return enqueue(restoreStoredTheme, "restore");
  }

  async function setNativeStatus(connected, message = "") {
    await browser.storage.local.set({
      [NATIVE_STATUS_KEY]: {
        connected,
        message,
        checkedAt: new Date().toISOString()
      }
    });
  }

  function sendFeaturesToHost(features) {
    if (!nativePort) {
      return false;
    }
    try {
      nativePort.postMessage({ action: "features-set", features });
      return true;
    } catch (error) {
      console.error("Omafox could not send feature toggles", error);
      return false;
    }
  }

  async function pushStoredFeatures() {
    const result = await browser.storage.local.get(FEATURES_KEY);
    const features = normalizeFeatures(result[FEATURES_KEY]);
    if (Object.keys(features).length > 0) {
      sendFeaturesToHost(features);
    }
  }

  async function handleFeaturesMessage(rawFeatures) {
    const features = normalizeFeatures(rawFeatures);
    const result = await browser.storage.local.get(FEATURES_KEY);
    const merged = normalizeFeatures({
      ...(result[FEATURES_KEY] || {}),
      ...features
    });
    await browser.storage.local.set({ [FEATURES_KEY]: merged });
    await syncGlanceMenu();
    if (!sendFeaturesToHost(merged)) {
      await browser.storage.local.set({
        [ERROR_KEY]: errorRecord(
          new Error("Native helper is disconnected; toggles saved for retry")
        )
      });
    }
  }

  function scheduleNativeReconnect() {
    if (reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectNativeHost();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  function connectNativeHost() {
    if (nativePort) return;

    try {
      const port = browser.runtime.connectNative(NATIVE_HOST);
      nativePort = port;

      port.onMessage.addListener((message) => {
        reconnectDelay = 1000;
        void setNativeStatus(true);
        if (message && message.type === "features-ack") {
          if (message.ok !== true) {
            console.error("Omafox host rejected a features update", message);
          }
          return;
        }
        void enqueue(() => receiveThemeMessage(message), "native update");
      });

      port.onDisconnect.addListener(() => {
        if (nativePort === port) nativePort = null;
        const message = port.error?.message || "Native host disconnected";
        void setNativeStatus(false, message);
        scheduleNativeReconnect();
      });

      void setNativeStatus(true);
      void pushStoredFeatures();
    } catch (error) {
      nativePort = null;
      void setNativeStatus(false, error instanceof Error ? error.message : String(error));
      scheduleNativeReconnect();
    }
  }

  function handleBrowserLifecycle() {
    const restore = queueRestore();
    connectNativeHost();
    return restore;
  }

  /* Auto-unload: once a minute, suspend background tabs whose native
   * lastAccessed stamp is older than the configured idle window. Firefox
   * keeps the favicon and restores on focus; we skip anything pinned,
   * audible, mid-load, active in its window, or flagged
   * autoDiscardable=false. */
  const UNLOAD_ALARM = "omarchy-tab-unload";
  const UNLOAD_DEFAULT_MINUTES = 30;

  async function unloadIdleTabs() {
    const stored = await browser.storage.local.get(FEATURES_KEY);
    const features = normalizeFeatures(stored[FEATURES_KEY]);
    if (features["tab-unload"] !== true) {
      return;
    }
    const minutes =
      typeof features["unload-minutes"] === "number"
        ? features["unload-minutes"]
        : UNLOAD_DEFAULT_MINUTES;
    const cutoff = Date.now() - minutes * 60000;
    const candidates = await browser.tabs.query({
      active: false,
      audible: false,
      autoDiscardable: true,
      discarded: false,
      pinned: false
    });
    for (const tab of candidates) {
      if (tab.status === "loading") continue;
      const lastAccessed =
        typeof tab.lastAccessed === "number" ? tab.lastAccessed : Date.now();
      if (lastAccessed <= cutoff) {
        try {
          await browser.tabs.discard(tab.id);
        } catch (error) {
          console.error("Omafox could not discard tab", tab.id, error);
        }
      }
    }
  }

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === UNLOAD_ALARM) {
      unloadIdleTabs().catch((error) =>
        console.error("Omafox idle-tab sweep failed", error)
      );
    }
  });
  browser.alarms.create(UNLOAD_ALARM, { periodInMinutes: 1 });

  /* Glance: a link-context "Peek" entry that previews the target in a
   * floating popup window — no tab, no page permissions required. */
  const GLANCE_MENU = "omarchy-glance";

  async function syncGlanceMenu() {
    const stored = await browser.storage.local.get(FEATURES_KEY);
    const features = normalizeFeatures(stored[FEATURES_KEY]);
    await browser.contextMenus.remove(GLANCE_MENU).catch(() => {});
    if (features["glance"] === true) {
      try {
        browser.contextMenus.create({
          id: GLANCE_MENU,
          title: "Peek in Glance",
          contexts: ["link"]
        });
        glanceMenuPresent = true;
      } catch (error) {
        glanceMenuPresent = true;
      }
    } else {
      glanceMenuPresent = false;
    }
  }

  /* MV3 event pages can suspend before an async create lands, dropping the
   * item until the next wake. The supported pattern is to reconcile inside
   * onShown — which itself wakes the page — then refresh() so the item
   * appears in the menu the user just opened. The flag is module state, so
   * it resets to false on every wake, matching the dropped registration. */
  let glanceMenuPresent = false;

  browser.contextMenus.onShown.addListener(async (info) => {
    if (!info.contexts || !info.contexts.includes("link")) {
      return;
    }
    const stored = await browser.storage.local.get(FEATURES_KEY);
    const want = normalizeFeatures(stored[FEATURES_KEY])["glance"] === true;
    if (want && !glanceMenuPresent) {
      try {
        browser.contextMenus.create({
          id: GLANCE_MENU,
          title: "Peek in Glance",
          contexts: ["link"]
        });
      } catch (error) {
        /* already registered — Firefox kept it across the wake */
      }
      glanceMenuPresent = true;
      await browser.contextMenus.refresh().catch(() => {});
    } else if (!want && glanceMenuPresent) {
      await browser.contextMenus.remove(GLANCE_MENU).catch(() => {});
      glanceMenuPresent = false;
      await browser.contextMenus.refresh().catch(() => {});
    }
  });

  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== GLANCE_MENU || !info.linkUrl) {
      return;
    }
    browser.windows
      .getCurrent()
      .then((win) =>
        browser.windows.create({
          url: info.linkUrl,
          type: "popup",
          width: 980,
          height: 680,
          left: (win.left ?? 0) + 80,
          top: (win.top ?? 0) + 60
        })
      )
      .catch((error) =>
        console.error("Omafox could not open a Glance window", error)
      );
  });

  void syncGlanceMenu();

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "features-set") {
      return handleFeaturesMessage(message.features);
    }
    if (message && message.type === "icon-reset") {
      return resetActionIcon();
    }
    return undefined;
  });

  browser.runtime.onStartup.addListener(handleBrowserLifecycle);
  browser.runtime.onInstalled.addListener(handleBrowserLifecycle);
  void handleBrowserLifecycle();
})();
