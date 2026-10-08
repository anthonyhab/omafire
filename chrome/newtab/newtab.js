"use strict";

/* Omafire new tab: chrome://omafire/content/newtab.html, which newtab.uc.js
 * makes the new tab page. A privileged page (as about:preferences is), so
 * it reads what it needs itself: settings from a pref, shortcuts from
 * Firefox's top sites, the Omarchy wallpaper from its file. Page text
 * (titles, addresses) is only ever set as text. */
(function startNewTab() {
  const SETTINGS_PREF = "omafire.newtab.settings";
  /* The last shortcuts shown, so the grid is whole on the first frame
   * instead of arriving after the async top sites query. */
  const SITES_CACHE_PREF = "omafire.newtab.sites-cache";
  /* A picked image is copied into the profile. */
  const CUSTOM_FILE = PathUtils.join(PathUtils.profileDir, "omafire-newtab-image");
  /* Omarchy's current wallpaper link, newest layout first. */
  const WALLPAPERS = [".local/state/omarchy/current/background", ".config/omarchy/current/background"]
    .map((path) => PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, ...path.split("/")));
  const { NewTabUtils } = ChromeUtils.importESModule("resource://gre/modules/NewTabUtils.sys.mjs");
  const prefs = Services.prefs;
  const root = document.documentElement;
  /* A private window's new tab shows no history and keeps nothing. */
  const isPrivate = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs")
    .PrivateBrowsingUtils.isContentWindowPrivate(window);

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

  /* Glass chrome is the one case where Desktop shows the desktop; there it
   * is the default. */
  const glass = prefs.getBoolPref("omafire.translucency", false);
  if (glass) DEFAULTS.background = "desktop";

  let settings = { ...DEFAULTS };

  /* ---- palette ------------------------------------------------------
   * The colours come from the generated palette's --omarchy-* (newtab.css);
   * text is the first palette ink that holds 4.5:1 on the background. */

  function luminance(hex) {
    const m = /^#([0-9a-f]{6})/i.exec(hex.trim());
    if (!m) return null;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [la, lb] = [luminance(a), luminance(b)];
    if (la === null || lb === null) return 0;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function readableTextColor(background, candidates) {
    const found = candidates.find((c) => c && contrast(background, c) >= 4.5);
    if (found) return found;
    return contrast(background, "#000000") >= contrast(background, "#ffffff") ? "#000000" : "#ffffff";
  }

  function applyPalette() {
    const style = getComputedStyle(root);
    const color = (key) => style.getPropertyValue(`--omarchy-${key}`).trim();
    const background = color("background");
    if (!background) return;
    root.style.setProperty("--fg", readableTextColor(background,
      ["foreground", "light_foreground", "bright_foreground", "dark_foreground"].map(color)));
    root.style.setProperty("--strong", readableTextColor(background,
      ["bright_foreground", "foreground", "light_foreground"].map(color)));
    root.style.setProperty("color-scheme", luminance(background) > 0.5 ? "light" : "dark");
  }

  applyPalette();

  function readPref(name) {
    try {
      return JSON.parse(prefs.getStringPref(name, "null"));
    } catch {
      return null;
    }
  }

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

  /* Every new tab follows the pref; the one saving knows it already. */
  let saving = false;
  function save(patch) {
    settings = { ...settings, ...patch };
    saving = true;
    try {
      prefs.setStringPref(SETTINGS_PREF, JSON.stringify(settings));
    } finally {
      saving = false;
    }
    applySettings();
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
  let backdropKey = null;

  /* The image file behind the current source and a key that changes with
   * it (Omarchy swaps the link; a new pick rewrites the copy). */
  async function backdropFile() {
    const candidates = settings.background === "custom" ? [CUSTOM_FILE]
      : settings.background === "wallpaper" ? WALLPAPERS
      : [];
    for (const path of candidates) {
      try {
        const stat = await IOUtils.stat(path);
        if (stat.type !== "regular") continue;
        return { path, id: `${path}:${stat.size}:${stat.lastModified}` };
      } catch {
        /* missing, or a dangling link */
      }
    }
    return null;
  }

  async function loadBackdrop() {
    const record = await backdropFile();
    const key = record?.id ?? null;
    if (root.dataset.backdrop !== String(Boolean(record))) {
      root.dataset.backdrop = Boolean(record);
      renderForm();
    }
    if (key === backdropKey) return;
    backdropKey = key;
    backdrop.classList.remove("ready");
    backdrop.style.backgroundImage = "";
    if (!record) return;
    /* The query string makes a changed file a new image, not a cached one. */
    const backdropUrl = `${PathUtils.toFileURI(record.path)}?${encodeURIComponent(key)}`;
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
    if (!settings.sites || isPrivate) {
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
      list = (await NewTabUtils.activityStreamLinks.getTopSites({ numItems: limit, includeFavicon: true }))
        .map((link) => ({ url: link.url, title: link.label || link.title || "", favicon: link.favicon || null }));
    } catch (error) {
      console.error("[omafire:newtab] top sites:", error);
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
    showSites(merged);
    prefs.setStringPref(SITES_CACHE_PREF, JSON.stringify(merged.map(({ url, title, custom }) => ({ url, title, custom }))));
  }

  function showSites(list) {
    const focused = sites.contains(document.activeElement)
      ? [...sites.children].findIndex((item) => item.contains(document.activeElement))
      : -1;
    shownSites = list;
    sites.replaceChildren(...list.map(tile));
    fitGrid();
    sites.children[focused]?.querySelector("a")?.focus();
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
      { type: "note", label: "", text: "Turn on glass chrome to see the desktop",
        when: (s) => s.background === "desktop" && !glass },
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
        await IOUtils.write(CUSTOM_FILE, new Uint8Array(await file.arrayBuffer()), { tmpPath: `${CUSTOM_FILE}.tmp` });
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
    /* Arrows walk the grid; from nowhere they start at the first tile. */
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: "up", ArrowDown: "down" }[event.key];
    if (step !== undefined && settings.sites && sites.children.length
        && !panel.contains(event.target)) {
      const items = [...sites.children];
      const current = items.findIndex((item) => item.contains(document.activeElement));
      const columns = Number(sites.style.getPropertyValue("--columns")) || 1;
      const delta = step === "up" ? -columns : step === "down" ? columns : step;
      const next = current < 0 ? 0 : current + delta;
      if (items[next]) {
        event.preventDefault();
        items[next].querySelector("a").focus();
      }
      return;
    }
    /* Digits open the matching shortcut while the page has focus. */
    if (/^[1-9]$/.test(event.key)) {
      sites.children[Number(event.key) - 1]?.querySelector("a")?.click();
    }
  });

  /* ---- start -------------------------------------------------------- */

  settings = normalize(readPref(SETTINGS_PREF));
  const cachedSites = readPref(SITES_CACHE_PREF);
  if (settings.sites && !isPrivate && Array.isArray(cachedSites)) showSites(cachedSites);
  applySettings();

  /* Another new tab saved: follow it, unless this one is mid-edit. */
  const onSettings = () => {
    if (saving || form.contains(document.activeElement)) return;
    settings = normalize(readPref(SETTINGS_PREF));
    applySettings();
  };
  /* A theme switch: the palette sheet changes first (live-palette.uc.js). */
  let paletteTimer = null;
  const onPalette = () => {
    clearTimeout(paletteTimer);
    paletteTimer = setTimeout(applyPalette, 300);
  };
  const onWallpaper = () => void loadBackdrop();
  prefs.addObserver(SETTINGS_PREF, onSettings);
  Services.obs.addObserver(onPalette, "omafire-palette-changed");
  Services.obs.addObserver(onWallpaper, "omafire-wallpaper-changed");
  /* A preloaded or background tab catches up when shown. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    applyPalette();
    void loadBackdrop();
    void loadSites();
  });
  window.addEventListener("unload", () => {
    prefs.removeObserver(SETTINGS_PREF, onSettings);
    Services.obs.removeObserver(onPalette, "omafire-palette-changed");
    Services.obs.removeObserver(onWallpaper, "omafire-wallpaper-changed");
  }, { once: true });
})();
