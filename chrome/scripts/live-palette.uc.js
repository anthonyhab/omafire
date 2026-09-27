// Omafire live palette: a theme switch reaches everything without a restart.
//
// The chrome follows the Omafire extension's lightweight theme live, but
// the files omafire sync writes beside the theme are read once, at startup:
// the palette (tab-group swatches, the danger red), Hyprland's rounding,
// and the content palette that Firefox's own pages (settings, add-ons) are
// painted from. When the extension repaints the window, sync has already
// rewritten those files (it writes them before theme.json); this rereads
// them and lays their --omarchy-* values over the startup copies as one
// user sheet, which reaches chrome and content documents alike.
// Loaded into each browser window by omafire.cfg.
(function () {
  "use strict";
  if (window.OmafireLivePalette) {
    return;
  }

  const TOPIC = "lightweight-theme-styling-update";
  // Remembers the registered sheet across windows. A default-branch pref
  // is never written to prefs.js, so it lasts exactly one session.
  const CURRENT = "omafire.internal.live-palette-sheet";
  const sss = Cc["@mozilla.org/content/style-sheet-service;1"]
    .getService(Ci.nsIStyleSheetService);
  const defaults = Services.prefs.getDefaultBranch("");

  const chromeDir = Services.dirsvc.get("UChrm", Ci.nsIFile).path;
  const file = name => PathUtils.join(chromeDir, name);

  async function vars(name) {
    try {
      const text = await IOUtils.readUTF8(file(name));
      // Only the palette's own variables: the chrome palette also holds a
      // cold-start stand-in for the lightweight theme, which must never
      // outlive startup.
      return [...text.matchAll(/^\s*(--omarchy-[\w-]+)\s*:\s*([^;!]+?)\s*;/gm)]
        .map(([, prop, value]) => `${prop}: ${value} !important;`);
    } catch {
      return [];
    }
  }

  async function build() {
    const [chrome, content, geometry] = await Promise.all([
      vars("omafire-palette.css"),
      vars("omafire-content-palette.css"),
      vars("omafire-radius.css"),
    ]);
    if (!chrome.length && !content.length && !geometry.length) {
      return null;
    }
    const block = decls => `:root { ${decls.join(" ")} }`;
    return `@-moz-document url-prefix("chrome:") { ${block([...chrome, ...geometry])} }\n`
      + `@-moz-document url-prefix("about:") { ${block([...content, ...geometry])} }\n`;
  }

  let timer = null;
  async function refresh() {
    const css = await build();
    if (!css) {
      return;
    }
    const uri = "data:text/css;charset=utf-8," + encodeURIComponent(css);
    const previous = defaults.getStringPref(CURRENT, "");
    if (previous === uri) {
      return;             // another window got there first
    }
    const next = Services.io.newURI(uri);
    if (!sss.sheetRegistered(next, sss.USER_SHEET)) {
      sss.loadAndRegisterSheet(next, sss.USER_SHEET);
    }
    if (previous) {
      const old = Services.io.newURI(previous);
      if (sss.sheetRegistered(old, sss.USER_SHEET)) {
        sss.unregisterSheet(old, sss.USER_SHEET);
      }
    }
    defaults.setStringPref(CURRENT, uri);
  }

  const observer = {
    observe() {
      // The extension repaints a window at a time; settle once.
      clearTimeout(timer);
      timer = setTimeout(() => refresh().catch(e => console.error("[omafire:live-palette]", e)), 300);
    },
  };
  Services.obs.addObserver(observer, TOPIC);
  window.addEventListener("unload", () => {
    clearTimeout(timer);
    Services.obs.removeObserver(observer, TOPIC);
  }, {once: true});

  window.OmafireLivePalette = {refresh};
})();
