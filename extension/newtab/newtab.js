"use strict";

(function startNewTab() {
  const STORAGE_KEY = "storedTheme";
  /* The last palette, cached synchronously so the first frame is already
   * on-palette; storage.local is async and would flash the fallback. */
  const CACHE_KEY = "omafox-newtab-palette";
  const SITE_LIMIT = 12;
  const { readableTextColor } = globalThis.OmafoxTheme;
  const root = document.documentElement;

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

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached) applyVars(cached);
  } catch {
    /* no cache yet */
  }

  browser.storage.local.get(STORAGE_KEY).then((result) => applyRecord(result[STORAGE_KEY]));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]?.newValue) applyRecord(changes[STORAGE_KEY].newValue);
  });

  /* ---- clock -------------------------------------------------------- */

  const clock = document.querySelector("#clock");
  const date = document.querySelector("#date");

  function tick() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clock.dateTime = now.toISOString();
    date.textContent = now
      .toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })
      .replace(/,/g, "");
    setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
  }
  tick();

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
    const link = document.createElement("a");
    link.className = "site";
    link.href = site.url;
    const host = hostOf(site.url);

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

    const number = document.createElement("span");
    number.className = "index";
    number.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = site.title || host;

    const hostLabel = document.createElement("span");
    hostLabel.className = "host";
    hostLabel.textContent = host;

    link.append(icon, number, title, hostLabel);
    return link;
  }

  async function loadSites() {
    /* newtab: true is Firefox's own shortcut list (pinned first); it is
     * empty while Firefox's shortcuts feed is off, so fall back to
     * frecency. */
    let list = [];
    try {
      list = await browser.topSites.get({ newtab: true, includeFavicon: true, limit: SITE_LIMIT });
    } catch {
      /* older API shape */
    }
    if (!list.length) {
      list = await browser.topSites.get({ includeFavicon: true, limit: SITE_LIMIT });
    }
    sites.replaceChildren(...list.slice(0, SITE_LIMIT).map(tile));
  }
  loadSites().catch((error) => console.error("Omafox new tab could not load shortcuts", error));

  /* Digits open the matching shortcut while the page has focus. */
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !/^[1-9]$/.test(event.key)) return;
    const link = sites.children[Number(event.key) - 1];
    if (link) link.click();
  });
})();
