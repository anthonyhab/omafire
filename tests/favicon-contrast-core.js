#!/usr/bin/env node


const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "favicon-contrast.uc.js");
const marker = "    const style = document.createElementNS(HTML_NS, \"style\");";
let source = fs.readFileSync(sourcePath, "utf8");
assert.ok(source.includes(marker), "favicon helper test injection marker is missing");
source = source.replace(
    marker,
    `    globalThis.__faviconContrastTestApi = {\n` +
        `        parseCssColor, composite, relativeLuminance, contrastRatio, chooseFilter,\n` +
        `    };\n` +
        `    return;\n\n` +
        marker,
);

const context = {
    Components: { utils: { reportError() {} } },
    window: {},
};
vm.runInNewContext(source, context, { filename: sourcePath });
const api = context.__faviconContrastTestApi;
assert.ok(api, "favicon helper did not expose its injected test API");

const closeTo = (actual, expected, epsilon = 1e-9) => {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`,
    );
};
const assertColor = (value, expected) => {
    const actual = api.parseCssColor(value);
    assert.ok(actual, `expected ${value} to parse`);
    for (const channel of ["r", "g", "b", "a"]) {
        closeTo(actual[channel], expected[channel]);
    }
};

assertColor("#abc", { r: 170, g: 187, b: 204, a: 1 });
assertColor("#1234", { r: 17, g: 34, b: 51, a: 68 / 255 });
assertColor("#11223380", { r: 17, g: 34, b: 51, a: 128 / 255 });
assertColor("rgb(10 20 30 / 40%)", { r: 10, g: 20, b: 30, a: 0.4 });
assertColor("color(srgb 1 0.5 0 / 25%)", {
    r: 255,
    g: 127.5,
    b: 0,
    a: 0.25,
});
assert.equal(api.parseCssColor("transparent"), null);
assert.equal(api.parseCssColor("#12345"), null);
assert.equal(api.parseCssColor("not-a-color"), null);

const composited = api.composite(
    { r: 255, g: 0, b: 0, a: 0.5 },
    { r: 0, g: 0, b: 255, a: 1 },
);
closeTo(composited.r, 127.5);
closeTo(composited.g, 0);
closeTo(composited.b, 127.5);
closeTo(composited.a, 1);
closeTo(
    api.contrastRatio(
        api.relativeLuminance(255, 255, 255),
        api.relativeLuminance(0, 0, 0),
    ),
    21,
);

const onePixelIcon = (hash, value) => ({
    hash,
    red: new Uint8Array([value]),
    green: new Uint8Array([value]),
    blue: new Uint8Array([value]),
    alphas: new Float32Array([1]),
});
assert.equal(
    api.chooseFilter(onePixelIcon("black", 0), { r: 255, g: 255, b: 255 }),
    "original",
);
assert.equal(
    api.chooseFilter(onePixelIcon("white", 255), { r: 255, g: 255, b: 255 }),
    "invert",
);

console.log("favicon contrast core test passed");
