"use strict";

// Registry of userChrome feature toggles. Each id maps to the
// "omarchy.<id>" pref consumed by @media -moz-pref() gates in the chrome
// stylesheet or by the omarchy-features.uc.js privileged bridge; the
// native host persists the map to features.json.
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
      id: "site-colors",
      label: "Theme web pages",
      description:
        "Force page content to use the Omarchy palette — replaces Dark Reader"
    }
  ];

  const STORAGE_KEY = "features";
  const VALID_ID = /^[a-z0-9-]{1,48}$/;
  const KNOWN_IDS = new Set(FEATURES.map((feature) => feature.id));

  function normalizeFeatures(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return {};
    }
    const normalized = {};
    for (const [id, value] of Object.entries(candidate)) {
      if (KNOWN_IDS.has(id) && VALID_ID.test(id) && typeof value === "boolean") {
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
