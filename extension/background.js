"use strict";

(function startOmafox() {
  const STORAGE_KEY = "storedTheme";
  const ERROR_KEY = "lastError";
  const NATIVE_STATUS_KEY = "nativeStatus";
  const NATIVE_HOST = "org.omarchy.omafox";
  const { parseThemeMessage, toFirefoxTheme } = globalThis.OmafoxTheme;
  let updateQueue = Promise.resolve();
  let nativePort = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  /* Signature of the last applied theme — repeat pushes (wake restore plus
   * the host's connect-time resend of the same theme.json) must not trigger
   * a second full-chrome restyle. */
  let lastAppliedSignature = null;
  /* Last palette color the action icon was tinted with. */
  let lastTintedIconColor = null;

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
    /* The next push must fully re-apply so the icon is re-tinted. */
    lastAppliedSignature = null;
    lastTintedIconColor = null;
    try {
      await browser.action.setIcon({
        path: browser.runtime.getManifest().action.default_icon
      });
    } catch (error) {
      console.error("Omafox could not restore its toolbar icon", error);
    }
  }

  function recordSignature(record) {
    return `${record.themeName}\n${JSON.stringify(record.palette)}`;
  }

  async function applyRecord(record) {
    const signature = recordSignature(record);
    if (signature === lastAppliedSignature) return;
    const theme = toFirefoxTheme(record);
    await browser.theme.update(theme);
    lastAppliedSignature = signature;
    /* Per-window site-coloured tab glow sits on top of this theme. */
    await globalThis.OmafoxTabGlow?.onBaseTheme(theme, record.palette.mode);
    if (theme.colors.icons === lastTintedIconColor) return;
    try {
      await tintActionIcon(theme);
      lastTintedIconColor = theme.colors.icons;
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
        void enqueue(() => receiveThemeMessage(message), "native update");
      });

      port.onDisconnect.addListener(() => {
        if (nativePort === port) nativePort = null;
        const message = port.error?.message || "Native host disconnected";
        void setNativeStatus(false, message);
        scheduleNativeReconnect();
      });

      void setNativeStatus(true);
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

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "icon-reset") {
      return resetActionIcon();
    }
    return undefined;
  });

  globalThis.OmafoxTabGlow?.start();
  browser.runtime.onStartup.addListener(handleBrowserLifecycle);
  browser.runtime.onInstalled.addListener(handleBrowserLifecycle);
  void handleBrowserLifecycle();
})();
