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
  /* 0.7.1 kept feed answers in this pref; now a file. */
  const OLD_CACHE_PREF = "omafire.newtab.widget-cache";
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
    clockStyle: "bold", // bold | thin | line
    hour12: false,
    seconds: false,
    date: true,
    greeting: false,
    name: "",
    sites: true,
    siteStyle: "tiles", // tiles | list | icons
    hover: "halftone", // halftone | scan | ascii: the light in a hovered tile
    siteCount: 12,
    hosts: true,
    align: "top", // top | center
    width: "normal", // normal | wide
    widgets: [{ type: "closed" }], // [{ type, option }], in order
    widgetPlace: "below", // below | beside
    tempUnit: "c", // c | f
    weatherHeader: true, // the weather widget reads as a line under the clock
    custom: [], // [{ url, title }]
    pinned: [], // [{ url, title }], dragged into place; they lead the grid
    edits: {}, // url -> { title, color, icon }: a shortcut's own name, colour and icon
    hidden: [] // urls
  };

  /* Glass chrome is the one case where Desktop shows the desktop; there it
   * is the default. */
  const glass = prefs.getBoolPref("omafire.translucency", false);
  if (glass) DEFAULTS.background = "desktop";

  let settings = { ...DEFAULTS };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

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

  /* Settings that take one of a few values; anything else falls back. */
  const CHOICES = {
    background: ["solid", "wallpaper", "custom", "desktop"],
    clockStyle: ["bold", "thin", "line"],
    siteStyle: ["tiles", "list", "icons"],
    hover: ["halftone", "scan", "ascii"],
    align: ["top", "center"],
    width: ["normal", "wide"],
    widgetPlace: ["below", "beside"],
    tempUnit: ["c", "f"]
  };
  const hasUrl = (entry) => typeof entry?.url === "string";

  function normalize(stored) {
    const next = { ...DEFAULTS };
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      const value = stored?.[key];
      if (CHOICES[key] ? CHOICES[key].includes(value)
        : Array.isArray(fallback) ? Array.isArray(value) : typeof value === typeof fallback && value !== null) {
        next[key] = value;
      }
    }
    next.pinned = next.pinned.filter(hasUrl);
    next.custom = next.custom.filter(hasUrl);
    next.widgets = next.widgets
      .filter((w) => w && typeof w === "object" && Object.hasOwn(WIDGETS, w.type))
      .map((w) => ({ type: w.type, option: typeof w.option === "string" ? w.option : "" }));
    if (Array.isArray(next.edits)) next.edits = {};
    return next;
  }

  /* Keys whose change needs the shortcuts or the widgets rebuilt; the
   * rest is styling (root data attributes) and the form. */
  const SITE_KEYS = ["sites", "siteCount", "hidden", "custom", "pinned", "edits"];
  const WIDGET_KEYS = ["widgets", "tempUnit"];

  function applySettings(changed = null) {
    const touches = (keys) => !changed || keys.some((key) => changed.includes(key));
    const d = root.dataset;
    d.background = settings.background;
    d.siteStyle = settings.siteStyle;
    d.align = settings.align;
    d.width = settings.width;
    d.glass = settings.glass;
    d.hosts = settings.hosts;
    d.widgetPlace = settings.widgetPlace;
    d.clockStyle = settings.clockStyle;
    d.weatherHeader = settings.weatherHeader;
    root.style.setProperty("--blur", `${settings.blur}px`);
    root.style.setProperty("--dim", `${settings.background === "desktop" ? settings.tint : settings.dim}%`);
    document.querySelector("#time").hidden = !settings.clock && !settings.greeting;
    clock.hidden = !settings.clock;
    greeting.hidden = !settings.greeting;
    date.hidden = !settings.date;
    sites.hidden = !settings.sites;
    tick();
    if (touches(["background"])) void loadBackdrop();
    if (touches(SITE_KEYS)) void loadSites();
    else fitGrid();
    if (touches(WIDGET_KEYS)) loadWidgets();
    else fitWidgets();
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
    applySettings(Object.keys(patch));
  }

  /* ---- clock -------------------------------------------------------- */

  const clock = document.querySelector("#clock");
  const date = document.querySelector("#date");
  const greeting = document.querySelector("#greeting");
  let tickTimer = null;

  /* Each glyph is its own span; a changed one rolls up into place. */
  function rollClock(text) {
    const glyphs = [...text];
    const old = [...clock.children];
    if (old.length !== glyphs.length) {
      clock.replaceChildren(...glyphs.map((glyph) => el("span", "glyph", glyph)));
      return;
    }
    glyphs.forEach((glyph, i) => {
      if (old[i].textContent === glyph) return;
      if (reduceMotion.matches) {
        old[i].textContent = glyph;
        return;
      }
      const fresh = el("span", "glyph roll", glyph);
      old[i].replaceWith(fresh);
      fresh.addEventListener("animationend", () => fresh.classList.remove("roll"), { once: true });
    });
  }

  function tick() {
    clearTimeout(tickTimer);
    const now = new Date();
    rollClock(now.toLocaleTimeString([], {
      hour: settings.hour12 ? "numeric" : "2-digit",
      minute: "2-digit",
      second: settings.seconds ? "2-digit" : undefined,
      hourCycle: settings.hour12 ? "h12" : "h23"
    }));
    clock.dateTime = now.toISOString();
    date.textContent = settings.clockStyle === "thin"
      ? now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }).replace(/,/g, " ·")
      : now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "");
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
  const tileList = () => [...sites.querySelectorAll(".site")];

  function hostOf(url) {
    try {
      return new URL(url).host.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  /* A tile's name: the page title without its unread count or bidi marks,
   * and of a title in parts ("Inbox (19) - me - Gmail", "OpenCode Go |
   * Low-cost…") the part that names the site, if one does. The tooltip
   * keeps the whole title. */
  function siteName(title, host) {
    const clean = title.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/^\(\d+\+?\)\s*/, "").replace(/\s*\(\d+\+?\)/g, "").trim();
    /* The host's names, the registrable one first: mail.google.com is
     * "google", then "mail" (which Gmail contains). */
    let labels = host.split(".");
    try {
      const suffix = Services.eTLD.getPublicSuffixFromHost(host);
      labels = host.slice(0, host.length - suffix.length - 1).split(".").reverse();
    } catch {}
    const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const names = labels.map(squash).filter((label) => label.length >= 3 && label !== "www");
    const parts = clean.split(/\s+[|\-\u2013\u2014\u00b7:]\s+|\.\s+/);
    if (parts.length > 1) {
      for (const name of names) {
        const named = parts.find((part) => squash(part).includes(name));
        if (named) return named;
      }
    }
    return clean;
  }

  /* A push pin, 16 units: the head, then the needle. */
  function pinIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 1h6v1.5l-1 1v3.5l2 2.5v1H4V9l2-2.5V3.5l-1-1zM7.25 10h1.5v5h-1.5z");
    svg.append(path);
    return svg;
  }

  /* A picked colour: a palette name ("blue"), which follows the theme, or
   * a hex. */
  function paletteColor(name) {
    if (!name) return "";
    if (name.startsWith("#")) return name;
    return getComputedStyle(root).getPropertyValue(`--omarchy-${name}`).trim();
  }

  /* The tile's icon: a Simple Icons brand mark, the site's favicon, or the
   * host's first letter. */
  function siteIcon(site, edit, host) {
    if (edit.icon?.path) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edit.icon.path);
      svg.append(path);
      svg.classList.add("brand");
      /* A brand mark too dark (or light) for the page takes the text colour. */
      const background = getComputedStyle(root).getPropertyValue("--omarchy-background").trim() || "#121212";
      const fill = paletteColor(edit.color) || `#${edit.icon.hex}`;
      svg.style.fill = contrast(background, fill) >= 2 ? fill : "var(--fg)";
      return svg;
    }
    if (site.favicon && edit.icon !== "letter") {
      const image = document.createElement("img");
      image.src = site.favicon;
      image.alt = "";
      return image;
    }
    return el("span", "letter", (edit.title || host).charAt(0));
  }

  function tile(site, index) {
    const item = document.createElement("div");
    item.className = "site";

    const link = document.createElement("a");
    link.href = site.url;
    const host = hostOf(site.url);
    link.title = `${site.title || host}\n${site.url}`;

    const edit = settings.edits[site.url] ?? {};
    const icon = siteIcon(site, edit, host);
    icon.classList.add("icon");

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = edit.title || siteName(site.title || "", host) || host;

    const hostLabel = document.createElement("span");
    hostLabel.className = "host";
    hostLabel.textContent = host;

    link.append(icon, title, hostLabel);

    const pinnedHere = settings.pinned.some((entry) => entry.url === site.url);
    item.classList.toggle("pinned", pinnedHere);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin";
    pin.title = pinnedHere ? "Unpin" : "Pin";
    pin.setAttribute("aria-pressed", String(pinnedHere));
    pin.append(pinIcon());
    pin.addEventListener("click", () => {
      const pinned = settings.pinned.filter((entry) => entry.url !== site.url);
      save({ pinned: pinnedHere ? pinned : [...pinned, { url: site.url, title: site.title }] });
    });

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

    const editButton = button("✎", () => openEditor(site), "edit");
    editButton.title = "Edit shortcut (e)";

    item.append(link, editButton, pin, hide);
    /* A pinned tile wears the pin, as a pinned tab does: in the corner at
     * rest, where the buttons come on hover. */
    if (pinnedHere) {
      const mark = el("span", "pin-mark");
      mark.append(pinIcon());
      item.append(mark);
    }
    item.style.setProperty("--i", String(index));
    item.dataset.url = site.url;
    /* The light's colour: the picked one, else the brand icon's, else the
     * favicon's own. */
    const color = paletteColor(edit.color) || (edit.icon?.hex && `#${edit.icon.hex}`);
    if (color) {
      item.style.setProperty("--icon", color);
    } else if (site.favicon && !edit.icon) {
      void iconColor(site.favicon).then((found) => {
        if (found) item.style.setProperty("--icon", found);
      });
    }
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
    /* Firefox's top sites (its pinned first, then frecency). Ask for extra
     * so hidden ones leave no gaps. */
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
      ? tileList().findIndex((item) => item.contains(document.activeElement))
      : -1;
    shownSites = list;
    /* One grid; pinned tiles lead it (loadSites puts them first). */
    sites.replaceChildren(...list.map(tile));
    fitGrid();
    /* Tiles settle in on the page's first paint only, not on every rebuild. */
    if (!("settled" in root.dataset)) setTimeout(() => root.dataset.settled = "", 800);
    tileList()[focused]?.querySelector("a")?.focus();
  }

  /* Tiles fill whole rows: as few rows as the width allows, then as few
   * columns as still hold every tile, so 12 tiles that would run 9 + 3
   * sit as 6 + 6. Icons keep their fixed square. */
  const TILE_MIN = { tiles: 22, list: 44, icons: 10 }; // in --u
  function fitGrid() {
    const count = tileList().length;
    if (!count) return;
    const unit = parseFloat(getComputedStyle(root).getPropertyValue("--u")) || 8;
    const min = TILE_MIN[settings.siteStyle] * unit;
    const fit = Math.max(1, Math.floor((sites.clientWidth - 2 + 1) / (min + 1)));
    const rows = Math.ceil(count / fit);
    const columns = Math.ceil(count / rows);
    sites.style.setProperty("--columns", String(columns));
    sites.style.setProperty("--fit", String(fit));
    /* What the last tile spans to close a short last row. */
    sites.style.setProperty("--tail", String(columns - ((count - 1) % columns)));
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
    const items = tileList();
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

  /* ---- light ----------------------------------------------------------
   * The hovered tile lights from within, in the icon's own colour (the
   * theme accent for an icon without one), drawn 1-bit on a canvas under
   * the tile's content: halftone dots that swell under the pointer, phosphor
   * scanlines with a band rolling down, or ASCII by brightness. The tile with
   * keyboard focus lights from its centre. One animation loop serves the
   * page and runs only while a tile is lit or fading. */
  const iconColors = new Map();

  /* The icon's dominant colour: the mean of its saturated pixels. */
  function iconColor(src) {
    if (iconColors.has(src)) return iconColors.get(src);
    const job = (async () => {
      const image = new Image();
      image.src = src;
      try {
        await image.decode();
      } catch {
        return null;
      }
      const size = 16;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [pr, pg, pb, pa] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (pa < 128) continue;
        const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
        const sat = max ? (max - min) / max : 0;
        if (sat < 0.25 || max < 60) continue;
        r += pr; g += pg; b += pb; n++;
      }
      if (n < 4) return null;
      return `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`;
    })();
    iconColors.set(src, job);
    return job;
  }

  const lights = new WeakMap(); // tile -> its light's state
  const lit = new Set(); // tiles drawing now, lit or fading out
  let pointed = null; // the tile under the pointer
  let lightFrame = 0;
  let lastFrame = 0;

  const smooth = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };

  function light(tile) {
    let state = lights.get(tile);
    if (!state) {
      const canvas = el("canvas", "light");
      canvas.setAttribute("aria-hidden", "true");
      tile.prepend(canvas);
      state = { canvas, level: 0, x: 0.5, y: 0.5, w: 0, h: 0 };
      lights.set(tile, state);
    }
    return state;
  }

  /* A tile is on while the pointer is in it or it has keyboard focus. */
  function isOn(tile) {
    return tile === pointed || tile.querySelector(":scope > a:focus-visible") !== null;
  }

  function wake(tile) {
    if (!tile?.isConnected) return;
    const state = light(tile);
    state.color = getComputedStyle(tile).getPropertyValue("--icon").trim()
      || getComputedStyle(root).getPropertyValue("--accent").trim();
    lit.add(tile);
    if (!lightFrame) {
      lastFrame = performance.now();
      lightFrame = requestAnimationFrame(drawLights);
    }
  }

  function drawLights(now) {
    lightFrame = 0;
    const dt = Math.max(0, Math.min(64, now - lastFrame));
    lastFrame = now;
    const still = reduceMotion.matches;
    let moving = false;
    for (const tile of lit) {
      const state = lights.get(tile);
      const target = tile.isConnected && isOn(tile) ? 1 : 0;
      state.level = still ? target
        : state.level + Math.sign(target - state.level) * Math.min(Math.abs(target - state.level), dt / 180);
      sizeCanvas(tile, state);
      const ctx = state.canvas.getContext("2d");
      ctx.clearRect(0, 0, state.w, state.h);
      if (state.level <= 0) {
        lit.delete(tile);
        continue;
      }
      LIGHTS[settings.hover]?.(ctx, state, still ? 0 : now);
      /* A fade needs the next frame; so do the rolling band and shimmer. */
      if (!still && (state.level !== target || (target === 1 && LIVE_LIGHTS.has(settings.hover)))) moving = true;
    }
    if (moving) lightFrame = requestAnimationFrame(drawLights);
  }

  /* The canvas at device pixels, so cells stay square and sharp at a
   * fractional devicePixelRatio. */
  function sizeCanvas(tile, state) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(tile.clientWidth * dpr), h = Math.round(tile.clientHeight * dpr);
    if (w !== state.w || h !== state.h) {
      state.canvas.width = state.w = w;
      state.canvas.height = state.h = h;
    }
    state.dpr = dpr;
  }

  /* Brightness at (fx, fy), 0..1 of the tile: full under the light's
   * centre, nothing at `reach` (a fraction of the tile's width). */
  function falloff(state, fx, fy, reach) {
    const d = Math.hypot(fx - state.x, (fy - state.y) * state.h / state.w);
    return (1 - smooth(d / reach)) * state.level;
  }

  const LIVE_LIGHTS = new Set(["scan", "ascii"]); // animate while lit
  const LIGHTS = {
    halftone(ctx, state) {
      const pitch = 2 * Math.max(2, Math.round(3 * state.dpr));
      const cols = Math.ceil(state.w / pitch), rows = Math.ceil(state.h / pitch);
      ctx.fillStyle = state.color;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const r = falloff(state, (x + 0.5) / cols, (y + 0.5) / rows, 0.6) * pitch * 0.55;
          if (r < 0.6) continue;
          const cx = x * pitch + pitch / 2, cy = y * pitch + pitch / 2;
          ctx.moveTo(cx + r, cy);
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    },
    scan(ctx, state, now) {
      const cell = Math.max(2, Math.round(3 * state.dpr));
      const line = Math.max(1, Math.round(state.dpr));
      const cols = Math.ceil(state.w / cell), rows = Math.ceil(state.h / cell);
      const band = now ? (now / 2400) % 1.4 - 0.2 : -1;
      ctx.fillStyle = state.color;
      for (let y = 0; y < rows; y++) {
        const fy = (y + 0.5) / rows;
        const roll = 0.18 * Math.max(0, 1 - Math.abs(fy - band) / 0.12) * state.level;
        for (let x = 0; x < cols; x++) {
          const v = Math.min(1, 0.85 * falloff(state, (x + 0.5) / cols, fy, 0.7) + roll);
          if (v < 0.03) continue;
          ctx.globalAlpha = v * 0.7;
          ctx.fillRect(x * cell, y * cell, cell, line);
        }
      }
    },
    ascii(ctx, state, now) {
      const ramp = " .:-=+*#%@";
      const cw = Math.round(7 * state.dpr), ch = Math.round(12 * state.dpr);
      const cols = Math.ceil(state.w / cw), rows = Math.ceil(state.h / ch);
      const tick = Math.floor(now / 90);
      ctx.font = `${Math.round(10 * state.dpr)}px monospace`;
      ctx.textBaseline = "top";
      ctx.fillStyle = state.color;
      ctx.globalAlpha = 0.6;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = falloff(state, (x + 0.5) / cols, (y + 0.5) / rows, 0.65);
          /* A few cells step up one level each tick: the shimmer. */
          const shimmer = now && v > 0.08 && ((x * 73856093 ^ y * 19349663 ^ tick * 83492791) >>> 0) % 7 === 0;
          const k = Math.min(ramp.length - 1, Math.floor(v * ramp.length * 0.95) + (shimmer ? 1 : 0));
          if (k > 0) ctx.fillText(ramp[k], x * cw, y * ch);
        }
      }
    }
  };

  sites.addEventListener("mousemove", (event) => {
    const tile = event.target.closest?.(".site");
    if (tile !== pointed) {
      const was = pointed;
      pointed = tile;
      wake(was);
    }
    if (!tile) return;
    const rect = tile.getBoundingClientRect();
    const state = light(tile);
    state.x = (event.clientX - rect.left) / rect.width;
    state.y = (event.clientY - rect.top) / rect.height;
    wake(tile);
  });

  sites.addEventListener("mouseleave", () => {
    const was = pointed;
    pointed = null;
    wake(was);
  });

  /* Keyboard focus lights the tile from its centre; the pointer, if it is
   * in the tile, keeps its own spot. */
  sites.addEventListener("focusin", (event) => {
    const tile = event.target.closest?.(".site");
    if (!tile || !event.target.matches(":focus-visible")) return;
    if (tile !== pointed) Object.assign(light(tile), { x: 0.5, y: 0.5 });
    wake(tile);
  });

  sites.addEventListener("focusout", (event) => {
    wake(event.target.closest?.(".site"));
  });

  /* ---- widgets --------------------------------------------------------
   * Blocks under (or beside) the shortcuts, each a list on the same
   * hairline grid. Local ones read the browser: the calendar, recently
   * closed tabs, history, a bookmarks folder. Feed ones (Hacker News,
   * Reddit, RSS, weather) fetch from the site they name, only while they
   * are in the widget list; their last answer is cached in a pref so a
   * new tab paints at once and refreshes in the background. */

  const widgetsBox = document.querySelector("#widgets");
  const weatherLine = document.querySelector("#weather");
  /* Feed answers: too much for a pref, so a file beside the picked image. */
  const WIDGET_CACHE_FILE = PathUtils.join(PathUtils.profileDir, "omafire-newtab-cache.json");
  const FEED_TTL = 10 * 60 * 1000;
  const FEED_LIMIT = 10;
  const chromeWindow = window.browsingContext.topChromeWindow;
  const lazy = {};
  ChromeUtils.defineESModuleGetters(lazy, { PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs" });
  /* The browser window's own SessionStore: closed tabs belong to it. */
  const sessionStore = () => chromeWindow.SessionStore;

  function ago(when) {
    const s = Math.max(0, (Date.now() - when) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
    return `${Math.floor(s / (86400 * 30))}mo`;
  }

  const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : String(n ?? 0));

  /* One row: title left, meta right. The title is the row's link (its
   * hit area is the whole row); `aside` is a second link in the meta, as
   * the article beside a Hacker News discussion. A row with onClick is a
   * button instead. */
  function item({ url, title, meta, onClick, aside }) {
    if (onClick) {
      const node = el("button", "item");
      node.type = "button";
      node.title = url || title;
      node.addEventListener("click", onClick);
      node.append(el("span", "item-title", title));
      if (meta) node.append(el("span", "item-meta", meta));
      return node;
    }
    const node = el("div", "item");
    const link = el("a", "item-title", title);
    link.href = url;
    link.title = url;
    node.append(link);
    if (meta || aside) {
      const metaNode = el("span", "item-meta");
      if (aside) {
        /* The host shows when the row is hovered; the arrow is always there. */
        const second = el("a", "item-aside");
        second.href = aside.url;
        second.title = aside.url;
        second.append(el("span", "aside-host", aside.text), "↗");
        metaNode.append(second, " ");
      }
      metaNode.append(el("span", "counts", meta || ""));
      node.append(metaNode);
    }
    return node;
  }

  function list(items, empty) {
    if (!items.length) return [el("p", "empty", empty)];
    return items.map((entry, index) => {
      const node = item(entry);
      node.style.setProperty("--i", String(index));
      return node;
    });
  }

  async function fetchJson(url, cache = "no-store") {
    const response = await fetch(url, { credentials: "omit", cache });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  }

  async function fetchText(url, cache = "no-store") {
    const response = await fetch(url, { credentials: "omit", cache });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.text();
  }

  /* "r/linux", "/r/linux" or "linux" to "linux"; empty is popular. */
  const subreddit = (option) => (option.trim() || "popular").replace(/^\/?r\//, "").replace(/[^\w+]/g, "") || "popular";

  /* RSS or Atom text to { title, items: [{ title, url, at, tag }] }. */
  function parseFeed(text) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.documentElement.localName === "parsererror") throw new Error("not a feed");
    const read = (node, name) => {
      const child = [...node.children].find((c) => c.localName === name);
      return child?.textContent?.trim() || "";
    };
    const channel = doc.getElementsByTagName("channel")[0] || doc.documentElement;
    const items = [...doc.getElementsByTagName("item"), ...doc.getElementsByTagName("entry")]
      .slice(0, FEED_LIMIT)
      .map((node) => {
        const linkNode = [...node.children].find((c) => c.localName === "link"
          && (!c.getAttribute("rel") || c.getAttribute("rel") === "alternate"));
        const link = linkNode?.getAttribute("href") || linkNode?.textContent?.trim() || "";
        const at = Date.parse(read(node, "pubDate") || read(node, "published") || read(node, "updated") || read(node, "date"));
        const category = [...node.children].find((c) => c.localName === "category");
        return {
          title: read(node, "title"), url: link, at: Number.isNaN(at) ? null : at,
          tag: category?.getAttribute("label") || category?.getAttribute("term") || category?.textContent?.trim() || ""
        };
      });
    return { title: read(channel, "title"), items };
  }

  const WEATHER = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers",
    82: "Heavy showers", 85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm"
  };

  /* Each kind: a label, an option (text the user gives it), whether it is
   * local (browser data, always fresh) or a feed (fetched, cached), load()
   * resolving data, and render(data, option) returning the block's nodes.
   * `link` is where the header takes the user. */
  const WIDGETS = {
    closed: {
      label: "Recently closed",
      short: "Closed",
      hue: "var(--accent)",
      local: true,
      load: () => (isPrivate ? [] : sessionStore().getClosedTabDataForWindow(chromeWindow))
        .slice(0, FEED_LIMIT)
        .map((tab, index) => ({
          index,
          title: tab.title || tab.state?.entries?.at(-1)?.url || "",
          url: tab.state?.entries?.at(-1)?.url || "",
          closedAt: tab.closedAt
        })),
      render: (tabs) => list(tabs.map((tab) => ({
        title: tab.title || hostOf(tab.url),
        url: tab.url,
        meta: ago(tab.closedAt),
        onClick: () => {
          sessionStore().undoCloseTab(chromeWindow, tab.index);
          chromeWindow.gBrowser.removeTab(chromeWindow.gBrowser.getTabForBrowser(window.browsingContext.embedderElement));
        }
      })), "Nothing closed yet")
    },
    history: {
      label: "History",
      local: true,
      link: "about:history",
      async load() {
        if (isPrivate) return [];
        const db = await lazy.PlacesUtils.promiseDBConnection();
        const rows = await db.execute(
          `SELECT url, title, last_visit_date FROM moz_places
           WHERE hidden = 0 AND last_visit_date IS NOT NULL AND url NOT LIKE :about AND url NOT LIKE :chrome
           ORDER BY last_visit_date DESC LIMIT :n`, { n: FEED_LIMIT, about: "about:%", chrome: "chrome:%" });
        return rows.map((row) => ({
          url: row.getResultByName("url"),
          title: row.getResultByName("title") || "",
          at: row.getResultByName("last_visit_date") / 1000
        }));
      },
      render: (rows) => list(rows.map((row) => ({
        url: row.url, title: row.title || hostOf(row.url), meta: ago(row.at)
      })), "No history yet")
    },
    bookmarks: {
      label: "Bookmarks",
      local: true,
      option: { label: "Folder", placeholder: "Toolbar" },
      async load(option) {
        const { PlacesUtils } = lazy;
        let guid = PlacesUtils.bookmarks.toolbarGuid;
        const name = option.trim();
        if (name) {
          const db = await PlacesUtils.promiseDBConnection();
          const rows = await db.execute(
            "SELECT guid FROM moz_bookmarks WHERE type = 2 AND title = :title LIMIT 1", { title: name });
          if (!rows.length) return { missing: name };
          guid = rows[0].getResultByName("guid");
        }
        const tree = await PlacesUtils.promiseBookmarksTree(guid);
        const groups = [];
        const top = { title: "", items: [] };
        for (const child of tree?.children ?? []) {
          if (child.children) {
            const items = child.children.filter((c) => c.uri).map((c) => ({ url: c.uri, title: c.title }));
            if (items.length) groups.push({ title: child.title, items });
          } else if (child.uri) {
            top.items.push({ url: child.uri, title: child.title });
          }
        }
        if (top.items.length) groups.unshift(top);
        return { groups };
      },
      render(data) {
        if (data.missing) return [el("p", "empty", `No folder named ${data.missing}`)];
        const nodes = [];
        for (const group of data.groups) {
          if (group.title) nodes.push(el("p", "group", group.title));
          for (const site of group.items.slice(0, FEED_LIMIT)) {
            nodes.push(item({ url: site.url, title: site.title || hostOf(site.url), meta: hostOf(site.url) }));
          }
        }
        return nodes.length ? nodes : [el("p", "empty", "The folder is empty")];
      }
    },
    hn: {
      label: "Hacker News",
      short: "HN",
      hue: "#ff6600",
      link: "https://news.ycombinator.com/",
      option: { label: "List", placeholder: "front_page, ask_hn, show_hn" },
      async load(option) {
        const tag = (option.trim() || "front_page").replace(/[^a-z_]/gi, "");
        const data = await fetchJson(`https://hn.algolia.com/api/v1/search?tags=${encodeURIComponent(tag)}&hitsPerPage=${FEED_LIMIT}`);
        return data.hits.map((hit) => ({
          title: hit.title,
          discussion: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          url: hit.url || null,
          points: hit.points, comments: hit.num_comments, at: hit.created_at_i * 1000
        }));
      },
      /* The title opens the discussion; the article's host beside it opens
       * the article. */
      render: (hits) => list(hits.map((hit) => ({
        url: hit.discussion, title: hit.title,
        aside: hit.url ? { url: hit.url, text: hostOf(hit.url) } : null,
        meta: `${compact(hit.comments)} ${ago(hit.at)}`
      })), "Nothing to show")
    },
    reddit: {
      label: "Reddit",
      hue: "#ff4500",
      option: { label: "Subreddit", placeholder: "linux" },
      link: (option) => `https://www.reddit.com/r/${subreddit(option)}/`,
      /* Reddit answers its JSON with a 403 to anything but a signed-in
       * browser; the Atom feed is open. */
      async load(option) {
        return parseFeed(await fetchText(`https://www.reddit.com/r/${subreddit(option)}/hot.rss?limit=${FEED_LIMIT}`)).items;
      },
      render: (posts, option) => list(posts.map((post) => ({
        url: post.url, title: post.title,
        meta: `${/^(popular|all)?$/.test(option.trim()) && post.tag ? `${post.tag} ` : ""}${post.at ? ago(post.at) : ""}`
      })), "Nothing to show")
    },
    rss: {
      label: "Feed",
      option: { label: "URL", placeholder: "https://example.com/feed.xml" },
      link: (option) => {
        try { return new URL(option.trim()).origin; } catch { return ""; }
      },
      async load(option) {
        const url = option.trim();
        if (!url) return { title: "", items: [] };
        return parseFeed(await fetchText(url));
      },
      render: (feed) => list(feed.items.map((entry) => ({
        url: entry.url, title: entry.title, meta: entry.at ? ago(entry.at) : ""
      })), "No entries"),
      meta: (feed) => feed.title
    },
    weather: {
      label: "Weather",
      option: { label: "Place", placeholder: "City" },
      async load(option) {
        const place = option.trim();
        if (!place) return null;
        const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=${navigator.language.slice(0, 2)}`);
        const spot = geo.results?.[0];
        if (!spot) return { missing: place };
        const unit = settings.tempUnit === "f" ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "";
        const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${spot.latitude}&longitude=${spot.longitude}`
          + "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
          + `&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=5${unit}`);
        return {
          place: spot.name, region: spot.admin1 || spot.country || "",
          now: data.current, daily: data.daily, unit: data.current_units.temperature_2m,
          wind: data.current_units.wind_speed_10m
        };
      },
      render(data) {
        if (!data) return [el("p", "empty", "Name a place in the options")];
        if (data.missing) return [el("p", "empty", `No place named ${data.missing}`)];
        const now = el("div", "weather-now");
        now.append(el("span", "temp", `${Math.round(data.now.temperature_2m)}°`));
        const text = el("div", "weather-text");
        text.append(el("span", "item-title", WEATHER[data.now.weather_code] ?? "—"));
        text.append(el("span", "item-meta",
          `feels ${Math.round(data.now.apparent_temperature)}°  ${data.now.relative_humidity_2m}%  ${Math.round(data.now.wind_speed_10m)} ${data.wind}`));
        now.append(text);
        const days = data.daily.time.map((day, i) => ({
          title: `${i === 0 ? "Today" : new Date(`${day}T12:00`).toLocaleDateString([], { weekday: "short" })}  ${WEATHER[data.daily.weather_code[i]] ?? ""}`,
          meta: `${Math.round(data.daily.temperature_2m_max[i])}° ${Math.round(data.daily.temperature_2m_min[i])}°`
        }));
        return [now, ...days.map((day) => {
          const node = el("div", "item day");
          node.append(el("span", "item-title", day.title), el("span", "item-meta", day.meta));
          return node;
        })];
      },
      meta: (data) => (data?.place ? `${data.place}${data.region ? `, ${data.region}` : ""}` : ""),
      /* Also the header line under the clock. */
      header: (data) => (data && !data.missing
        ? `${Math.round(data.now.temperature_2m)}° ${WEATHER[data.now.weather_code] ?? ""} · ${data.place}`
        : ""),
      /* The unit is a global setting: the feed must refetch when it flips. */
      key: () => settings.tempUnit
    }
  };

  let widgetCache = {};
  let cacheReady = false;
  const cacheLoaded = IOUtils.readJSON(WIDGET_CACHE_FILE)
    .then((stored) => {
      if (stored && typeof stored === "object") widgetCache = stored;
    }, () => {})
    .finally(() => {
      cacheReady = true;
    });

  let cacheWrite = Promise.resolve();
  function storeWidgetCache(keep) {
    for (const key of Object.keys(widgetCache)) if (!keep.has(key)) delete widgetCache[key];
    const snapshot = JSON.stringify(widgetCache);
    cacheWrite = cacheWrite.then(() => IOUtils.writeUTF8(WIDGET_CACHE_FILE, snapshot, { tmpPath: `${WIDGET_CACHE_FILE}.tmp` }))
      .catch((error) => console.error("[omafire:newtab] cache:", error));
  }

  function widgetBlock(entry) {
    const def = WIDGETS[entry.type];
    const block = el("article", `widget widget-${entry.type}`);
    const head = el("div", "widget-head");
    const link = typeof def.link === "function" ? def.link(entry.option) : def.link;
    const name = el(link ? "a" : "span", "name", def.label);
    if (link) name.href = link;
    head.append(name, el("span", "meta"));
    block.append(head, el("div", "widget-body"));
    block.style.setProperty("--hue", def.hue || "var(--line-strong)");
    return block;
  }

  function fillWidget(block, def, entry, data, error) {
    const body = block.querySelector(".widget-body");
    const meta = block.querySelector(".widget-head .meta");
    if (error) {
      body.replaceChildren(el("p", "empty", "Could not load"));
      meta.textContent = "";
      return;
    }
    body.replaceChildren(...def.render(data, entry.option));
    meta.textContent = def.meta ? def.meta(data) : "";
    if (def.header) weatherLine.textContent = def.header(data);
  }

  let widgetsRequest = 0;
  let widgetTimer = null;
  let waitingForCache = false;
  function loadWidgets() {
    /* The first run waits for the cache so feeds paint from it. */
    if (!cacheReady) {
      if (!waitingForCache) {
        waitingForCache = true;
        void cacheLoaded.then(loadWidgets);
      }
      return;
    }
    const request = ++widgetsRequest;
    clearTimeout(widgetTimer);
    const entries = settings.widgets;
    if (!entries.some((entry) => entry.type === "weather")) weatherLine.textContent = "";
    if (!entries.length) {
      widgetsBox.replaceChildren();
      return;
    }
    const keep = new Set();
    const blocks = entries.map((entry) => {
      const def = WIDGETS[entry.type];
      const block = widgetBlock(entry);
      const key = `${entry.type}:${entry.option}:${def.key ? def.key() : ""}`;
      const cached = widgetCache[key];
      if (!def.local) keep.add(key);
      if (cached && !def.local) fillWidget(block, def, entry, cached.data);
      const fresh = cached && !def.local && Date.now() - cached.at < FEED_TTL;
      if (!fresh) {
        Promise.resolve()
          .then(() => def.load(entry.option))
          .then((data) => {
            if (request !== widgetsRequest) return;
            fillWidget(block, def, entry, data);
            if (!def.local) {
              widgetCache[key] = { at: Date.now(), data };
              storeWidgetCache(keep);
            }
          }, (error) => {
            if (request !== widgetsRequest) return;
            console.error(`[omafire:newtab] ${entry.type}:`, error);
            if (!cached) fillWidget(block, def, entry, null, error);
          });
      }
      return block;
    });
    widgetsBox.replaceChildren(...blocks);
    storeWidgetCache(keep);
    fitWidgets();
    /* Feeds come round again while the tab stays open. */
    if (entries.some((entry) => !WIDGETS[entry.type].local)) {
      widgetTimer = setTimeout(() => {
        if (document.visibilityState === "visible") loadWidgets();
      }, FEED_TTL);
    }
  }

  /* As the shortcut grid: whole rows, as many columns as the width holds. */
  const WIDGET_MIN = 36; // in --u
  function fitWidgets() {
    const count = [...widgetsBox.children].filter((block) => block.checkVisibility()).length;
    if (!count) return;
    if (settings.widgetPlace === "beside") {
      widgetsBox.style.setProperty("--wcolumns", "1");
      return;
    }
    const unit = parseFloat(getComputedStyle(root).getPropertyValue("--u")) || 8;
    const fit = Math.max(1, Math.floor((widgetsBox.clientWidth - 1) / (WIDGET_MIN * unit + 1)));
    widgetsBox.style.setProperty("--wcolumns", String(Math.min(count, fit)));
  }
  new ResizeObserver(fitWidgets).observe(widgetsBox);

  /* ---- settings panel ----------------------------------------------- */

  const panel = document.querySelector("#settings");
  const form = document.querySelector("#settings-form");
  const toggleButton = document.querySelector("#settings-toggle");
  const heading = document.querySelector(".settings-head h1");

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
      { key: "clockStyle", type: "choice", label: "Style",
        options: [["bold", "Bold"], ["thin", "Thin"], ["line", "Line"]], when: (s) => s.clock },
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
      { key: "hover", type: "choice", label: "Light",
        options: [["halftone", "Dots"], ["scan", "Lines"], ["ascii", "ASCII"]], when: (s) => s.sites },
      { key: "siteCount", type: "range", label: "Count", min: 4, max: 24, unit: "", when: (s) => s.sites },
      { key: "hosts", type: "toggle", label: "Addresses", when: (s) => s.sites && s.siteStyle !== "icons" },
      { type: "add-site", label: "Add site", when: (s) => s.sites },
      { type: "restore", label: "Hidden", when: (s) => s.sites && s.hidden.length > 0 },
      { type: "unpin", label: "Pinned", when: (s) => s.sites && s.pinned.length > 0 }
    ]],
    ["Widgets", [
      { type: "widgets", label: "Widgets" },
      { key: "widgetPlace", type: "choice", label: "Place", options: [["below", "Below"], ["beside", "Beside"]],
        when: (s) => s.widgets.length > 0 },
      { key: "tempUnit", type: "choice", label: "Degrees", options: [["c", "°C"], ["f", "°F"]],
        when: (s) => s.widgets.some((w) => w.type === "weather") },
      { key: "weatherHeader", type: "toggle", label: "In header",
        when: (s) => s.widgets.some((w) => w.type === "weather") },
      { type: "note", label: "", text: "Feeds and weather fetch from the sites they name",
        when: (s) => s.widgets.some((w) => !WIDGETS[w.type].local) }
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
        input.value = ""; // so picking the same file again still changes
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
    widgets() {
      const nodes = document.createDocumentFragment();
      settings.widgets.forEach((entry, index) => {
        const def = WIDGETS[entry.type];
        const controls = [];
        if (def.option) {
          const input = document.createElement("input");
          input.type = "text";
          input.value = entry.option;
          input.placeholder = def.option.placeholder;
          input.setAttribute("aria-label", `${def.label} ${def.option.label}`);
          /* On change, not every keystroke: each value is a fetch. */
          input.addEventListener("change", () => save({
            widgets: settings.widgets.map((w, i) => (i === index ? { ...w, option: input.value } : w))
          }));
          controls.push(input);
        }
        const move = (to) => {
          const order = [...settings.widgets];
          const [moved] = order.splice(index, 1);
          order.splice(to, 0, moved);
          save({ widgets: order });
        };
        if (index > 0) {
          const up = button("↑", () => move(index - 1), "icon-button");
          up.title = `Move ${def.label} up`;
          controls.push(up);
        }
        const remove = button("×", () => save({ widgets: settings.widgets.filter((_, i) => i !== index) }), "icon-button");
        remove.title = `Remove ${def.label}`;
        controls.push(remove);
        nodes.append(row(def.short || def.label, ...controls));
      });
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Widget to add");
      for (const [type, def] of Object.entries(WIDGETS)) {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = def.label;
        select.append(option);
      }
      nodes.append(row("Add widget", select, button("Add", () => save({
        widgets: [...settings.widgets, { type: select.value, option: "" }]
      }))));
      return nodes;
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
      return row(field.label, button("Unpin all", () => save({ pinned: [] })));
    },
    reset(field) {
      /* The look goes back to defaults; the shortcuts (pinned, hidden,
       * added, edited) and the widget list stay. Two clicks. */
      const keep = ["pinned", "hidden", "custom", "edits", "widgets"];
      const reset = button("Defaults", () => {
        if (reset.dataset.armed !== "true") {
          reset.dataset.armed = "true";
          reset.textContent = "Confirm";
          setTimeout(() => {
            reset.dataset.armed = "false";
            reset.textContent = "Defaults";
          }, 3000);
          return;
        }
        const defaults = Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => !keep.includes(key)));
        save(defaults);
      });
      return row(field.label, reset);
    }
  };

  /* ---- shortcut editor ----------------------------------------------
   * The panel in a second mode: one shortcut's name, colour and icon,
   * kept in settings.edits by address. Brand icons come from Simple Icons
   * (simpleicons.org) through jsDelivr, fetched only while searching here;
   * the picked mark's path is stored, so tiles never fetch. */

  const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@16/";
  const SWATCHES = ["accent", "red", "orange", "yellow", "green", "cyan", "blue", "magenta"];
  let editing = null; // the site being edited, while the panel shows it
  let iconIndex = null; // Simple Icons' list, once searched
  const iconPaths = new Map(); // slug -> its path, once fetched
  let iconSearch = { query: "", results: [] };

  function openEditor(site) {
    editing = site;
    iconSearch = { query: "", results: [] };
    setPanel(true);
  }

  function saveEdit(patch) {
    const next = { ...settings.edits[editing.url], ...patch };
    for (const key of Object.keys(next)) if (!next[key]) delete next[key];
    const edits = { ...settings.edits };
    if (Object.keys(next).length) edits[editing.url] = next;
    else delete edits[editing.url];
    save({ edits });
  }

  const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

  async function searchIcons(query) {
    const q = squash(query);
    if (!q) return [];
    iconIndex ??= fetchJson(`${SIMPLE_ICONS}data/simple-icons.json`, "default").catch((error) => {
      iconIndex = null;
      throw error;
    });
    const list = await iconIndex;
    const rank = (icon) => {
      const names = [icon.title, ...(icon.aliases?.aka ?? [])].map(squash);
      if (icon.slug === q) return 0;
      if (icon.slug.startsWith(q)) return 1;
      if (names.some((name) => name.startsWith(q))) return 2;
      if (names.some((name) => name.includes(q))) return 3;
      return 4;
    };
    return list.map((icon) => [rank(icon), icon]).filter(([r]) => r < 4)
      .sort((a, b) => a[0] - b[0] || a[1].title.length - b[1].title.length)
      .slice(0, 12).map(([, icon]) => icon);
  }

  function iconPath(slug) {
    if (!iconPaths.has(slug)) {
      iconPaths.set(slug, fetchText(`${SIMPLE_ICONS}icons/${slug}.svg`, "default")
        .then((svg) => /\sd="([^"]+)"/.exec(svg)?.[1] ?? null)
        .catch(() => null)
        .then((path) => {
          /* A failed fetch is tried again next time. */
          if (!path) iconPaths.delete(slug);
          return path;
        }));
    }
    return iconPaths.get(slug);
  }

  function editorSections() {
    const site = editing;
    const edit = settings.edits[site.url] ?? {};
    const host = hostOf(site.url);
    const section = (title, ...nodes) => {
      const node = el("section");
      if (title) node.append(el("h2", "", title));
      node.append(...nodes);
      return node;
    };

    /* The tile as it stands, inert. */
    const preview = el("div", "preview");
    const shown = tile({ ...site, favicon: site.favicon ?? shownSites.find((s) => s.url === site.url)?.favicon }, 0);
    shown.inert = true;
    preview.append(shown);

    const name = document.createElement("input");
    name.type = "text";
    name.value = edit.title ?? "";
    name.placeholder = siteName(site.title || "", host) || host;
    name.setAttribute("aria-label", "Name");
    name.addEventListener("input", () => saveEdit({ title: name.value.trim() }));

    const swatches = el("div", "choice swatches");
    swatches.setAttribute("role", "radiogroup");
    swatches.setAttribute("aria-label", "Colour");
    /* A monochrome theme resolves several names to one grey: show it once. */
    const seen = new Set();
    for (const value of ["", ...SWATCHES]) {
      const resolved = paletteColor(value);
      if (value && (!resolved || seen.has(resolved))) continue;
      seen.add(resolved);
      const option = button(value ? "" : "Auto", () => saveEdit({ color: value }));
      option.setAttribute("role", "radio");
      option.setAttribute("aria-checked", String((edit.color ?? "") === value));
      if (value) {
        option.title = value;
        option.style.setProperty("--swatch", paletteColor(value));
      }
      swatches.append(option);
    }

    /* Any colour, as a hex. */
    const hex = document.createElement("input");
    hex.type = "text";
    hex.className = "hex";
    hex.value = edit.color?.startsWith("#") ? edit.color : "";
    hex.placeholder = "#rrggbb";
    hex.setAttribute("aria-label", "Colour hex");
    hex.addEventListener("change", () => {
      const value = hex.value.trim().replace(/^#?/, "#");
      if (/^#[0-9a-f]{6}$/i.test(value)) saveEdit({ color: value.toLowerCase() });
      else if (!hex.value.trim()) saveEdit({ color: "" });
      else {
        hex.setCustomValidity("Six hex digits");
        hex.reportValidity();
      }
    });
    hex.addEventListener("input", () => hex.setCustomValidity(""));
    if (hex.value) hex.style.setProperty("--swatch", hex.value);

    const iconKind = edit.icon?.path ? "brand" : edit.icon === "letter" ? "letter" : "site";
    const kinds = el("div", "choice");
    kinds.setAttribute("role", "radiogroup");
    kinds.setAttribute("aria-label", "Icon");
    for (const [value, text] of [["site", "Site"], ["letter", "Letter"], ["brand", "Brand"]]) {
      const option = button(text, () => {
        if (value === "brand") {
          iconSearch.open = true;
          renderForm();
          form.querySelector("input.icon-query")?.focus();
        } else {
          iconSearch.open = false;
          saveEdit({ icon: value === "letter" ? "letter" : "" });
        }
      });
      option.setAttribute("role", "radio");
      option.setAttribute("aria-checked", String(iconSearch.open ? value === "brand" : iconKind === value));
      kinds.append(option);
    }

    const iconRows = [row("Icon", kinds)];
    if (iconSearch.open || iconKind === "brand") {
      const query = document.createElement("input");
      query.type = "text";
      query.className = "icon-query";
      query.placeholder = edit.icon?.title || "Search Simple Icons";
      query.value = iconSearch.query;
      query.setAttribute("aria-label", "Brand icon search");
      let timer = 0;
      query.addEventListener("input", () => {
        clearTimeout(timer);
        iconSearch.query = query.value;
        timer = setTimeout(async () => {
          try {
            iconSearch.results = await searchIcons(query.value);
            iconSearch.error = "";
          } catch {
            iconSearch.error = "Simple Icons is unreachable";
          }
          renderForm();
        }, 200);
      });
      iconRows.push(row("Brand", query));
      if (iconSearch.error) iconRows.push(row("", el("p", "note", iconSearch.error)));
      const grid = el("div", "brand-results");
      for (const icon of iconSearch.results) {
        const pick = button("", async () => {
          const path = await iconPath(icon.slug);
          if (path) {
            iconSearch.open = false;
            saveEdit({ icon: { slug: icon.slug, title: icon.title, hex: icon.hex, path } });
          }
        });
        pick.title = icon.title;
        pick.setAttribute("aria-checked", String(edit.icon?.slug === icon.slug));
        void iconPath(icon.slug).then((path) => {
          if (!path) return;
          const mark = siteIcon(site, { icon: { path, hex: icon.hex } }, host);
          pick.replaceChildren(mark);
        });
        grid.append(pick);
      }
      if (iconSearch.results.length) iconRows.push(grid);
    }

    return [
      section(host, preview, row("Name", name), row("Colour", swatches), row("", hex), ...iconRows),
      section("", row("", button("Reset", () => {
        iconSearch = { query: "", results: [] };
        saveEdit({ title: "", color: "", icon: "" });
      }), button("Done", () => setPanel(false))))
    ];
  }

  function renderForm() {
    if (panel.hidden) return;
    /* Re-rendering replaces the focused control; keep focus on the same
     * row so typing and keyboard use carry on. */
    const focused = document.activeElement;
    const focusPath = form.contains(focused)
      ? [[...form.querySelectorAll("input, button")].indexOf(focused), focused.type]
      : null;
    const selection = focused?.selectionStart;
    heading.textContent = editing ? "Shortcut" : "New tab";
    form.replaceChildren(...editing ? editorSections() : SCHEMA.map(([title, fields]) => {
      const section = document.createElement("section");
      const sectionHeading = document.createElement("h2");
      sectionHeading.textContent = title;
      section.append(sectionHeading, ...fields
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
    if (!open) editing = null;
    panel.hidden = !open;
    /* The page stays in view but out of reach: Tab and hints stay in the
     * panel. */
    document.querySelector("main").inert = open;
    toggleButton.setAttribute("aria-expanded", String(open));
    root.dataset.settings = open;
    if (open) {
      renderForm();
      form.querySelector("button, input")?.focus();
    } else if (panel.contains(document.activeElement)) {
      toggleButton.focus();
    }
  }

  toggleButton.addEventListener("click", () => {
    if (editing) editing = null;
    else if (!panel.hidden) return setPanel(false);
    setPanel(true);
  });
  document.querySelector("#settings-close").addEventListener("click", () => setPanel(false));
  form.addEventListener("submit", (event) => event.preventDefault());

  /* ---- hints ---------------------------------------------------------
   * f labels everything clickable with home-row letters, as Vimium does
   * (it can't reach this page); typing a label clicks it, or focuses a
   * field. Esc, Backspace past the start, or any other key leaves. */

  const HINT_KEYS = "sadfjklewcmpgh";
  const hintLayer = document.querySelector("#hints");
  let hints = null; // [{ label, target, node }] while shown
  let typed = "";

  /* Prefix-free labels, as short as the count allows (Vimium's scheme). */
  function hintLabels(count) {
    const labels = [""];
    let offset = 0;
    while (labels.length - offset < count || labels.length === 1) {
      const base = labels[offset++];
      for (const key of HINT_KEYS) labels.push(key + base);
    }
    return labels.slice(offset, offset + count).sort().map((label) => [...label].reverse().join(""));
  }

  function hintTargets() {
    /* Covered targets (under the panel) drop out at the hit test. */
    const selector = "#sites .site > a, #widgets a, #widgets button.item, #settings-toggle,"
      + " #settings button, #settings input:not([type=file]), #settings select";
    return [...document.querySelectorAll(selector)].filter((node) => {
      if (node.closest("[inert]")) return false;
      if (!node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      const rect = node.getBoundingClientRect();
      if (!rect.width || rect.bottom <= 0 || rect.top >= innerHeight) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, Math.max(1, rect.top + rect.height / 2));
      return node.contains(hit) || hit === null;
    });
  }

  function showHints() {
    const targets = hintTargets();
    if (!targets.length) return;
    const labels = hintLabels(targets.length);
    hints = targets.map((target, i) => {
      const rect = target.getBoundingClientRect();
      const node = el("span", "hint", labels[i]);
      node.style.left = `${Math.max(0, rect.left - 1)}px`;
      node.style.top = `${Math.max(0, rect.top - 1)}px`;
      return { label: labels[i], target, node };
    });
    typed = "";
    hintLayer.replaceChildren(...hints.map((hint) => hint.node));
    hintLayer.hidden = false;
  }

  function hideHints() {
    hints = null;
    hintLayer.hidden = true;
    hintLayer.replaceChildren();
  }

  function hintKey(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) return hideHints();
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Backspace" && typed) typed = typed.slice(0, -1);
    else if (event.key.length === 1 && HINT_KEYS.includes(event.key.toLowerCase())) typed += event.key.toLowerCase();
    else return hideHints();
    const left = hints.filter((hint) => hint.label.startsWith(typed));
    if (!left.length) return hideHints();
    if (left.length === 1 && left[0].label === typed) {
      const { target } = left[0];
      hideHints();
      if (target.matches("input, select")) target.focus();
      else target.click();
      return;
    }
    for (const hint of hints) {
      const match = hint.label.startsWith(typed);
      hint.node.hidden = !match;
      if (match) {
        const done = el("b", "", typed);
        hint.node.replaceChildren(done, hint.label.slice(typed.length));
      }
    }
  }

  document.addEventListener("keydown", (event) => {
    if (hints) hintKey(event);
  }, true);
  addEventListener("scroll", () => hints && hideHints(), { passive: true });
  addEventListener("resize", () => hints && hideHints());

  /* ---- keys --------------------------------------------------------- */

  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape" && !panel.hidden) {
      setPanel(false);
      return;
    }
    if (event.target.closest?.("input, textarea, select")) return;
    if (event.key === ",") {
      event.preventDefault();
      setPanel(panel.hidden);
      return;
    }
    if (event.key === "f") {
      event.preventDefault();
      showHints();
      return;
    }
    /* The rest act on the page, not through the panel. */
    if (!panel.hidden) return;
    /* e edits the focused shortcut. */
    const focusedTile = event.target.closest?.(".site");
    if (event.key === "e" && focusedTile) {
      event.preventDefault();
      const site = shownSites.find((entry) => entry.url === focusedTile.dataset.url);
      if (site) openEditor(site);
      return;
    }
    /* Arrows walk the grid; from nowhere they start at the first tile. */
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: "up", ArrowDown: "down" }[event.key];
    if (step !== undefined && settings.sites && tileList().length) {
      const items = tileList();
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
      tileList()[Number(event.key) - 1]?.querySelector("a")?.click();
    }
  });

  /* ---- start -------------------------------------------------------- */

  settings = normalize(readPref(SETTINGS_PREF));
  if (prefs.prefHasUserValue(OLD_CACHE_PREF)) prefs.clearUserPref(OLD_CACHE_PREF);
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
    loadWidgets();
  });
  window.addEventListener("unload", () => {
    prefs.removeObserver(SETTINGS_PREF, onSettings);
    Services.obs.removeObserver(onPalette, "omafire-palette-changed");
    Services.obs.removeObserver(onWallpaper, "omafire-wallpaper-changed");
  }, { once: true });
})();
