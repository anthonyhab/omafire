// Omafire: which pages are clear.
//
// browser.tabs.allow_transparent_browser (omafire sets it) makes every tab's
// browser transparent: a page that paints no background shows what lies
// under it, not the canvas Firefox would give it (white, or dark under
// color-scheme: dark), while its text keeps that canvas's colour. On a dark
// theme that is black text on the dark backstop. Two kinds of page are meant
// to be clear: the Omafire new tab (its Desktop background shows the window
// surface) and, with glass pages, pages under forced colours, whose base
// Cinder paints at the glass step. Every other page gets its canvas back.
// Loaded into each browser window by omafire.cfg.
(function () {
  "use strict";
  if (window.OmafireClearPages) {
    return;
  }

  const NEWTAB = "chrome://omafire/content/newtab.html";
  const PREFS = ["omafire.translucency", "omafire.glass-pages", "browser.display.document_color_use"];

  const glassPages = () =>
    Services.prefs.getBoolPref("omafire.translucency", false) &&
    Services.prefs.getBoolPref("omafire.glass-pages", false) &&
    Services.prefs.getIntPref("browser.display.document_color_use", 0) === 2;

  function update(browser) {
    const clear = Boolean(browser.currentURI?.spec.startsWith(NEWTAB)) || glassPages();
    if (clear) {
      browser.setAttribute("transparent", "true");
    } else {
      browser.removeAttribute("transparent");
    }
  }

  // (a tab not yet restored has no browser until it is inserted)
  const onTab = e => e.target.linkedPanel && update(e.target.linkedBrowser);
  const updateAll = () => gBrowser.tabs.forEach(tab => onTab({target: tab}));
  // A new browser's initial about:blank has no location change, and a
  // page can write into it (a window.open popup).
  gBrowser.tabContainer.addEventListener("TabOpen", onTab);
  gBrowser.tabContainer.addEventListener("TabBrowserInserted", onTab);
  const listener = {
    onLocationChange(browser, webProgress) {
      if (webProgress.isTopLevel) {
        update(browser);
      }
    },
  };
  const observer = {observe: updateAll};
  gBrowser.addTabsProgressListener(listener);
  for (const pref of PREFS) {
    Services.prefs.addObserver(pref, observer);
  }
  window.addEventListener("unload", () => {
    gBrowser.removeTabsProgressListener(listener);
    for (const pref of PREFS) {
      Services.prefs.removeObserver(pref, observer);
    }
  }, {once: true});
  updateAll();

  window.OmafireClearPages = {update};
})();
