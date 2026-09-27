// Omafox keybindings: the theme's modes, one chord each.
//
// Each binding is a pref, omarchy.keys.<action>, like "Ctrl+Alt+Z"; an
// empty string turns it off. A chord Firefox already uses is skipped, not
// taken over. Changing a binding applies to windows opened afterwards.
// Loaded into each browser window by omafox.cfg.
(function () {
  "use strict";
  if (window.OmafoxKeys) {
    return;
  }

  const prefs = Services.prefs;
  const bool = (name, fallback) => prefs.getBoolPref(name, fallback);

  const ACTIONS = [
    {
      name: "zen", chord: "Ctrl+Alt+H", label: "Hide the chrome",
      run() {
        // Top layout only; the sidebar layout's counterpart is compact.
        if (prefs.getStringPref("omarchy.layout", "top") === "sidebar") {
          prefs.setBoolPref("omarchy.compact", !bool("omarchy.compact", false));
          return;
        }
        const on = bool("omarchy.zen-mode", false) && bool("omarchy.zen-mode-active", false);
        prefs.setBoolPref("omarchy.zen-mode", true);
        prefs.setBoolPref("omarchy.zen-mode-active", !on);
      },
    },
    {
      name: "layout", chord: "Ctrl+Alt+S", label: "Switch toolbar",
      run() {
        const sidebar = prefs.getStringPref("omarchy.layout", "top") === "sidebar";
        if (!sidebar) {
          prefs.setBoolPref("sidebar.verticalTabs", true);
        }
        prefs.setStringPref("omarchy.layout", sidebar ? "top" : "sidebar");
      },
    },
    {
      name: "glass", chord: "Ctrl+Alt+G", label: "Glass",
      run() {
        prefs.setBoolPref("omarchy.translucency", !bool("omarchy.translucency", false));
      },
    },
    {
      name: "settings", chord: "Ctrl+Alt+O", label: "This panel",
      run() {
        window.OmafoxSettings?.open();
      },
    },
  ];

  const MODIFIERS = {ctrl: "control", control: "control", alt: "alt",
                     shift: "shift", super: "meta", meta: "meta"};

  // "Ctrl+Alt+Z" -> {modifiers: "alt,control", key: "Z"}
  function parse(chord) {
    const parts = chord.split("+").map(p => p.trim()).filter(Boolean);
    const key = parts.pop();
    if (!key || key.length !== 1) {
      return null;
    }
    const mods = [];
    for (const p of parts) {
      const m = MODIFIERS[p.toLowerCase()];
      if (!m) {
        return null;
      }
      mods.push(m);
    }
    if (!mods.length) {
      return null;       // a bare letter would eat typing
    }
    return {modifiers: [...new Set(mods)].sort().join(","), key: key.toUpperCase()};
  }

  function normalizedModifiers(el) {
    return (el.getAttribute("modifiers") || "")
      .split(/[\s,]+/).filter(Boolean)
      .map(m => (m === "accel" ? "control" : m))
      .sort().join(",");
  }

  // Firefox's own <key> for this chord, if any.
  function taken(spec) {
    for (const el of document.querySelectorAll("key[key]")) {
      if (el.closest("#omafox-keyset")) {
        continue;
      }
      if (el.getAttribute("key").toUpperCase() === spec.key
          && normalizedModifiers(el) === spec.modifiers) {
        return el.id || "a Firefox shortcut";
      }
    }
    return null;
  }

  const active = [];
  const keyset = document.createXULElement("keyset");
  keyset.id = "omafox-keyset";
  for (const action of ACTIONS) {
    const chord = prefs.getStringPref(`omarchy.keys.${action.name}`, action.chord);
    if (!chord) {
      continue;
    }
    const spec = parse(chord);
    if (!spec) {
      console.warn(`[omafox:keys] omarchy.keys.${action.name}: cannot read "${chord}"`);
      continue;
    }
    const owner = taken(spec);
    if (owner) {
      console.warn(`[omafox:keys] ${chord} is taken by ${owner}; ${action.label} left unbound`);
      continue;
    }
    const key = document.createXULElement("key");
    key.id = `omafox-key-${action.name}`;
    key.setAttribute("modifiers", spec.modifiers);
    key.setAttribute("key", spec.key);
    key.setAttribute("reserved", "true");
    key.addEventListener("command", () => {
      try {
        action.run();
      } catch (error) {
        console.error(`[omafox:keys] ${action.name}`, error);
      }
    });
    keyset.append(key);
    active.push(`${chord}  ${action.label}`);
  }
  document.documentElement.append(keyset);

  window.OmafoxKeys = {
    describe: () => active.slice(),
    ACTIONS,
  };
})();
