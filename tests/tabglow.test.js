"use strict";

const assert = require("node:assert/strict");
const { dominantColor } = require("../extension/tabglow.js");

function pixels(list) {
  return Uint8ClampedArray.from(list.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
}

// A mostly-orange icon with a white glyph: the glow is orange, lifted for a
// dark palette.
const orange = dominantColor(pixels([...Array(60).fill([255, 102, 0]), ...Array(40).fill([255, 255, 255])]));
assert.match(orange, /^hsl\((2[0-9]) \d+% 62%\)$/);

// Greyscale and transparent icons have no colour to offer.
assert.equal(dominantColor(pixels(Array(100).fill([128, 128, 128]))), null);
assert.equal(dominantColor(pixels(Array(100).fill([255, 0, 0, 0]))), null);

// Hue averaging is circular: reds either side of 0° average to red, not cyan.
const red = dominantColor(pixels([...Array(50).fill([255, 0, 30]), ...Array(50).fill([255, 30, 0])]));
assert.match(red, /^hsl\((35[0-9]|[0-9]) /);

console.log("tabglow.test.js: ok");
