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
        `        parseCssColor, composite, relativeLuminance, contrastRatio, chooseFilter, evaluate,\n` +
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
closeTo(
    api.contrastRatio(
        api.relativeLuminance(255, 255, 255),
        api.relativeLuminance(0, 0, 0),
    ),
    21,
);

/* ------------------------------------------------------------------ *
 *  Decision-model fixtures: 32×32 icons matching SAMPLE_SIZE.          *
 * ------------------------------------------------------------------ */
const PIXELS = 32 * 32;
const icon = paint => {
    const result = {
        red: new Uint8Array(PIXELS),
        green: new Uint8Array(PIXELS),
        blue: new Uint8Array(PIXELS),
        alphas: new Float32Array(PIXELS),
    };
    for (let index = 0; index < PIXELS; index++) {
        const pixel = paint(index % 32, (index / 32) | 0);
        result.red[index] = pixel[0];
        result.green[index] = pixel[1];
        result.blue[index] = pixel[2];
        result.alphas[index] = pixel[3] ?? 1;
    }
    return result;
};
// A glyph is an opaque 16×16 mark centered on transparency.
const glyph = (r, g, b) =>
    icon((x, y) =>
        x >= 8 && x < 24 && y >= 8 && y < 24 ? [r, g, b] : [0, 0, 0, 0],
    );
// A tile fills the canvas: tile color outside, glyph color inside.
const tile = (tr, tg, tb, gr, gg, gb) =>
    icon((x, y) =>
        x >= 8 && x < 24 && y >= 8 && y < 24
            ? [gr, gg, gb]
            : [tr, tg, tb],
    );
const solid = (r, g, b) => icon(() => [r, g, b]);

const LIGHT = { r: 244, g: 244, b: 245, a: 1 };
const DARK = { r: 30, g: 30, b: 46, a: 1 };
const choice = (iconPixels, bg) => api.evaluate(iconPixels, bg).choice;

// Glyph silhouettes: readable stays original, invisible gets treated.
assert.equal(choice(glyph(255, 255, 255), LIGHT), "huefix");
assert.equal(choice(glyph(255, 255, 255), DARK), "original");
assert.equal(choice(glyph(0, 0, 0), LIGHT), "original");
assert.equal(choice(glyph(0, 0, 0), DARK), "huefix");

// Interior channel: a tile whose glyph paints strong contrast reads
// through its content even when its rim blends into the surface.
assert.equal(choice(tile(255, 255, 255, 0, 0, 0), LIGHT), "original");
assert.equal(choice(tile(20, 20, 30, 240, 240, 245), LIGHT), "original");
// Faint interior content is not enough — it must be treated.
assert.notEqual(choice(tile(255, 255, 255, 225, 225, 230), LIGHT), "original");

// A featureless tile has no interior and no readable rim: it must be
// treated on the matching background and left alone on the other.
assert.notEqual(choice(solid(255, 255, 255), LIGHT), "original");
assert.equal(choice(solid(0, 0, 0), LIGHT), "original");
assert.notEqual(choice(solid(0, 0, 0), DARK), "original");
assert.equal(choice(solid(255, 255, 255), DARK), "original");

// Mid-tones read on both surfaces: leave them alone.
assert.equal(choice(glyph(150, 150, 155), LIGHT), "original");
assert.equal(choice(glyph(150, 150, 155), DARK), "original");

// The surface-visibility gate: a light halo or plate cannot be picked
// on a light surface (and dark variants cannot on a dark one) — the
// added surface would be invisible, so the treatment is a no-op.
{
    const faint = glyph(240, 240, 242);
    const lightResults = api.evaluate(faint, LIGHT, true).results;
    assert.equal(lightResults["halo-l"].legible, false);
    assert.equal(lightResults["plate-l"].legible, false);
    const darkResults = api.evaluate(glyph(15, 15, 20), DARK, true).results;
    assert.equal(darkResults["halo-d"].legible, false);
    assert.equal(darkResults["plate-d"].legible, false);
}

// detailLoss keeps flattening honest: on an icon with real internal
// structure, dark/light erase the content while huefix preserves it.
{
    const structured = tile(250, 250, 252, 30, 60, 200);
    const results = api.evaluate(structured, LIGHT, true).results;
    assert.ok(
        results.dark.detailLoss > results.huefix.detailLoss,
        "flattening a structured icon should lose more detail",
    );
}

// all=true scores every candidate, and the reported choice is always
// either "original" or a mode the gates marked legible.
{
    const ev = api.evaluate(glyph(250, 250, 252), LIGHT, true);
    const modes = Object.keys(ev.results);
    assert.ok(modes.length >= 10, "expected every candidate scored");
    assert.ok(
        ev.choice === "original" || ev.results[ev.choice].legible,
        "choice must be original or a legible treatment",
    );
}

// Fallback margin: a hopeless icon — weak on every treatment, with no
// candidate clearly better — is left alone rather than recolored into
// a different kind of unreadable. The corpus supplies one when present.
{
    const corpusDir = path.join(root, "tests", "favicon-corpus");
    const scoresPath = path.join(corpusDir, "scores.json");
    if (fs.existsSync(scoresPath)) {
        const scores = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
        const hopeless = scores.find(
            entry =>
                entry.bgs["#f4f4f5"].choice === "original" &&
                entry.bgs["#f4f4f5"].modes.original.ok === false &&
                fs.existsSync(
                    path.join(corpusDir, "raw", `${entry.sha}.rgba`),
                ),
        );
        if (hopeless) {
            const raw = fs.readFileSync(
                path.join(corpusDir, "raw", `${hopeless.sha}.rgba`),
            );
            const pixels = {
                red: new Uint8Array(PIXELS),
                green: new Uint8Array(PIXELS),
                blue: new Uint8Array(PIXELS),
                alphas: new Float32Array(PIXELS),
            };
            for (let index = 0, offset = 0; index < PIXELS; index++, offset += 4) {
                pixels.red[index] = raw[offset];
                pixels.green[index] = raw[offset + 1];
                pixels.blue[index] = raw[offset + 2];
                pixels.alphas[index] = raw[offset + 3] / 255;
            }
            const ev = api.evaluate(pixels, LIGHT, true);
            assert.equal(ev.results.original.legible, false);
            assert.equal(ev.choice, "original");
        }
    }
}

console.log("favicon contrast core test passed");
