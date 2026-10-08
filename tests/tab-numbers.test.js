// tab-numbers.uc.js: with tab-numbers and tab-numbers-hold on, Alt shows the
// numbers, digits (Alt, 1, 2 = tab 12) light a tab and the switch waits for Alt's release.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function load(prefValues) {
  const listeners = {};
  const attrs = new Set();
  const lit = new Set();
  const tabs = Array.from({ length: 14 }, (_, i) => ({
    n: i + 1,
    setAttribute(name) { if (name === "omafire-num-lit") lit.add(this); },
    removeAttribute(name) { if (name === "omafire-num-lit") lit.delete(this); },
  }));
  const gBrowser = { visibleTabs: tabs, selectedTab: tabs[0] };
  const root_ = {
    setAttribute: name => attrs.add(name),
    removeAttribute: name => attrs.delete(name),
  };
  const document = {
    documentElement: root_,
    querySelectorAll: () => [...lit],
    querySelector: () => (lit.size ? [...lit][0] : null),
  };
  const observers = [];
  const prefs = {
    getBoolPref: (name, fallback) => (name in prefValues ? prefValues[name] : fallback),
    addObserver: (name, o) => observers.push(o),
    removeObserver() {},
  };
  const window = { addEventListener: (type, fn) => (listeners[type] ??= []).push(fn) };
  vm.runInNewContext(fs.readFileSync(path.join(root, "chrome/scripts/tab-numbers.uc.js"), "utf8"),
    { window, document, gBrowser, Services: { prefs } });
  const fire = (type, init) => {
    const e = { type, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false, code: "", key: "",
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...init };
    for (const fn of listeners[type] ?? []) fn(e);
    return e;
  };
  return { fire, attrs, lit, gBrowser, tabs, prefValues, observers, window };
}

const digit = n => ({ key: String(n), code: `Digit${n}`, altKey: true });
const ON = { "omafire.tab-numbers": true, "omafire.tab-numbers-hold": true };

// hold on: the root says so; Alt shows the numbers, the digits wait for the release
{
  const t = load({ ...ON });
  assert.ok(t.attrs.has("omafire-tab-numbers-hold"));
  assert.ok(!t.attrs.has("omafire-numbers-held"));
  t.fire("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  assert.ok(t.attrs.has("omafire-numbers-held"));
  assert.ok(t.fire("keydown", digit(1)).defaultPrevented, "Firefox's immediate Alt+1 is stopped");
  assert.equal(t.gBrowser.selectedTab, t.tabs[0]);
  assert.equal([...t.lit][0], t.tabs[0]);
  t.fire("keydown", digit(2));
  assert.equal([...t.lit][0], t.tabs[11], "1 then 2 points at tab 12");
  assert.equal(t.gBrowser.selectedTab, t.tabs[0], "nothing switches while Alt is down");
  const up = t.fire("keyup", { key: "Alt", code: "AltLeft" });
  assert.equal(t.gBrowser.selectedTab, t.tabs[11]);
  assert.ok(up.defaultPrevented, "the release that ends an entry is not a bare Alt tap");
  assert.ok(!t.attrs.has("omafire-numbers-held"));
  assert.equal(t.lit.size, 0);
}

// 9 alone is the last tab; past the last tab is the last tab; Escape drops the entry
{
  const t = load({ ...ON });
  t.fire("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  t.fire("keydown", digit(9));
  t.fire("keyup", { key: "Alt", code: "AltLeft" });
  assert.equal(t.gBrowser.selectedTab, t.tabs[13]);
  t.gBrowser.selectedTab = t.tabs[0];
  t.fire("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  t.fire("keydown", digit(9)); t.fire("keydown", digit(9));
  t.fire("keyup", { key: "Alt", code: "AltLeft" });
  assert.equal(t.gBrowser.selectedTab, t.tabs[13], "99 clamps to the last tab");
  t.gBrowser.selectedTab = t.tabs[0];
  t.fire("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  t.fire("keydown", digit(3));
  t.fire("keydown", { key: "Escape", code: "Escape", altKey: true });
  t.fire("keyup", { key: "Alt", code: "AltLeft" });
  assert.equal(t.gBrowser.selectedTab, t.tabs[0], "Escape cancels");
}

// a bare Alt tap switches nothing and leaves the menu bar's behaviour alone; a leading 0 is nothing
{
  const t = load({ ...ON });
  t.fire("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  assert.ok(!t.fire("keyup", { key: "Alt", code: "AltLeft" }).defaultPrevented);
  t.fire("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  t.fire("keydown", digit(0));
  assert.equal(t.lit.size, 0);
}

// a digit with Alt down but no key event for Alt itself (virtual keyboards) starts the hold
{
  const t = load({ ...ON });
  t.fire("keydown", { key: "3", code: "Escape", altKey: true });
  assert.ok(t.attrs.has("omafire-numbers-held"));
  assert.equal([...t.lit][0], t.tabs[2]);
}

// off: with hold off, or tab-numbers off, Firefox's own Alt+digit is left alone
for (const prefs of [{ "omafire.tab-numbers": true }, { "omafire.tab-numbers-hold": true }, {}]) {
  const t = load(prefs);
  t.fire("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  assert.ok(!t.fire("keydown", digit(2)).defaultPrevented);
  assert.ok(!t.attrs.has("omafire-numbers-held"));
}

console.log("tab-numbers.test.js: ok");
