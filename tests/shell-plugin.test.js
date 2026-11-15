"use strict";

// The Omarchy shell plugin's model: rows in step with config/schema.json,
// and the status summary it shows.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const Model = require("../shell/omafire/Model.js");

const root = path.join(__dirname, "..");
const schema = JSON.parse(fs.readFileSync(path.join(root, "config/schema.json"), "utf8")).settings;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "shell/omafire/manifest.json"), "utf8"));

// Every setting has exactly one row, with the schema's values.
assert.deepEqual(Model.ROWS.map(r => r.key), schema.map(s => s.key));
for (const s of schema) {
  const row = Model.ROWS.find(r => r.key === s.key);
  switch (s.type) {
    case "enum":
      assert.equal(row.type, "choice", s.key);
      assert.deepEqual(row.options.map(o => o.value), s.values, s.key);
      break;
    case "bool":
      assert.equal(row.type, "toggle", s.key);
      break;
    case "chord":
      assert.equal(row.type, "chord", s.key);
      break;
    case "number":
      assert.equal(row.type, "slider", s.key);
      assert.equal(row.min, s.min, s.key);
      assert.equal(row.max, s.max, s.key);
      break;
    default:
      assert.fail(`${s.key}: no row type for ${s.type}`);
  }
}

// Rows follow the settings they depend on.
const defaults = Object.fromEntries(schema.map(s => [s.key, s.default]));
const keys = config => Model.visibleRows(config).map(r => r.key);
assert.deepEqual(keys(defaults),
  ["toolbar", "tabs", "density", "floating-page", "glass", "tab-numbers", "new-tab", "site-colors", "extension-glyphs",
   "key-zen", "key-layout", "key-glass", "key-settings"]);
const sidebar = keys({ ...defaults, toolbar: "sidebar", tabs: "vertical", glass: true });
for (const k of ["side", "launcher", "compact-sidebar", "opacity"]) assert.ok(sidebar.includes(k), k);
assert.ok(!sidebar.includes("floating-page"));
assert.ok(!keys(defaults).includes("launcher"));

// Stepping.
const opacity = Model.ROWS.find(r => r.key === "opacity");
assert.equal(Model.stepSlider(opacity, 0.82, 1), 0.87);
assert.equal(Model.stepSlider(opacity, 0.98, 1), 1);
assert.equal(Model.stepSlider(opacity, 0.52, -1), 0.5);
// the glass floor raises the minimum, and a value below it steps up to it
assert.equal(Model.stepSlider(opacity, 0.72, -1, 0.7), 0.7);
assert.equal(Model.stepSlider(opacity, 0.6, 1, 0.7), 0.7);
assert.equal(Model.stepSlider(opacity, 0.52, -1, 0), 0.5);
const toolbar = Model.ROWS.find(r => r.key === "toolbar");
assert.equal(Model.stepChoice(toolbar.options, "top", 1, true), "sidebar");
assert.equal(Model.stepChoice(toolbar.options, "sidebar", 1, true), "line");
assert.equal(Model.stepChoice(toolbar.options, "line", 1, true), "top");
assert.equal(Model.stepChoice(toolbar.options, "line", 1, false), "line");

// Status summary, from `omafire status --json`.
assert.equal(Model.summary(null).meta, "Reading status…");
const status = {
  theme: "elysian",
  hook: { path: "/h", present: true },
  firefox: { detected: true, profiles: [
    { path: "/home/u/.mozilla/firefox/3ix5m4nz.default-release", status: "configured", ok: true },
    { path: "/home/u/.mozilla/firefox/7aybxa48.default", status: "not configured", ok: false }] }
};
let s = Model.summary(status);
assert.equal(s.meta, "elysian · 1 thing needs setup");
assert.deepEqual(s.profiles.map(p => p.name), ["default-release", "default"]);
status.firefox.profiles[1].ok = true;
assert.equal(Model.summary(status).meta, "elysian · in sync");
status.hook.present = false;
s = Model.summary(status);
assert.equal(s.broken[0].name, "theme hook");

// The manifest names the entry point that exists.
assert.equal(manifest.id, "omafire");
assert.ok(fs.existsSync(path.join(root, "shell/omafire", manifest.entryPoints.barWidget)));

console.log("shell-plugin.test.js: ok");
