"use strict";

// Registry of userChrome feature toggles. Each id maps to the
// "omarchy.<id>" pref consumed by @media -moz-pref() gates in the chrome
// stylesheet; the native host persists the map to features.json.
(function defineOmafoxFeatures(globalScope) {
  const FEATURES = [
    {
      id: "debug",
      label: "Debug outlines",
      description:
        "Outline every UI box with depth-banded colors to expose spacing issues"
    },
    {
      id: "urlbar-actions",
      label: "Always show URL bar actions",
      description:
        "Keep page-action buttons visible instead of revealing them on hover"
    },
    {
      id: "chrome-gap",
      label: "Window frame gap",
      description: "Restore the Nova inset gap around the toolbox and viewport"
    },
    {
      id: "translucency",
      label: "Translucent chrome",
      description:
        "Glass surfaces for blur-capable compositors (Hyprland layerrule blur)"
    },
    {
      id: "transparency",
      type: "range",
      min: 0.55,
      max: 1,
      step: 0.01,
      default: 0.85,
      dependsOn: "translucency",
      label: "Glass opacity",
      description:
        "Surface opacity while Translucent chrome is enabled; lower is clearer"
    }
  ];

  const STORAGE_KEY = "features";
  const VALID_ID = /^[a-z0-9-]{1,48}$/;
  const KNOWN_IDS = new Map(FEATURES.map((feature) => [feature.id, feature]));

  function normalizeFeatures(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return {};
    }
    const normalized = {};
    for (const [id, value] of Object.entries(candidate)) {
      const feature = KNOWN_IDS.get(id);
      if (!feature || !VALID_ID.test(id)) {
        continue;
      }
      if (feature.type === "range") {
        const number = Number(value);
        if (Number.isFinite(number)) {
          normalized[id] = Math.min(
            feature.max,
            Math.max(feature.min, number)
          );
        }
      } else if (typeof value === "boolean") {
        normalized[id] = value;
      }
    }
    return normalized;
  }

  const api = { FEATURES, STORAGE_KEY, normalizeFeatures };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.OmafoxFeatures = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
