// AC3: the keyboard-selected row and the hovered row stay apart, and not
// by fill alone: the selected row carries the hairline, hover only a fill.
// Run (fxlab js) after Down-arrowing to one row and hovering another.
const rows = [...document.querySelectorAll("#urlbar .urlbarView-row")];
const st = e => {
  const c = getComputedStyle(e);
  return {bg: c.backgroundColor, shadow: c.boxShadow};
};
const sel = rows.find(r => r.hasAttribute("selected"));
const hov = rows.find(r => r.matches(":hover"));
const plain = rows.find(r => r !== sel && r !== hov);
const res = {sel: sel && st(sel), hover: hov && st(hov), plain: plain && st(plain), fail: []};
if (!sel) res.fail.push("no selected row");
if (!hov) res.fail.push("no hovered row (pointer did not land)");
if (sel && hov) {
  if (!res.sel.shadow.includes("inset")) res.fail.push("selected row has no hairline");
  if (res.hover.shadow != "none") res.fail.push("hovered row has the selected hairline");
  if (res.sel.bg == res.hover.bg) res.fail.push("selected and hovered fills match");
  if (plain && res.hover.bg == res.plain.bg) res.fail.push("hover has no fill");
}
return res;
