"use strict";

(function startPopup() {
  const STORAGE_KEY = "storedTheme";
  const ERROR_KEY = "lastError";
  const NATIVE_STATUS_KEY = "nativeStatus";
  const state = document.querySelector("#state");
  const details = document.querySelector("#details");
  const themeName = document.querySelector("#theme-name");
  const paletteMode = document.querySelector("#palette-mode");
  const lastSync = document.querySelector("#last-sync");
  const errorMessage = document.querySelector("#error");
  const reapply = document.querySelector("#reapply");
  const clear = document.querySelector("#clear");
  let storedTheme = null;

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = !message;
  }

  async function loadState() {
    const result = await browser.storage.local.get([
      STORAGE_KEY,
      ERROR_KEY,
      NATIVE_STATUS_KEY
    ]);
    storedTheme = result[STORAGE_KEY] || null;
    const nativeStatus = result[NATIVE_STATUS_KEY] || null;

    if (storedTheme) {
      state.textContent = nativeStatus?.connected === false
        ? "Theme loaded; native helper is disconnected"
        : "Theme sync is active";
      themeName.textContent = storedTheme.themeName;
      paletteMode.textContent = `${storedTheme.palette.mode}, ${globalThis.OmafoxTheme.COLOR_KEYS.length} colors`;
      lastSync.textContent = new Date(storedTheme.appliedAt).toLocaleString();
      details.hidden = false;
      reapply.disabled = false;
      clear.disabled = false;
    } else {
      state.textContent = nativeStatus?.connected === false
        ? "Waiting for the native helper"
        : "Waiting for the first Omarchy sync";
      details.hidden = true;
      reapply.disabled = true;
      clear.disabled = true;
    }

    const nativeError = nativeStatus?.connected === false
      ? nativeStatus.message
      : "";
    showError(result[ERROR_KEY]?.message || nativeError || "");
  }

  reapply.addEventListener("click", async () => {
    if (!storedTheme) return;
    try {
      await browser.theme.update(globalThis.OmafoxTheme.toFirefoxTheme(storedTheme));
      await browser.storage.local.remove(ERROR_KEY);
      showError("");
      state.textContent = "Theme reapplied";
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  clear.addEventListener("click", async () => {
    try {
      await browser.theme.reset();
      await browser.storage.local.remove([STORAGE_KEY, ERROR_KEY]);
      await loadState();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  const featureList = document.querySelector("#feature-list");
  const { FEATURES, STORAGE_KEY: FEATURES_KEY } = globalThis.OmafoxFeatures;

  async function renderFeatures() {
    const result = await browser.storage.local.get(FEATURES_KEY);
    const enabled = result[FEATURES_KEY] || {};
    featureList.textContent = "";
    for (const feature of FEATURES) {
      const label = document.createElement("label");
      label.className = "feature";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = enabled[feature.id] === true;
      input.addEventListener("change", async () => {
        try {
          await browser.runtime.sendMessage({
            type: "features-set",
            features: { [feature.id]: input.checked }
          });
        } catch (error) {
          input.checked = !input.checked;
          showError(error instanceof Error ? error.message : String(error));
        }
      });

      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "feature-label";
      name.textContent = feature.label;
      const description = document.createElement("span");
      description.className = "feature-description";
      description.textContent = feature.description;
      text.append(name, description);
      label.append(input, text);
      featureList.append(label);
    }
  }

  void loadState().catch((error) => showError(error.message));
  void renderFeatures().catch((error) => showError(error.message));
})();
