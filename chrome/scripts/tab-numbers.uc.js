// Omafire tab numbers on hold (omafire.tab-numbers-hold), from Zia's idea.
//
// With omafire.tab-numbers and omafire.tab-numbers-hold both on, the tab
// numbers (tab-numbers.css) show only while Alt is held. Digits then pick a
// tab and the switch happens when Alt is released, so nothing loads by
// accident on the way: Alt, 1, 2 reaches tab 12. The tab the digits point at
// is lit (omafire-num-lit) as they are typed. Alt+9 alone is the last tab,
// as in Firefox; a number past the last tab is the last tab. Escape or the
// window losing focus drops the entry.
//
// The root carries omafire-tab-numbers-hold (the setting is on) and, while
// Alt is down, omafire-numbers-held; tab-numbers.css reads both.
// Loaded into each browser window by omafire.cfg.
(function () {
  "use strict";
  if (window.OmafireTabNumbers) {
    return;
  }

  const prefs = Services.prefs;
  const root = document.documentElement;
  const HOLD = "omafire.tab-numbers-hold";
  const SHOW = "omafire.tab-numbers";

  let held = false;      // Alt is down, with no other modifier
  let entry = "";        // the digits typed so far

  const active = () => prefs.getBoolPref(SHOW, false) && prefs.getBoolPref(HOLD, false);

  // Firefox's own count: pinned first, hidden tabs and a collapsed group's
  // tabs left out.
  const tabs = () => gBrowser.visibleTabs;

  function target() {
    if (!entry) {
      return null;
    }
    const list = tabs();
    // 9 alone is the last tab (Firefox's Alt+9); any longer number is a count.
    const n = entry === "9" ? list.length : Math.min(parseInt(entry, 10), list.length);
    return n >= 1 ? list[n - 1] : null;
  }

  function light() {
    for (const tab of document.querySelectorAll("[omafire-num-lit]")) {
      tab.removeAttribute("omafire-num-lit");
    }
    target()?.setAttribute("omafire-num-lit", "");
  }

  function setHeld(on) {
    held = on;
    if (on) {
      root.setAttribute("omafire-numbers-held", "");
    } else {
      root.removeAttribute("omafire-numbers-held");
      entry = "";
      light();
    }
  }

  function sync() {
    if (prefs.getBoolPref(HOLD, false)) {
      root.setAttribute("omafire-tab-numbers-hold", "");
    } else {
      root.removeAttribute("omafire-tab-numbers-hold");
    }
    if (!active() && (held || entry)) {
      setHeld(false);
    }
  }

  const plain = e => !e.ctrlKey && !e.shiftKey && !e.metaKey;
  // The digit a key event is: the layout's digit row by position, else the
  // character (a virtual keyboard may report no usable position).
  const digitOf = e => /^Digit([0-9])$/.exec(e.code)?.[1] ?? (/^[0-9]$/.test(e.key) ? e.key : null);

  window.addEventListener("keydown", e => {
    if (!active()) {
      return;
    }
    if (e.key === "Alt" && !e.repeat && plain(e)) {
      setHeld(true);
      return;
    }
    // A digit with Alt already down starts the hold too: some input paths
    // (virtual keyboards, a key held across a focus change) send the
    // modifier state without a key event for Alt itself.
    if (!held && e.altKey && plain(e) && digitOf(e) !== null) {
      setHeld(true);
    }
    if (!held) {
      return;
    }
    if (e.key === "Escape") {
      setHeld(false);
      return;
    }
    // Digits typed while Alt is down.
    const digit = digitOf(e);
    if (digit !== null && e.altKey && plain(e) && (entry || digit !== "0")) {
      // Not Firefox's immediate Alt+digit switch: ours waits for the release.
      e.preventDefault();
      e.stopPropagation();
      entry += digit;
      light();
    }
  }, true);

  window.addEventListener("keyup", e => {
    if (e.key !== "Alt" || !held) {
      return;
    }
    const tab = target();
    const typed = entry !== "";
    setHeld(false);
    if (typed) {
      // A release that ends an entry is not a bare Alt tap: no menu bar.
      e.preventDefault();
      e.stopPropagation();
    }
    if (tab && gBrowser.selectedTab !== tab) {
      gBrowser.selectedTab = tab;
    }
  }, true);

  window.addEventListener("blur", () => setHeld(false));

  const observer = {observe: sync};
  prefs.addObserver(HOLD, observer);
  prefs.addObserver(SHOW, observer);
  window.addEventListener("unload", () => {
    prefs.removeObserver(HOLD, observer);
    prefs.removeObserver(SHOW, observer);
  }, {once: true});
  sync();

  window.OmafireTabNumbers = {
    state: () => ({held, entry, lit: !!document.querySelector("[omafire-num-lit]")}),
  };
})();
