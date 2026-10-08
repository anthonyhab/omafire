// Omafire compact: tell compact.css what it can't see for itself.
//
// The compact sidebar stays out while anything the column owns is open or
// keyboard-focused. Two owners are invisible to CSS:
//
// - Menus. The column's popups (tab and toolbar context menus, the
//   new-tab container menu, Back's history, the sidebar's menus) live
//   outside it, so the pointer leaves the column to use them, and a native
//   menupopup carries no attribute or pseudo-class while it is open: only
//   its state property says so. [omafire-column-popup] marks the root while
//   any panel or menupopup whose trigger or anchor is in the column is open.
// - Keyboard focus on the sidebar's tools. They live in sidebar-main's
//   shadow tree, where a host never matches :focus-visible, and
//   :focus-within can't tell a Tab from the right-click that leaves a tool
//   focused after its menu closes. [omafire-tools-focus] marks the root
//   while a tool holds focus that the mouse didn't give it.
//
// A third thing is Firefox's own: sidebar-main decides which tools fit with
// an IntersectionObserver, and a column parked or sliding in from off-screen
// reads as overflowing (a » shows for ~80 ms on every reveal, the gear is
// missing until the end). The observer is replaced by one
// that ignores readings while the column is not wholly inside the window,
// and re-reads the tools once it is.
//
// Loaded into each browser window by omafire.cfg.
(function () {
  "use strict";
  if (window.OmafireCompact) {
    return;
  }
  window.OmafireCompact = {};

  const root = document.documentElement;
  const COLUMN = new Set(["navigator-toolbox", "sidebar-container"]);
  const open = new Set();

  // Up through shadow roots too: the sidebar's tools live in one.
  function inColumn(node) {
    for (let n = node; n; n = n.parentNode || n.host) {
      if (COLUMN.has(n.id)) {
        return true;
      }
    }
    return false;
  }

  function inTools(node) {
    for (let n = node; n; n = n.parentNode || n.host) {
      if (n.host?.localName === "sidebar-main") {
        return true;
      }
    }
    return false;
  }

  window.addEventListener("popupshown", event => {
    const popup = event.target;
    if (!["menupopup", "panel"].includes(popup.localName)
        || !inColumn(popup.triggerNode || popup.anchorNode)) {
      return;
    }
    open.add(popup);
    root.toggleAttribute("omafire-column-popup", true);
  }, true);

  window.addEventListener("popuphidden", event => {
    if (open.delete(event.target)) {
      root.toggleAttribute("omafire-column-popup", open.size > 0);
    }
  }, true);

  // On focusout the old element still holds focus; read it once settled.
  function syncFocus() {
    const fm = Services.focus;
    const el = fm.focusedElement;
    root.toggleAttribute("omafire-tools-focus", el?.ownerDocument === document
      && inTools(el) && !(fm.getLastFocusMethod(window) & fm.FLAG_BYMOUSE));
  }
  for (const type of ["focusin", "focusout"]) {
    window.addEventListener(type, () => Promise.resolve().then(syncFocus), true);
  }

  // ---- sidebar tools: no overflow readings while the column is off-screen ----
  function guardToolsObserver(sidebarMain) {
    if (typeof sidebarMain.createToolsObservers !== "function") {
      return;               // Firefox changed it: leave the native behaviour
    }
    const NativeObserver = window.IntersectionObserver;
    let watching = false;
    const inView = () => {
      const r = sidebarMain.getBoundingClientRect();
      return r.width > 0 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
    };
    function settle() {
      if (watching) {
        return;
      }
      watching = true;
      const tick = () => {
        if (!inView()) {
          window.requestAnimationFrame(tick);
          return;
        }
        watching = false;
        sidebarMain.requestUpdate();   // observe the tools again: fresh readings
      };
      window.requestAnimationFrame(tick);
    }
    sidebarMain._toolsIntersectionObserver?.disconnect();
    sidebarMain._toolsResizeObserver?.disconnect();
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback, options) {
        super((entries, observer) => {
          if (inView()) {
            callback(entries, observer);
          } else {
            settle();
          }
        }, options);
      }
    };
    try {
      sidebarMain.createToolsObservers();
    } finally {
      window.IntersectionObserver = NativeObserver;
    }
    sidebarMain.requestUpdate();
  }

  function withSidebarMain(fn) {
    const find = () => document.querySelector("sidebar-main");
    const el = find();
    if (el) {
      fn(el);
      return;
    }
    const topic = "browser-delayed-startup-finished";
    const observer = {
      observe(subject) {
        if (subject === window) {
          Services.obs.removeObserver(observer, topic);
          const late = find();
          if (late) {
            fn(late);
          }
        }
      },
    };
    Services.obs.addObserver(observer, topic);
  }
  withSidebarMain(guardToolsObserver);
})();
