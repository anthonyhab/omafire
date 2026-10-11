// Omafire live palette: a theme switch reaches everything without a restart.
//
// The files omafire sync writes beside the theme are read once, at startup:
// the chrome palette (the --omarchy-* colours and the Firefox theme
// variables), Hyprland's rounding, and the content palette that Firefox's
// own pages (settings, add-ons) are painted from. A sync rewrites them, then
// theme.json, which `omafire watch` reports (config.sys.mjs passes it on as
// omafire-palette-changed); this rereads them and lays their values over
// the startup copies.
//
// In two steps, since anything every document sees (a user sheet from the
// style sheet service, a page colour pref) restyles every open page at
// once: ~250 ms of the main thread with a dozen tabs open, longer the more
// and heavier they are. First this window's own sheet, which restyles only
// the window: the toolbars change on the next frame. Then, once that frame
// is painted, the rest together, in one restyle: the user sheet that
// reaches every chrome and about: document (the new tab page, sidebars,
// settings) and the page palette.
// Loaded into each browser window by omafire.cfg.
(function () {
  "use strict";
  if (window.OmafireLivePalette) {
    return;
  }

  const TOPIC = "omafire-palette-changed";
  const APPLIED = "omafire-palette-applied";
  // Remembers the registered sheet across windows. A default-branch pref
  // is never written to prefs.js, so it lasts exactly one session.
  const CURRENT = "omafire.internal.live-palette-sheet";
  const sss = Cc["@mozilla.org/content/style-sheet-service;1"]
    .getService(Ci.nsIStyleSheetService);
  const defaults = Services.prefs.getDefaultBranch("");

  const chromeDir = Services.dirsvc.get("UChrm", Ci.nsIFile).path;
  const file = name => PathUtils.join(chromeDir, name);

  // Every plain variable: the glass floor and the content palette's
  // highlight colours are --omafire-*, the Firefox theme values
  // --omafire-ff-*. The Firefox variables that read those (!important in
  // the file) stay as they are.
  const vars = text => [...text.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;!]+?)\s*;/gm)]
    .map(([, prop, value]) => `${prop}: ${value} !important;`);

  async function build() {
    const [chromeText, contentText, geometryText] = await Promise.all(
      ["omafire-palette.css", "omafire-content-palette.css", "omafire-radius.css"]
        .map(name => IOUtils.readUTF8(file(name)).catch(() => "")));
    const [chrome, content, geometry] = [chromeText, contentText, geometryText].map(vars);
    if (!chrome.length && !content.length && !geometry.length) {
      return null;
    }
    const decls = [...chrome, ...geometry].join(" ");
    return {
      // more specific than the user sheet's :root, so it wins over that
      // sheet's previous palette until the second step replaces it
      window: `:root:not(#omafire-live-palette) { ${decls} }`,
      everywhere: `@-moz-document url-prefix("chrome:") { :root { ${decls} } }\n`
        + `@-moz-document url-prefix("about:") { :root { ${[...content, ...geometry].join(" ")} } }\n`,
      contentText,
    };
  }

  // This window's sheet: a data: URI, replaced on each switch.
  let windowSheet = "";
  function swapWindowSheet(css) {
    const uri = "data:text/css;charset=utf-8," + encodeURIComponent(css);
    if (uri === windowSheet) {
      return;
    }
    const utils = window.windowUtils;
    utils.loadSheetUsingURIString(uri, utils.USER_SHEET);
    if (windowSheet) {
      utils.removeSheetUsingURIString(windowSheet, utils.USER_SHEET);
    }
    windowSheet = uri;
  }

  const painted = () => new Promise(resolve =>
    window.requestAnimationFrame(() => setTimeout(resolve, 0)));

  // The page palette Firefox's forced colours paint from (the colour
  // override, and Cinder on top of it): omafire sync writes it to user.js,
  // read at startup; a switch sets it here, and open pages repaint.
  const PAGE = {
    "browser.display.background_color": "--omarchy-background",
    "browser.display.foreground_color": "--omarchy-foreground",
    "browser.anchor_color": "--omarchy-accent",
    "browser.visited_color": "--omarchy-magenta",
    "ui.highlight": "--omafire-highlight",
    "ui.highlighttext": "--omafire-highlight-text",
    "ui.mark": "--omafire-mark",
    "ui.marktext": "--omafire-mark-text",
  };
  function pagePalette(text) {
    // the scheme sites see: dark or light, as the theme is (sync's user.js
    // content-override, which is read at startup)
    const scheme = text.match(/--omarchy-color-scheme\s*:\s*(dark|light)/);
    if (scheme) {
      const value = scheme[1] === "light" ? 1 : 0;
      const pref = "layout.css.prefers-color-scheme.content-override";
      if (Services.prefs.getIntPref(pref, -1) !== value) {
        Services.prefs.setIntPref(pref, value);
      }
    }
    for (const [pref, prop] of Object.entries(PAGE)) {
      const m = text.match(new RegExp(`^\\s*${prop}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`, "m"));
      if (m && Services.prefs.getStringPref(pref, "") !== m[1]) {
        Services.prefs.setStringPref(pref, m[1]);
      }
    }
  }

  // Replace the user sheet remembered under `key` with `css`; false when
  // it is already in place.
  function swap(key, css) {
    const uri = "data:text/css;charset=utf-8," + encodeURIComponent(css);
    const previous = defaults.getStringPref(key, "");
    if (previous === uri) {
      return false;       // another window got there first
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
    defaults.setStringPref(key, uri);
    return true;
  }

  // One refresh at a time; a sync that lands during one (a quick run of
  // theme previews) gets one more after it, which reads the latest files.
  let running = null;
  let again = false;
  async function refresh() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        const css = await build();
        if (css) {
          swapWindowSheet(css.window);
          await painted();
          pagePalette(css.contentText);
          if (swap(CURRENT, css.everywhere)) {
            // the new tab page reads its text colours from the sheet
            Services.obs.notifyObservers(null, APPLIED);
          }
        }
        // a light palette wants a deeper site colour
        window.OmafireSiteColors?.paint();
      } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  // Glass pages take the chrome's glass alpha (the theme's content.css).
  // Web content processes never see string prefs, so it reaches them as a
  // variable in a user sheet too, and follows the opacity setting live.
  const ALPHA = "omafire.transparency";
  function glassAlpha() {
    const v = parseFloat(Services.prefs.getStringPref(ALPHA, ""));
    swap("omafire.internal.glass-alpha-sheet",
      `:root { --omafire-glass-alpha: ${v >= 0.5 && v <= 1 ? v.toFixed(2) : "0.85"} !important; }`);
  }
  glassAlpha();
  Services.prefs.addObserver(ALPHA, glassAlpha);

  const observer = {
    observe() {
      refresh().catch(e => console.error("[omafire:live-palette]", e));
    },
  };
  Services.obs.addObserver(observer, TOPIC);
  window.addEventListener("unload", () => {
    Services.obs.removeObserver(observer, TOPIC);
    Services.prefs.removeObserver(ALPHA, glassAlpha);
  }, {once: true});

  window.OmafireLivePalette = {refresh};
})();
