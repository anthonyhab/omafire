"use strict";

// The contrast floors of omafire-v2z.7, over every palette in
// fixtures/palettes.json (the installed Omarchy themes, as omafire sync
// normalizes them). Method and model: contrast.js.
const assert = require("node:assert/strict");
const { measure } = require("./contrast.js");
const palettes = require("./fixtures/palettes.json");

const rows = measure(palettes);
assert.ok(rows.length >= 40, "palettes.json lost themes");
assert.ok(rows.some((r) => r.theme === "rose-pine"), "rose-pine is the case this guards");

const floors = {
  focus: 3,      // WCAG 1.4.11, non-text UI
  glowEdge: 3,
  label: 4.5,    // text, on rest and hover
  dim: 3,        // metadata and glyph tier, held at 3:1 (DEC draft in the bead)
  navLabel: 4.6, // selected nav label: no regression from TASK-13
  primary: 4.1   // primary-button text on its glow: no regression
};
for (const r of rows) {
  for (const [key, floor] of Object.entries(floors)) {
    if (r[key] == null) continue;
    assert.ok(r[key] >= floor,
      `${r.theme} (${r.doc}): ${key} ${r[key].toFixed(2)} < ${floor}`);
  }
}

console.log("contrast.test.js: ok");
