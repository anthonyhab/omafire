// Omafire keybindings: the theme's modes, one chord each.
//
// Each binding is a pref, omafire.keys.<action> (the key-<action> settings in
// config.json), like "Ctrl+Alt+Z"; an
// empty string turns it off. A chord Firefox already uses is skipped, not
// taken over. Changing a binding applies to windows opened afterwards.
// Loaded into each browser window by omafire.cfg.
(function () {
  "use strict";
  if (window.OmafireKeys) {
    return;
  }

  const prefs = Services.prefs;
  const bool = (name, fallback) => prefs.getBoolPref(name, fallback);

  const ACTIONS = [
    {
      name: "zen", pref: "omafire.keys.zen", chord: "Ctrl+Alt+H", label: "Zen",
      run() {
        // Zen (DEC-104): everything in the sidebar, which disappears until
        // reached for. Pressed again, back to the docked top layout.
        const zen = prefs.getStringPref("omafire.layout", "top") === "sidebar"
          && bool("omafire.compact", false);
        if (!zen) {
          prefs.setBoolPref("sidebar.verticalTabs", true);
        }
        prefs.setStringPref("omafire.layout", zen ? "top" : "sidebar");
        prefs.setBoolPref("omafire.compact", !zen);
      },
    },
    {
      name: "layout", pref: "omafire.keys.layout", chord: "Ctrl+Alt+S", label: "Switch toolbar",
      run() {
        // Docked top row, then the sidebar, then one line, then back.
        const NEXT = {top: "sidebar", sidebar: "line", line: "top"};
        const next = NEXT[prefs.getStringPref("omafire.layout", "top")] ?? "sidebar";
        prefs.setBoolPref("sidebar.verticalTabs", next !== "line");
        prefs.setStringPref("omafire.layout", next);
      },
    },
    {
      name: "glass", pref: "omafire.keys.glass", chord: "Ctrl+Alt+G", label: "Glass",
      run() {
        prefs.setBoolPref("omafire.translucency", !bool("omafire.translucency", false));
      },
    },
    {
      name: "settings", pref: "omafire.keys.settings", chord: "Ctrl+Alt+O", label: "This panel",
      run() {
        window.OmafireSettings?.open();
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
      if (el.closest("#omafire-keyset")) {
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
  const conflicts = {};
  const keyset = document.createXULElement("keyset");
  keyset.id = "omafire-keyset";
  for (const action of ACTIONS) {
    const chord = prefs.getStringPref(action.pref, action.chord);
    if (!chord) {
      continue;
    }
    const spec = parse(chord);
    if (!spec) {
      console.warn(`[omafire:keys] ${action.pref}: cannot read "${chord}"`);
      continue;
    }
    const owner = taken(spec);
    if (owner) {
      console.warn(`[omafire:keys] ${chord} is taken by ${owner}; ${action.label} left unbound`);
      conflicts[action.name] = {chord, owner};
      continue;
    }
    const key = document.createXULElement("key");
    key.id = `omafire-key-${action.name}`;
    key.setAttribute("modifiers", spec.modifiers);
    key.setAttribute("key", spec.key);
    key.setAttribute("reserved", "true");
    key.addEventListener("command", () => {
      try {
        action.run();
      } catch (error) {
        console.error(`[omafire:keys] ${action.name}`, error);
      }
    });
    keyset.append(key);
    active.push(`${chord}  ${action.label}`);
  }
  document.documentElement.append(keyset);

  // The chords skipped above, for `omafire status` and the shell panel to
  // show beside the row: a console warning nobody reads is not a report.
  IOUtils.writeJSON(PathUtils.join(PathUtils.profileDir, "omafire-keys.json"), {conflicts})
    .catch(error => console.warn("[omafire:keys] cannot write omafire-keys.json", error));

  window.OmafireKeys = {
    describe: () => active.slice(),
    ACTIONS,
  };
})();
