// Launcher geometry at the current window size, text scale and density
// (fxlab js, chrome context, with results open). Returns the rects and a
// `fail` list, one entry per broken acceptance criterion:
//   AC1  field, card, results and auxiliary controls inside the viewport;
//        the card off the tab column in the sidebar layout; the last row
//        inside the card, or reachable by scrolling when below the viewport
//   AC2  every action text ("Search with…", "Switch to Tab") laid out
//        whole, however long the title
const r = e => {
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return [b.left, b.top, b.right, b.bottom].map(v => Math.round(v * 10) / 10);
};
const vis = e => {
  if (!e) return false;
  const b = e.getBoundingClientRect();
  return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility != "hidden";
};
const $ = s => document.querySelector(s);
const vw = innerWidth, vh = innerHeight;
const out = b => b && (b[0] < -0.5 || b[1] < -0.5 || b[2] > vw + 0.5 || b[3] > vh + 0.5);
const meets = (a, b) => a && b && a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
const P = Services.prefs;
const ub = $("#urlbar"), view = ub.querySelector(".urlbarView");
const open = ub.hasAttribute("popover-open");
const res = {
  vw, vh, dpr: devicePixelRatio,
  textScale: P.getIntPref("ui.textScaleFactor", 100), density: P.getIntPref("browser.uidensity", 0),
  layout: P.getStringPref("omafire.layout", "top"), launcher: P.getStringPref("omafire.launcher", ""),
  zen: P.getBoolPref("omafire.zen-mode", false) && P.getBoolPref("omafire.zen-mode-active", false),
  compact: P.getBoolPref("omafire.compact", false), start: P.getBoolPref("sidebar.position_start", true),
  vertical: P.getBoolPref("sidebar.verticalTabs", false),
  open, focused: ub.hasAttribute("focused"),
  urlbar: r(ub), card: r(ub.querySelector(".urlbar-background")), field: r(ub.querySelector(".urlbar-input-container")),
  view: open ? r(view) : null,
  viewBg: open ? r(view.querySelector(".urlbarView-background")) : null,
  navbar: r($("#nav-bar")), column: vis($("#sidebar-container")) ? r($("#sidebar-container")) : null,
};
const fail = [];
if (!open) fail.push("results not open");

// AC1: in the viewport.
const aux = [...ub.querySelectorAll(".urlbar-input-container > *, #page-action-buttons > *, #identity-box"),
             ...document.querySelectorAll("#nav-bar toolbarbutton, #nav-bar toolbaritem")].filter(vis);
for (const e of aux) if (out(r(e))) fail.push(`aux out: ${e.id || e.className} ${r(e)}`);
for (const k of ["urlbar", "card", "field", "view", "viewBg"]) if (out(res[k])) fail.push(`${k} out of viewport ${res[k]}`);

// AC1: off the column (the sidebar layout's launchers keep clear of it;
// zen's centre card floats over the dimmed window by design).
if (res.column && res.layout == "sidebar")
  for (const k of ["card", "viewBg"]) if (meets(res[k], res.column)) fail.push(`${k} overlaps column ${res.column}`);

if (open) {
  const rows = [...view.querySelectorAll(".urlbarView-row")].filter(vis);
  res.rows = rows.length;
  res.firstRow = r(rows[0]);
  res.lastRow = r(rows.at(-1));
  const last = rows.at(-1);
  if (last) {
    // AC1: the last row reachable.
    const lb = r(last);
    if (lb[3] > vh + 0.5) {
      const sc = [...view.querySelectorAll("*")].find(e => e.contains(last)
        && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY));
      if (!sc) fail.push(`last row below viewport, no scroller ${lb}`);
      else {
        sc.scrollTop = sc.scrollHeight;
        const lb2 = r(last);
        res.lastRowScrolled = lb2;
        if (lb2[3] > Math.min(vh, r(sc)[3]) + 0.5) fail.push(`last row unreachable ${lb2}`);
        sc.scrollTop = 0;
      }
    }
    if (res.viewBg && lb[3] > res.viewBg[3] + 0.5) fail.push(`last row past the card ${lb} card ${res.viewBg}`);
  }
  // AC2: actions whole.
  const w = e => e && vis(e) ? Math.round(e.getBoundingClientRect().width) : 0;
  res.rowDetail = rows.map(row => {
    const a = row.querySelector(".urlbarView-action");
    const end = row.querySelector(".urlbarView-row-inner").getBoundingClientRect().right;
    const clipped = vis(a) ? a.getBoundingClientRect().right > end + 0.5 || a.scrollWidth > a.clientWidth + 1 : null;
    return {
      type: row.getAttribute("type"), sel: row.hasAttribute("selected"),
      title: w(row.querySelector(".urlbarView-title")), action: w(a), actionText: a?.textContent || "",
      actionClipped: clipped, url: w(row.querySelector(".urlbarView-row-body-top > .urlbarView-url")),
    };
  });
  for (const d of res.rowDetail)
    if (d.actionText && (d.action < 20 || d.actionClipped))
      fail.push(`action hidden: ${d.type} "${d.actionText}" w=${d.action} clipped=${d.actionClipped}`);
}
res.fail = fail;
return res;
