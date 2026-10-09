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
    numbers: true,
    hosts: true,
    align: "top", // top | center
    width: "normal", // normal | wide
    widgets: [{ type: "closed" }], // [{ type, option }], in order
    widgetPlace: "below", // below | beside
    tempUnit: "c", // c | f
    weatherHeader: true, // the weather widget reads as a line under the clock
    custom: [], // [{ url, title }]
    pinned: [], // [{ url, title }], dragged into place; they lead the grid
    hidden: [] // urls
  };

  /* Glass chrome is the one case where Desktop shows the desktop; there it
   * is the default. */
  const glass = prefs.getBoolPref("omafire.translucency", false);
  if (glass) DEFAULTS.background = "desktop";

  let settings = { ...DEFAULTS };

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

  function normalize(stored) {
    const next = { ...DEFAULTS };
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      const value = stored?.[key];
      if (Array.isArray(fallback) ? Array.isArray(value) : typeof value === typeof fallback) {
        next[key] = value;
      }
    }
    next.widgets = next.widgets
      .filter((w) => w && typeof w === "object" && Object.hasOwn(WIDGETS, w.type))
      .map((w) => ({ type: w.type, option: typeof w.option === "string" ? w.option : "" }));
    return next;
  }

  function applySettings() {
    const d = root.dataset;
    d.background = settings.background;
    d.siteStyle = settings.siteStyle;
    d.hover = settings.hover;
    d.align = settings.align;
    d.width = settings.width;
    d.glass = settings.glass;
    d.numbers = settings.numbers;
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
    void loadBackdrop();
    void loadSites();
    loadWidgets();
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

    const pinnedHere = settings.pinned.some((entry) => entry.url === site.url);
    item.classList.toggle("pinned", pinnedHere);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin";
    pin.title = pinnedHere ? "Unpin" : "Pin to the front";
    pin.textContent = pinnedHere ? "−" : "+";
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

    item.append(link, pin, hide);
    item.style.setProperty("--i", String(index));
    item.dataset.url = site.url;
    if (site.favicon) void iconColor(site.favicon).then((color) => {
      if (color) item.style.setProperty("--icon", color);
    });
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
      ? tileList().findIndex((item) => item.contains(document.activeElement))
      : -1;
    shownSites = list;
    const tiles = list.map(tile);
    /* Pinned tiles lead under their own label, the rest under "Frequent",
     * when both kinds are there. */
    const pinnedCount = tiles.filter((t) => t.classList.contains("pinned")).length;
    const nodes = [];
    if (pinnedCount && pinnedCount < tiles.length) {
      /* Pinned tiles share a row of their own and stretch across it. */
      const pinnedRow = el("div", "pinned-row");
      pinnedRow.append(...tiles.slice(0, pinnedCount));
      pinnedRow.style.setProperty("--pinned", String(pinnedCount));
      nodes.push(el("div", "group-label", "Pinned"), pinnedRow,
        el("div", "group-label", "Frequent"), ...tiles.slice(pinnedCount));
    } else {
      nodes.push(...tiles);
    }
    sites.replaceChildren(...nodes);
    fitGrid();
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

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
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
    const dt = Math.min(64, now - lastFrame);
    lastFrame = now;
    const still = reduceMotion.matches;
    let moving = false;
    for (const tile of lit) {
      const state = lights.get(tile);
      const target = tile.isConnected && isOn(tile) ? 1 : 0;
      state.level = still ? target
        : state.level + Math.sign(target - state.level) * Math.min(Math.abs(target - state.level), dt / 180);
      fit(tile, state);
      const ctx = state.canvas.getContext("2d");
      ctx.clearRect(0, 0, state.w, state.h);
      if (state.level <= 0) {
        lit.delete(tile);
        continue;
      }
      LIGHTS[settings.hover]?.(ctx, state, still ? 0 : now);
      /* A fade, the rolling band and the shimmer need the next frame. */
      if (!still && (state.level !== target || target === 1)) moving = true;
    }
    if (moving) lightFrame = requestAnimationFrame(drawLights);
  }

  /* The canvas at device pixels, so cells stay square and sharp at a
   * fractional devicePixelRatio. */
  function fit(tile, state) {
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
      /* Keys drive the first block (newtab.css shows them there only). */
      if (index < 10) node.prepend(el("span", "key", String.fromCharCode(97 + index)));
      node.style.setProperty("--i", String(index));
      return node;
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  }

  async function fetchText(url) {
    const response = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.text();
  }

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
      link: (option) => `https://www.reddit.com/r/${encodeURIComponent(option.trim() || "popular")}/`,
      /* Reddit answers its JSON with a 403 to anything but a signed-in
       * browser; the Atom feed is open. */
      async load(option) {
        const sub = (option.trim() || "popular").replace(/^\/?r\//, "").replace(/[^\w+]/g, "");
        return parseFeed(await fetchText(`https://www.reddit.com/r/${sub}/hot.rss?limit=${FEED_LIMIT}`)).items;
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
  function loadWidgets() {
    /* The first run waits for the cache so feeds paint from it. */
    if (!cacheReady) {
      void cacheLoaded.then(loadWidgets);
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
    const count = widgetsBox.children.length;
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
      { key: "numbers", type: "toggle", label: "Numbers", when: (s) => s.sites },
      { key: "hosts", type: "toggle", label: "Addresses", when: (s) => s.sites && s.siteStyle !== "icons" },
      { type: "add-site", label: "Add", when: (s) => s.sites },
      { type: "restore", label: "Hidden", when: (s) => s.sites && s.hidden.length > 0 },
      { type: "unpin", label: "Order", when: (s) => s.sites && s.pinned.length > 0 }
    ]],
    ["Widgets", [
      { type: "widgets", label: "Widgets" },
      { key: "widgetPlace", type: "choice", label: "Place", options: [["below", "Below"], ["beside", "Beside"]],
        when: (s) => s.widgets.length > 0 },
      { key: "tempUnit", type: "choice", label: "Degrees", options: [["c", "°C"], ["f", "°F"]],
        when: (s) => s.widgets.some((w) => w.type === "weather") },
      { key: "weatherHeader", type: "toggle", label: "By the clock",
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
        if (index > 0) controls.push(button("↑", () => move(index - 1), "icon-button"));
        controls.push(button("×", () => save({ widgets: settings.widgets.filter((_, i) => i !== index) }), "icon-button"));
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
      nodes.append(row("Add", select, button("Add", () => save({
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
    if (step !== undefined && settings.sites && tileList().length
        && !panel.contains(event.target)) {
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
      return;
    }
    /* Letters open the first feed's rows. */
    if (/^[a-j]$/.test(event.key)) {
      const rows = widgetsBox.querySelector(".widget")?.querySelectorAll(".item");
      const row = rows?.[event.key.charCodeAt(0) - 97];
      (row?.querySelector("a.item-title") ?? row)?.click();
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
