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

  function applyPalette(record) {
    const style = document.documentElement.style;
    if (!record) {
      for (const key of ["--ofs-bg", "--ofs-fg", "--ofs-border",
          "--ofs-accent", "--ofs-accent-fg", "--ofs-error"]) {
        style.removeProperty(key);
      }
      style.removeProperty("color-scheme");
      return;
    }
    try {
      const theme = globalThis.OmafoxTheme.toFirefoxTheme(record);
      const palette = record.palette;
      style.setProperty("--ofs-bg", theme.colors.popup);
      style.setProperty("--ofs-fg", theme.colors.popup_text);
      style.setProperty("--ofs-border", theme.colors.popup_border);
      style.setProperty("--ofs-accent", palette.accent);
      style.setProperty(
        "--ofs-accent-fg",
        globalThis.OmafoxTheme.readableTextColor(palette.accent, palette.bright_foreground, [
          palette.foreground,
          palette.light_foreground,
          palette.dark_foreground,
          palette.background,
          palette.darker_background
        ])
      );
      style.setProperty("--ofs-error", palette.bright_red);
      document.documentElement.style.colorScheme = palette.mode;
    } catch {
      /* stored theme failed validation — keep system colors */
    }
  }

  async function loadState() {
    const result = await browser.storage.local.get([
      STORAGE_KEY,
      ERROR_KEY,
      NATIVE_STATUS_KEY
    ]);
    storedTheme = result[STORAGE_KEY] || null;
    const nativeStatus = result[NATIVE_STATUS_KEY] || null;
    applyPalette(storedTheme);

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
      await browser.runtime.sendMessage({ type: "icon-reset" });
      await loadState();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  const featureList = document.querySelector("#feature-list");
  const { FEATURES, STORAGE_KEY: FEATURES_KEY } = globalThis.OmafoxFeatures;
  const rangeDebounce = new Map();

  async function sendFeature(id, value) {
    try {
      await browser.runtime.sendMessage({
        type: "features-set",
        features: { [id]: value }
      });
      showError("");
      return true;
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function renderFeatures() {
    const result = await browser.storage.local.get(FEATURES_KEY);
    const enabled = result[FEATURES_KEY] || {};
    featureList.textContent = "";
    for (const feature of FEATURES) {
      const label = document.createElement("label");
      label.className = "feature";
      const gated =
        feature.dependsOn && enabled[feature.dependsOn] !== true;

      if (feature.type === "range") {
        label.classList.add("feature-range");

        const head = document.createElement("span");
        head.className = "feature-range-head";
        const name = document.createElement("span");
        name.className = "feature-label";
        name.textContent = feature.label;
        const readout = document.createElement("span");
        readout.className = "feature-value";
        head.append(name, readout);

        const description = document.createElement("span");
        description.className = "feature-description";
        description.textContent = feature.description;

        const input = document.createElement("input");
        input.type = "range";
        input.min = String(feature.min);
        input.max = String(feature.max);
        input.step = String(feature.step);
        input.value = String(
          typeof enabled[feature.id] === "number"
            ? enabled[feature.id]
            : feature.default
        );
        input.disabled = gated;
        const renderValue = () => {
          const value = Number(input.value);
          readout.textContent = feature.unit
            ? `${value} ${feature.unit}`
            : `${Math.round(value * 100)}%`;
        };
        renderValue();
        input.addEventListener("input", () => {
          renderValue();
          clearTimeout(rangeDebounce.get(feature.id));
          rangeDebounce.set(
            feature.id,
            setTimeout(
              () => void sendFeature(feature.id, Number(input.value)),
              100
            )
          );
        });
        input.addEventListener("change", () => {
          clearTimeout(rangeDebounce.get(feature.id));
          void sendFeature(feature.id, Number(input.value));
        });

        label.append(head, input, description);
        featureList.append(label);
        continue;
      }

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = enabled[feature.id] === true;
      input.disabled = gated;
      if (gated) {
        label.classList.add("feature-gated");
      }
      input.addEventListener("change", async () => {
        const ok = await sendFeature(feature.id, input.checked);
        if (ok) {
          await renderFeatures();
        } else {
          input.checked = !input.checked;
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
