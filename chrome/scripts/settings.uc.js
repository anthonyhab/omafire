// Omafox settings: an "Omarchy" panel in the app menu for every theme mode.
//
// Every control is a pref. The theme reads them with @media -moz-pref(),
// so a change repaints at once and each one still works from about:config
// without this script. Loaded into each browser window by omafox.cfg.
(function () {
  "use strict";
  if (window.OmafoxSettings) {
    return;
  }

  const HTML = "http://www.w3.org/1999/xhtml";
  const VIEW_ID = "omafox-settings-view";
  const BUTTON_ID = "appMenu-omafox-button";
  const prefs = Services.prefs;

  // ---- the pref model ----------------------------------------------------

  const get = (name, fallback) => {
    switch (prefs.getPrefType(name)) {
      case prefs.PREF_BOOL: return prefs.getBoolPref(name);
      case prefs.PREF_INT: return prefs.getIntPref(name);
      case prefs.PREF_STRING: return prefs.getStringPref(name);
      default: return fallback;
    }
  };
  const set = (name, value) => {
    if (typeof value === "boolean") {
      prefs.setBoolPref(name, value);
    } else if (typeof value === "number") {
      prefs.setIntPref(name, value);
    } else {
      prefs.setStringPref(name, value);
    }
  };

  const layout = () => get("omarchy.layout", "top") === "sidebar" ? "sidebar" : "top";
  const vertical = () => get("sidebar.verticalTabs", false);
  const zen = () => get("omarchy.zen-mode", false) && get("omarchy.zen-mode-active", false);
  const glassAlpha = () => {
    const v = Number.parseFloat(get("omarchy.transparency", "0.85"));
    return Number.isFinite(v) && v >= 0.5 && v <= 1 ? v : 0.85;
  };

  // Rows in order. `when` greys a row out where the theme ignores it.
  const ROWS = [
    {heading: "Layout"},
    {
      label: "Toolbar", kind: "choice", prefs: ["omarchy.layout"],
      options: [["top", "Top"], ["sidebar", "Sidebar"]],
      read: layout, write: v => set("omarchy.layout", v), moves: true,
    },
    {
      label: "Tabs", kind: "choice", prefs: ["sidebar.verticalTabs"],
      options: [[true, "Vertical"], [false, "Horizontal"]],
      read: vertical, write: v => set("sidebar.verticalTabs", v), moves: true,
    },
    {
      label: "Side", kind: "choice", prefs: ["sidebar.position_start"],
      options: [[true, "Left"], [false, "Right"]],
      read: () => get("sidebar.position_start", true),
      write: v => set("sidebar.position_start", v), moves: true,
      when: vertical,
      hint: "With vertical tabs.",
    },
    {
      label: "Launcher", kind: "choice", prefs: ["omarchy.launcher"],
      options: [["drop", "Drop"], ["center", "Centred"]],
      read: () => get("omarchy.launcher", "drop") === "center" ? "center" : "drop",
      write: v => set("omarchy.launcher", v),
      when: () => layout() === "sidebar" || zen(),
      hint: "In the sidebar layout and zen mode.",
    },
    {
      label: "Density", kind: "choice", prefs: ["browser.uidensity"],
      options: [[0, "Normal"], [1, "Compact"]],
      read: () => get("browser.uidensity", 0) === 1 ? 1 : 0,
      write: v => set("browser.uidensity", v),
    },
    {heading: "Behaviour"},
    {
      label: "Zen mode", kind: "toggle",
      prefs: ["omarchy.zen-mode", "omarchy.zen-mode-active"],
      read: zen,
      write: v => {
        set("omarchy.zen-mode", true);
        set("omarchy.zen-mode-active", v);
      },
      when: () => layout() === "top",
      hint: "In the top toolbar layout.",
    },
    {
      label: "Compact sidebar", kind: "toggle", prefs: ["omarchy.compact"],
      read: () => get("omarchy.compact", false),
      write: v => set("omarchy.compact", v),
      when: () => layout() === "sidebar",
      hint: "In the sidebar layout.",
    },
    {
      label: "Floating page", kind: "toggle", prefs: ["omarchy.chrome-gap"],
      read: () => get("omarchy.chrome-gap", false),
      write: v => set("omarchy.chrome-gap", v),
      when: () => layout() === "top",
      hint: "Always, in the sidebar layout.",
    },
    {heading: "Look"},
    {
      label: "Glass", kind: "toggle", prefs: ["omarchy.translucency"],
      read: () => get("omarchy.translucency", false),
      write: v => set("omarchy.translucency", v),
    },
    {
      label: "Opacity", kind: "range", prefs: ["omarchy.transparency"],
      read: glassAlpha,
      write: v => set("omarchy.transparency", v.toFixed(2)),
      when: () => get("omarchy.translucency", false),
    },
    {
      label: "Tab numbers", kind: "toggle", prefs: ["omarchy.tab-numbers"],
      read: () => get("omarchy.tab-numbers", false),
      write: v => set("omarchy.tab-numbers", v),
    },
    {
      label: "Extension glyphs", kind: "toggle", prefs: ["omarchy.extension-glyphs"],
      read: () => get("omarchy.extension-glyphs", true),
      write: v => set("omarchy.extension-glyphs", v),
    },
  ];

  // ---- the panel ----------------------------------------------------------

  const STYLE = `
    /* An on toggle is the palette's accent, as on Firefox's Settings pages
     * under the theme. moz-toggle declares its colours on its :host, which
     * a rule on the element itself outranks. */
    #${VIEW_ID} moz-toggle {
      --toggle-background-color-pressed: var(--oc-accent-mark, AccentColor);
      --toggle-background-color-pressed-hover: var(--oc-accent-mark, AccentColor);
      --toggle-background-color-pressed-active: var(--oc-accent-mark, AccentColor);
      --toggle-dot-background-color-on-pressed: var(--oc-frame, Canvas);
      --focus-outline-color: var(--oc-focus, AccentColor);
    }
    #${VIEW_ID} .omafox-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 4px 8px 8px;
    }
    #${VIEW_ID} .omafox-heading {
      margin: 8px 0 0;
      font-weight: 600;
    }
    #${VIEW_ID} .omafox-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      column-gap: 12px;
      min-height: 32px;
    }
    #${VIEW_ID} .omafox-row[disabled] { opacity: 0.45; }
    /* A row's hint says why it is off, so it shows only then. */
    #${VIEW_ID} .omafox-hint {
      grid-column: 1 / -1;
      margin-top: -4px;
    }
    #${VIEW_ID} .omafox-row:not([disabled]) > .omafox-hint { display: none; }
    #${VIEW_ID} .omafox-seg {
      display: inline-flex;
      border: 1px solid var(--oc-line, color-mix(in srgb, currentColor 15%, transparent));
      border-radius: var(--oc-radius-small, 4px);
      overflow: hidden;
    }
    #${VIEW_ID} .omafox-seg > button {
      appearance: none;
      margin: 0;
      border: 0;
      padding: 4px 10px;
      background: transparent;
      color: inherit;
      font: inherit;
    }
    #${VIEW_ID} .omafox-seg > button + button {
      border-inline-start: 1px solid var(--oc-line, color-mix(in srgb, currentColor 15%, transparent));
    }
    #${VIEW_ID} .omafox-seg > button:hover {
      background: var(--oc-hover, color-mix(in srgb, currentColor 8%, transparent));
    }
    #${VIEW_ID} .omafox-seg > button[aria-pressed="true"] {
      /* A selection is a fill on the strong hairline, the theme's box
       * language: no accent bar. */
      background: var(--oc-selected, color-mix(in srgb, currentColor 12%, transparent));
      box-shadow: inset 0 0 0 1px var(--oc-line-strong, color-mix(in srgb, currentColor 30%, transparent));
    }
    #${VIEW_ID} .omafox-seg > button:focus-visible,
    #${VIEW_ID} input[type="range"]:focus-visible {
      outline: 1px solid var(--oc-focus, AccentColor);
      outline-offset: -1px;
    }
    #${VIEW_ID} .omafox-range {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    #${VIEW_ID} .omafox-range > input { width: 112px; margin: 0; }
    #${VIEW_ID} .omafox-range > output {
      min-width: 3ch;
      font-variant-numeric: tabular-nums;
      text-align: end;
    }
    #${VIEW_ID} .omafox-keys {
      margin: 8px 0 0;
      opacity: 0.62;
      white-space: pre-line;
    }
  `;

  function h(tag, attrs = {}, ...children) {
    const el = document.createElementNS(HTML, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) {
        el.setAttribute(k, v);
      }
    }
    el.append(...children);
    return el;
  }

  function loadStyle() {
    const uri = "data:text/css;charset=utf-8," + encodeURIComponent(STYLE);
    try {
      window.windowUtils.loadSheetUsingURIString(uri, window.windowUtils.AUTHOR_SHEET);
    } catch (error) {
      console.error("[omafox:settings] style", error);
    }
  }

  // Firefox's own toggle, so the panel matches its Settings page and the
  // theme's bridge for them.
  function loadToggle() {
    if (customElements.get("moz-toggle")) {
      return;
    }
    const script = h("script", {
      type: "module",
      src: "chrome://global/content/elements/moz-toggle.mjs",
    });
    document.documentElement.append(script);
  }

  const renderers = [];

  // Some settings move the app menu's button (toolbar, tabs, side). Firefox
  // cannot keep a panel open while its anchor is laid out again, so those
  // close the panel first, apply, and reopen it at the button's new place.
  async function apply(row, value) {
    const panel = PanelUI.panel;
    if (!row.moves || panel.state !== "open") {
      row.write(value);
      return;
    }
    const hidden = new Promise(r => panel.addEventListener("popuphidden", r, {once: true}));
    PanelUI.hide();
    await hidden;
    row.write(value);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await open();
  }

  function buildRow(row) {
    if (row.heading) {
      return h("h2", {class: "omafox-heading"}, row.heading);
    }
    const id = `omafox-${row.prefs[0].replace(/\W/g, "-")}`;
    const box = h("div", {class: "omafox-row"});
    const label = h("label", {id: `${id}-label`}, row.label);
    let control, render;

    if (row.kind === "toggle") {
      control = h("moz-toggle", {"aria-labelledby": `${id}-label`});
      control.addEventListener("toggle", () => apply(row, control.pressed));
      render = () => { control.pressed = row.read(); };
    } else if (row.kind === "choice") {
      control = h("div", {class: "omafox-seg", role: "group", "aria-labelledby": `${id}-label`});
      const buttons = row.options.map(([value, text]) => {
        const b = h("button", {type: "button"}, text);
        b.addEventListener("click", () => apply(row, value).catch(e => console.error("[omafox:settings]", e)));
        control.append(b);
        return [value, b];
      });
      render = () => {
        const current = row.read();
        for (const [value, b] of buttons) {
          b.setAttribute("aria-pressed", String(value === current));
        }
      };
    } else {
      const input = h("input", {
        type: "range", min: "0.50", max: "1.00", step: "0.01",
        "aria-labelledby": `${id}-label`,
      });
      const out = h("output");
      input.addEventListener("input", () => {
        out.value = Math.round(Number(input.value) * 100) + "%";
        row.write(Number(input.value));
      });
      control = h("span", {class: "omafox-range"}, input, out);
      render = () => {
        const v = row.read();
        input.value = String(v);
        out.value = Math.round(v * 100) + "%";
      };
    }

    box.append(label, control);
    if (row.hint) {
      box.append(h("span", {class: "omafox-hint"}, row.hint));
    }
    renderers.push(() => {
      render();
      const enabled = !row.when || row.when();
      box.toggleAttribute("disabled", !enabled);
      for (const el of control.querySelectorAll("button, input")) {
        el.disabled = !enabled;
      }
      if (control.localName === "moz-toggle") {
        control.disabled = !enabled;
      }
    });
    return box;
  }

  function keysText() {
    const keys = window.OmafoxKeys?.describe?.() ?? [];
    return keys.length ? "Shortcuts\n" + keys.join("\n") : "";
  }

  let view = null;
  function buildView() {
    if (view) {
      return view;
    }
    loadStyle();
    loadToggle();
    view = document.createXULElement("panelview");
    view.id = VIEW_ID;
    view.className = "PanelUI-subView";
    view.setAttribute("title", "Omarchy");
    const body = h("div", {class: "omafox-body"});
    for (const row of ROWS) {
      body.append(buildRow(row));
    }
    const keys = h("p", {class: "omafox-keys"});
    body.append(keys);
    renderers.push(() => { keys.textContent = keysText(); });

    const footer = document.createXULElement("vbox");
    footer.className = "panel-subview-body";
    const all = document.createXULElement("toolbarbutton");
    all.className = "subviewbutton";
    all.setAttribute("label", "All Omarchy preferences…");
    all.addEventListener("command", () => {
      PanelUI.hide();
      switchToTabHavingURI("about:config?filter=omarchy.", true);
    });
    footer.append(all);

    view.append(body, document.createXULElement("toolbarseparator"), footer);
    view.addEventListener("ViewShowing", renderAll);
    document.getElementById("appMenu-multiView").append(view);
    return view;
  }

  function renderAll() {
    for (const render of renderers) {
      render();
    }
  }

  // The app menu's main view is built from a template the first time the
  // menu opens; add the entry then, after Settings.
  function addMenuEntry() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }
    const settings = document.getElementById("appMenu-settings-button");
    if (!settings) {
      return;
    }
    const button = document.createXULElement("toolbarbutton");
    button.id = BUTTON_ID;
    button.className = "subviewbutton subviewbutton-nav";
    button.setAttribute("label", "Omarchy");
    button.setAttribute("closemenu", "none");
    button.addEventListener("command", () => {
      buildView();
      PanelUI.showSubView(VIEW_ID, button);
    });
    settings.after(button);
  }

  async function open() {
    buildView();
    const panel = PanelUI.panel;
    if (panel.state !== "open") {
      // A subview can only slide in once the main view has finished showing.
      const shown = new Promise(r => panel.addEventListener("ViewShown", r, {once: true}));
      PanelUI.show();
      await shown;
    }
    addMenuEntry();
    PanelUI.showSubView(VIEW_ID, document.getElementById(BUTTON_ID));
  }

  // Live: a keybinding, about:config or another window changes a pref
  // while the panel is open.
  const observer = {
    observe() {
      if (view) {
        renderAll();
      }
    },
  };
  const watched = new Set(ROWS.flatMap(r => r.prefs ?? []));
  for (const name of watched) {
    prefs.addObserver(name, observer);
  }

  const popup = document.getElementById("appMenu-popup");
  popup?.addEventListener("popupshowing", addMenuEntry);
  addMenuEntry();

  window.addEventListener("unload", () => {
    for (const name of watched) {
      prefs.removeObserver(name, observer);
    }
  }, {once: true});

  window.OmafoxSettings = {open, ROWS};
})();
