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
    widgets: [{ type: "calendar" }, { type: "closed" }], // [{ type, option }], in order
    widgetPlace: "below", // below | beside
    tempUnit: "c", // c | f
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
    next.widgets = next.widgets
      .filter((w) => w && typeof w === "object" && Object.hasOwn(WIDGETS, w.type))
      .map((w) => ({ type: w.type, option: typeof w.option === "string" ? w.option : "" }));
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
    d.widgetPlace = settings.widgetPlace;
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

  /* ---- widgets --------------------------------------------------------
   * Blocks under (or beside) the shortcuts, each a list on the same
   * hairline grid. Local ones read the browser: the calendar, recently
   * closed tabs, history, a bookmarks folder. Feed ones (Hacker News,
   * Reddit, RSS, weather) fetch from the site they name, only while they
   * are in the widget list; their last answer is cached in a pref so a
   * new tab paints at once and refreshes in the background. */

  const widgetsBox = document.querySelector("#widgets");
  const WIDGET_CACHE_PREF = "omafire.newtab.widget-cache";
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

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* One row: title left, meta right; a link, or a button for an action. */
  function item({ url, title, meta, onClick }) {
    const node = el(onClick ? "button" : "a", "item");
    if (onClick) {
      node.type = "button";
      node.addEventListener("click", onClick);
    } else {
      node.href = url;
    }
    node.title = url || title;
    node.append(el("span", "item-title", title));
    if (meta) node.append(el("span", "item-meta", meta));
    return node;
  }

  function list(items, empty) {
    if (!items.length) return [el("p", "empty", empty)];
    return items.map(item);
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
    calendar: {
      label: "Calendar",
      local: true,
      load: () => Date.now(),
      render() {
        const now = new Date();
        const grid = el("div", "calendar");
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const probe = new Date(2024, 0, 7); // a Sunday
        const names = [];
        for (let i = 0; i < 7; i++) {
          names.push(new Date(probe.getTime() + i * 86400000).toLocaleDateString([], { weekday: "narrow" }));
        }
        /* Weeks start on Monday unless the locale starts them on Sunday. */
        const startsSunday = /^en-(US|CA)|^(ja|zh|he|ar|pt-BR)/i.test(navigator.language);
        const offset = startsSunday ? 0 : 1;
        for (let i = 0; i < 7; i++) grid.append(el("span", "dow", names[(i + offset) % 7]));
        const lead = (first.getDay() - offset + 7) % 7;
        const daysBefore = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        for (let i = lead; i > 0; i--) grid.append(el("span", "day pad", String(daysBefore - i + 1)));
        const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        for (let d = 1; d <= days; d++) {
          const day = el("span", "day", String(d));
          if (d === now.getDate()) day.classList.add("today");
          grid.append(day);
        }
        const used = lead + days;
        for (let d = 1; used + d <= Math.ceil(used / 7) * 7; d++) grid.append(el("span", "day pad", String(d)));
        return [grid];
      },
      meta: () => new Date().toLocaleDateString([], { month: "long", year: "numeric" })
    },
    closed: {
      label: "Recently closed",
      short: "Closed",
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
      link: "https://news.ycombinator.com/",
      option: { label: "List", placeholder: "front_page, ask_hn, show_hn" },
      async load(option) {
        const tag = (option.trim() || "front_page").replace(/[^a-z_]/gi, "");
        const data = await fetchJson(`https://hn.algolia.com/api/v1/search?tags=${encodeURIComponent(tag)}&hitsPerPage=${FEED_LIMIT}`);
        return data.hits.map((hit) => ({
          title: hit.title,
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          points: hit.points, comments: hit.num_comments, at: hit.created_at_i * 1000
        }));
      },
      render: (hits) => list(hits.map((hit) => ({
        url: hit.url, title: hit.title, meta: `${compact(hit.points)}p ${compact(hit.comments)}c ${ago(hit.at)}`
      })), "Nothing to show")
    },
    reddit: {
      label: "Reddit",
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
      /* The unit is a global setting: the feed must refetch when it flips. */
      key: () => settings.tempUnit
    }
  };

  const widgetCache = (() => {
    const stored = readPref(WIDGET_CACHE_PREF);
    return stored && typeof stored === "object" ? stored : {};
  })();

  function storeWidgetCache(keep) {
    for (const key of Object.keys(widgetCache)) if (!keep.has(key)) delete widgetCache[key];
    prefs.setStringPref(WIDGET_CACHE_PREF, JSON.stringify(widgetCache));
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
  }

  let widgetsRequest = 0;
  let widgetTimer = null;
  function loadWidgets() {
    const request = ++widgetsRequest;
    clearTimeout(widgetTimer);
    const entries = settings.widgets;
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
    ["Widgets", [
      { type: "widgets", label: "Widgets" },
      { key: "widgetPlace", type: "choice", label: "Place", options: [["below", "Below"], ["beside", "Beside"]],
        when: (s) => s.widgets.length > 0 },
      { key: "tempUnit", type: "choice", label: "Degrees", options: [["c", "°C"], ["f", "°F"]],
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
    loadWidgets();
  });
  window.addEventListener("unload", () => {
    prefs.removeObserver(SETTINGS_PREF, onSettings);
    Services.obs.removeObserver(onPalette, "omafire-palette-changed");
    Services.obs.removeObserver(onWallpaper, "omafire-wallpaper-changed");
  }, { once: true });
})();
