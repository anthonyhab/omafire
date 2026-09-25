"use strict";

(function startNewTab() {
  const STORAGE_KEY = "storedTheme";
  const SETTINGS_KEY = "newtab";
  /* The last palette and settings, cached synchronously so the first frame
   * is already right; storage.local is async and would flash defaults. */
  const CACHE_KEY = "omafox-newtab-palette";
  const SETTINGS_CACHE_KEY = "omafox-newtab-settings";
  const { readableTextColor } = globalThis.OmafoxTheme;
  const Wallpaper = globalThis.OmafoxWallpaper;
  const root = document.documentElement;

  const DEFAULTS = {
    background: "wallpaper", // solid | wallpaper | custom | desktop
    blur: 24,
    dim: 55,
    tint: 0, // desktop's dim: the window glass already tints it
    glass: true,
    clock: true,
    hour12: false,
    seconds: false,
    date: true,
    greeting: false,
    name: "",
    sites: true,
    siteStyle: "tiles", // tiles | list | icons
    siteCount: 12,
    numbers: true,
    hosts: true,
    align: "top", // top | center
    width: "normal", // normal | wide
    custom: [], // [{ url, title }]
    pinned: [], // [{ url, title }], dragged into place; they lead the grid
    hidden: [] // urls
  };

  let settings = { ...DEFAULTS };

  /* ---- palette ------------------------------------------------------ */

  function paletteVars(palette) {
    return {
      "--bg": palette.background,
      "--surface": palette.dark_background,
      "--fg": readableTextColor(palette.background, palette.foreground, [
        palette.light_foreground,
        palette.bright_foreground,
        palette.dark_foreground
      ]),
      "--strong": readableTextColor(palette.background, palette.bright_foreground, [
        palette.foreground,
        palette.light_foreground
      ]),
      "--accent": palette.accent,
      "color-scheme": palette.mode
    };
  }

  function applyVars(vars) {
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  }

  function applyRecord(record) {
    if (!record?.palette) return;
    try {
      const vars = paletteVars(record.palette);
      applyVars(vars);
      localStorage.setItem(CACHE_KEY, JSON.stringify(vars));
    } catch (error) {
      console.error("Omafox new tab could not apply the palette", error);
    }
  }

  function readCache(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  const cachedPalette = readCache(CACHE_KEY);
  if (cachedPalette) applyVars(cachedPalette);

  /* ---- settings ----------------------------------------------------- */

  function normalize(stored) {
    const next = { ...DEFAULTS };
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      const value = stored?.[key];
      if (Array.isArray(fallback) ? Array.isArray(value) : typeof value === typeof fallback) {
        next[key] = value;
      }
    }
    return next;
  }

  function applySettings() {
    const d = root.dataset;
    d.background = settings.background;
    d.siteStyle = settings.siteStyle;
    d.align = settings.align;
    d.width = settings.width;
    d.glass = settings.glass;
    d.numbers = settings.numbers;
    d.hosts = settings.hosts;
    root.style.setProperty("--blur", `${settings.blur}px`);
    root.style.setProperty("--dim", `${settings.background === "desktop" ? settings.tint : settings.dim}%`);
    document.querySelector("#time").hidden = !settings.clock && !settings.greeting;
    clock.hidden = !settings.clock;
    greeting.hidden = !settings.greeting;
    date.hidden = !settings.date;
    sites.hidden = !settings.sites;
    tick();
    void loadBackdrop();
    void loadSites();
    renderForm();
  }

  let saveTimer = null;
  function save(patch) {
    settings = { ...settings, ...patch };
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
    applySettings();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void browser.storage.local.set({ [SETTINGS_KEY]: settings });
    }, 150);
  }

  /* ---- clock -------------------------------------------------------- */

  const clock = document.querySelector("#clock");
  const date = document.querySelector("#date");
  const greeting = document.querySelector("#greeting");
  let tickTimer = null;

  function tick() {
    clearTimeout(tickTimer);
    const now = new Date();
    clock.textContent = now.toLocaleTimeString([], {
      hour: settings.hour12 ? "numeric" : "2-digit",
      minute: "2-digit",
      second: settings.seconds ? "2-digit" : undefined,
      hourCycle: settings.hour12 ? "h12" : "h23"
    });
    clock.dateTime = now.toISOString();
    date.textContent = now
      .toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })
      .replace(/,/g, "");
    const hour = now.getHours();
    const part = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    const name = settings.name.trim();
    greeting.textContent = `Good ${part}${name ? `, ${name}` : ""}`;
    const unit = settings.seconds ? 1000 : 60000;
    tickTimer = setTimeout(tick, unit - (now.getTime() % unit));
  }

  /* ---- backdrop ----------------------------------------------------- */

  const backdrop = document.querySelector("#backdrop");
  let backdropUrl = null;
  let backdropKey = null;

  async function loadBackdrop() {
    const source = settings.background === "custom" ? Wallpaper.CUSTOM
      : settings.background === "wallpaper" ? Wallpaper.OMARCHY
      : null;
    let record = null;
    try {
      record = source ? await Wallpaper.read(source) : null;
    } catch (error) {
      console.error("Omafox new tab could not read the wallpaper", error);
    }
    const key = record ? `${source}:${record.id}` : null;
    if (root.dataset.backdrop !== String(Boolean(record))) {
      root.dataset.backdrop = Boolean(record);
      renderForm();
    }
    if (key === backdropKey) return;
    backdropKey = key;
    if (backdropUrl) URL.revokeObjectURL(backdropUrl);
    backdropUrl = null;
    backdrop.classList.remove("ready");
    backdrop.style.backgroundImage = "";
    if (!record) return;
    backdropUrl = URL.createObjectURL(record.blob);
    const image = new Image();
    image.src = backdropUrl;
    try {
      await image.decode();
    } catch {
      return;
    }
    if (backdropKey !== key) return;
    backdrop.style.backgroundImage = `url("${backdropUrl}")`;
    backdrop.classList.add("ready");
  }

  /* ---- shortcuts ---------------------------------------------------- */

  const sites = document.querySelector("#sites");

  function hostOf(url) {
    try {
      return new URL(url).host.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  function tile(site, index) {
    const item = document.createElement("div");
    item.className = "site";

    const link = document.createElement("a");
    link.href = site.url;
    const host = hostOf(site.url);
    link.title = `${site.title || host}\n${site.url}`;

    let icon;
    if (site.favicon) {
      icon = document.createElement("img");
      icon.src = site.favicon;
      icon.alt = "";
    } else {
      icon = document.createElement("span");
      icon.textContent = host.charAt(0);
      icon.classList.add("letter");
    }
    icon.classList.add("icon");

    /* Only the tiles a digit key opens are numbered. */
    const number = document.createElement("span");
    number.className = "index";
    if (index < 9) number.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = site.title || host;

    const hostLabel = document.createElement("span");
    hostLabel.className = "host";
    hostLabel.textContent = host;

    link.append(icon, number, title, hostLabel);

    const hide = document.createElement("button");
    hide.type = "button";
    hide.className = "hide";
    hide.title = site.custom ? "Remove shortcut" : "Hide shortcut";
    hide.textContent = "×";
    hide.addEventListener("click", () => {
      const pinned = settings.pinned.filter((entry) => entry.url !== site.url);
      if (site.custom) {
        save({ pinned, custom: settings.custom.filter((entry) => entry.url !== site.url) });
      } else {
        save({ pinned, hidden: [...settings.hidden, site.url] });
      }
    });

    item.append(link, hide);
    item.dataset.url = site.url;
    item.draggable = true;
    return item;
  }

  let sitesRequest = 0;
  async function loadSites() {
    const request = ++sitesRequest;
    if (!settings.sites) {
      sites.replaceChildren();
      return;
    }
    /* newtab: true is Firefox's own shortcut list (pinned first); it is
     * empty while Firefox's shortcuts feed is off, so fall back to
     * frecency. Ask for extra so hidden ones leave no gaps. */
    const limit = settings.siteCount + settings.hidden.length + settings.custom.length
      + settings.pinned.length;
    let list = [];
    try {
      list = await browser.topSites.get({ newtab: true, includeFavicon: true, limit });
    } catch {
      /* older API shape */
    }
    if (!list.length) {
      list = await browser.topSites.get({ includeFavicon: true, limit });
    }
    if (request !== sitesRequest) return;
    const hidden = new Set(settings.hidden);
    const seen = new Set();
    const custom = new Set(settings.custom.map((site) => site.url));
    const merged = [
      ...settings.pinned.map((site) => ({ ...site, custom: custom.has(site.url) })),
      ...settings.custom.map((site) => ({ ...site, custom: true })),
      ...list
    ]
      .filter((site) => {
        if (hidden.has(site.url) || seen.has(site.url)) return false;
        seen.add(site.url);
        return true;
      })
      .slice(0, settings.siteCount);
    /* Custom shortcuts get the favicon Firefox already knows, if any. */
    const known = new Map(list.map((site) => [site.url, site.favicon]));
    for (const site of merged) site.favicon ??= known.get(site.url);
    shownSites = merged;
    sites.replaceChildren(...merged.map(tile));
    fitGrid();
  }

  /* Tiles fill whole rows: as few rows as the width allows, then as few
   * columns as still hold every tile, so 12 tiles that would run 9 + 3
   * sit as 6 + 6. Icons keep their fixed square. */
  const TILE_MIN = { tiles: 22, list: 44, icons: 10 }; // in --u
  function fitGrid() {
    const count = sites.children.length;
    if (!count) return;
    const unit = parseFloat(getComputedStyle(root).getPropertyValue("--u")) || 8;
    const min = TILE_MIN[settings.siteStyle] * unit;
    const fit = Math.max(1, Math.floor((sites.clientWidth - 2 + 1) / (min + 1)));
    const rows = Math.ceil(count / fit);
    const columns = Math.ceil(count / rows);
    sites.style.setProperty("--columns", String(columns));
  }
  new ResizeObserver(fitGrid).observe(sites);

  /* ---- reordering ----------------------------------------------------
   * Dragging a tile onto another moves it there and pins every tile up to
   * the further of the two spots, so the order holds while Firefox's own
   * ranking keeps filling the tiles after them. */

  let shownSites = [];
  let dragged = null;

  sites.addEventListener("dragstart", (event) => {
    const item = event.target.closest?.(".site");
    if (!item) return;
    dragged = item;
    item.classList.add("dragging");
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/uri-list", item.dataset.url);
    event.dataTransfer.setData("text/plain", item.dataset.url);
  });

  sites.addEventListener("dragover", (event) => {
    const target = event.target.closest?.(".site");
    if (!dragged || !target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    for (const item of sites.querySelectorAll(".drop-target")) {
      if (item !== target) item.classList.remove("drop-target");
    }
    if (target !== dragged) target.classList.add("drop-target");
  });

  sites.addEventListener("drop", (event) => {
    const target = event.target.closest?.(".site");
    if (!dragged || !target) return;
    event.preventDefault();
    const items = [...sites.children];
    const from = items.indexOf(dragged);
    const to = items.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const order = [...shownSites];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    save({
      pinned: order.slice(0, Math.max(from, to) + 1).map(({ url, title }) => ({ url, title }))
    });
  });

  sites.addEventListener("dragend", () => {
    dragged?.classList.remove("dragging");
    dragged = null;
    for (const item of sites.querySelectorAll(".drop-target")) item.classList.remove("drop-target");
  });

  /* ---- settings panel ----------------------------------------------- */

  const panel = document.querySelector("#settings");
  const form = document.querySelector("#settings-form");
  const toggleButton = document.querySelector("#settings-toggle");

  /* Every control is a row of this schema; `when` hides rows that don't
   * apply to the current settings. */
  const SCHEMA = [
    ["Background", [
      { key: "background", type: "choice", label: "Source", wide: true,
        options: [["solid", "Solid"], ["desktop", "Desktop"], ["wallpaper", "Wallpaper"], ["custom", "Image"]] },
      { type: "file", label: "Image", when: (s) => s.background === "custom" },
      { key: "blur", type: "range", label: "Blur", min: 0, max: 48, unit: "px",
        when: (s) => s.background === "wallpaper" || s.background === "custom" },
      { key: "dim", type: "range", label: "Dim", min: 0, max: 90, unit: "%",
        when: (s) => s.background === "wallpaper" || s.background === "custom" },
      { key: "tint", type: "range", label: "Tint", min: 0, max: 90, unit: "%",
        when: (s) => s.background === "desktop" },
      { type: "note", label: "", text: "Glass chrome shows the desktop",
        when: (s) => s.background === "desktop" },
      { type: "note", label: "", text: "No wallpaper from Omarchy yet",
        when: (s) => s.background === "wallpaper" && root.dataset.backdrop !== "true" },
      { key: "glass", type: "toggle", label: "Glass", when: (s) => s.background !== "solid" }
    ]],
    ["Clock", [
      { key: "clock", type: "toggle", label: "Clock" },
      { key: "hour12", type: "choice", label: "Format", options: [[false, "24h"], [true, "12h"]],
        when: (s) => s.clock },
      { key: "seconds", type: "toggle", label: "Seconds", when: (s) => s.clock },
      { key: "date", type: "toggle", label: "Date" },
      { key: "greeting", type: "toggle", label: "Greeting" },
      { key: "name", type: "text", label: "Name", placeholder: "optional", when: (s) => s.greeting }
    ]],
    ["Shortcuts", [
      { key: "sites", type: "toggle", label: "Shortcuts" },
      { key: "siteStyle", type: "choice", label: "Style",
        options: [["tiles", "Tiles"], ["list", "List"], ["icons", "Icons"]], when: (s) => s.sites },
      { key: "siteCount", type: "range", label: "Count", min: 4, max: 24, unit: "", when: (s) => s.sites },
      { key: "numbers", type: "toggle", label: "Numbers", when: (s) => s.sites },
      { key: "hosts", type: "toggle", label: "Addresses", when: (s) => s.sites && s.siteStyle !== "icons" },
      { type: "add-site", label: "Add", when: (s) => s.sites },
      { type: "restore", label: "Hidden", when: (s) => s.sites && s.hidden.length > 0 },
      { type: "unpin", label: "Order", when: (s) => s.sites && s.pinned.length > 0 }
    ]],
    ["Layout", [
      { key: "align", type: "choice", label: "Position", options: [["top", "Top"], ["center", "Center"]] },
      { key: "width", type: "choice", label: "Width", options: [["normal", "Normal"], ["wide", "Wide"]] },
      { type: "reset", label: "Reset" }
    ]]
  ];

  function row(label, ...controls) {
    const element = document.createElement("div");
    element.className = "row";
    const name = document.createElement("span");
    name.className = "row-label";
    name.textContent = label;
    const body = document.createElement("div");
    body.className = "row-body";
    body.append(...controls);
    element.append(name, body);
    return element;
  }

  function button(text, onClick, className = "") {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    if (className) element.className = className;
    element.addEventListener("click", onClick);
    return element;
  }

  const builders = {
    choice(field) {
      const group = document.createElement("div");
      group.className = "choice";
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", field.label);
      for (const [value, text] of field.options) {
        const option = button(text, () => save({ [field.key]: value }));
        option.setAttribute("role", "radio");
        option.setAttribute("aria-checked", String(settings[field.key] === value));
        group.append(option);
      }
      const element = row(field.label, group);
      element.classList.toggle("wide", Boolean(field.wide));
      return element;
    },
    toggle(field) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "switch";
      input.checked = settings[field.key];
      input.setAttribute("aria-label", field.label);
      input.addEventListener("change", () => save({ [field.key]: input.checked }));
      return row(field.label, input);
    },
    range(field) {
      const input = document.createElement("input");
      input.type = "range";
      input.min = field.min;
      input.max = field.max;
      input.value = settings[field.key];
      input.setAttribute("aria-label", field.label);
      const output = document.createElement("output");
      output.textContent = `${settings[field.key]}${field.unit}`;
      input.addEventListener("input", () => {
        output.textContent = `${input.value}${field.unit}`;
        save({ [field.key]: Number(input.value) });
      });
      return row(field.label, input, output);
    },
    text(field) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = settings[field.key];
      input.placeholder = field.placeholder || "";
      input.setAttribute("aria-label", field.label);
      input.addEventListener("input", () => save({ [field.key]: input.value }));
      return row(field.label, input);
    },
    file(field) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.hidden = true;
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        await Wallpaper.write(Wallpaper.CUSTOM, { id: `${file.name}-${file.size}-${file.lastModified}`, blob: file });
        backdropKey = null;
        void loadBackdrop();
      });
      return row(field.label, input, button("Choose…", () => input.click()));
    },
    "add-site"(field) {
      const url = document.createElement("input");
      url.type = "text";
      url.placeholder = "example.com";
      url.setAttribute("aria-label", "Shortcut address");
      const add = () => {
        let value = url.value.trim();
        if (!value) return;
        if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
        try {
          value = new URL(value).href;
        } catch {
          url.setCustomValidity("Not an address");
          url.reportValidity();
          return;
        }
        save({
          custom: [...settings.custom.filter((site) => site.url !== value), { url: value, title: hostOf(value) }],
          hidden: settings.hidden.filter((hidden) => hidden !== value)
        });
      };
      url.addEventListener("input", () => url.setCustomValidity(""));
      url.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          add();
        }
      });
      return row(field.label, url, button("Add", add));
    },
    note(field) {
      const text = document.createElement("p");
      text.className = "note";
      text.textContent = field.text;
      const element = row(field.label, text);
      element.classList.add("wide");
      return element;
    },
    restore(field) {
      const count = settings.hidden.length;
      return row(field.label, button(`Restore ${count}`, () => save({ hidden: [] })));
    },
    unpin(field) {
      return row(field.label, button("Unpin", () => save({ pinned: [] })));
    },
    reset(field) {
      return row(field.label, button("Defaults", () => save({ ...DEFAULTS })));
    }
  };

  function renderForm() {
    if (panel.hidden) return;
    /* Re-rendering replaces the focused control; keep focus on the same
     * row so typing and keyboard use carry on. */
    const focused = document.activeElement;
    const focusPath = form.contains(focused)
      ? [[...form.querySelectorAll("input, button")].indexOf(focused), focused.type]
      : null;
    const selection = focused?.selectionStart;
    form.replaceChildren(...SCHEMA.map(([title, fields]) => {
      const section = document.createElement("section");
      const heading = document.createElement("h2");
      heading.textContent = title;
      section.append(heading, ...fields
        .filter((field) => !field.when || field.when(settings))
        .map((field) => builders[field.type](field)));
      return section;
    }));
    if (focusPath) {
      const target = [...form.querySelectorAll("input, button")][focusPath[0]];
      if (target && target.type === focusPath[1]) {
        target.focus();
        if (typeof selection === "number" && target.setSelectionRange && target.type === "text") {
          target.setSelectionRange(selection, selection);
        }
      }
    }
  }

  function setPanel(open) {
    panel.hidden = !open;
    toggleButton.setAttribute("aria-expanded", String(open));
    root.dataset.settings = open;
    if (open) {
      renderForm();
      form.querySelector("button, input")?.focus();
    } else if (panel.contains(document.activeElement)) {
      toggleButton.focus();
    }
  }

  toggleButton.addEventListener("click", () => setPanel(panel.hidden));
  document.querySelector("#settings-close").addEventListener("click", () => setPanel(false));
  form.addEventListener("submit", (event) => event.preventDefault());

  /* ---- keys --------------------------------------------------------- */

  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape" && !panel.hidden) {
      setPanel(false);
      return;
    }
    if (event.target.closest?.("input, textarea")) return;
    if (event.key === ",") {
      event.preventDefault();
      setPanel(panel.hidden);
      return;
    }
    /* Digits open the matching shortcut while the page has focus. */
    if (/^[1-9]$/.test(event.key)) {
      sites.children[Number(event.key) - 1]?.querySelector("a")?.click();
    }
  });

  /* ---- start -------------------------------------------------------- */

  settings = normalize(readCache(SETTINGS_CACHE_KEY));
  applySettings();

  browser.storage.local.get([STORAGE_KEY, SETTINGS_KEY]).then((result) => {
    applyRecord(result[STORAGE_KEY]);
    const stored = normalize(result[SETTINGS_KEY]);
    if (JSON.stringify(stored) !== JSON.stringify(settings)) {
      settings = stored;
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
      applySettings();
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]?.newValue) applyRecord(changes[STORAGE_KEY].newValue);
    if (changes[Wallpaper.ID_KEY]) {
      backdropKey = null;
      void loadBackdrop();
    }
    /* Another new tab saved: follow it, unless this one is mid-edit. */
    if (changes[SETTINGS_KEY]?.newValue && !form.contains(document.activeElement)) {
      settings = normalize(changes[SETTINGS_KEY].newValue);
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
      applySettings();
    }
  });
})();
