"use strict";

const assert = require("node:assert/strict");
const { createAssembler, isWallpaperMessage } = require("../extension/wallpaper.js");

const bytes = Uint8Array.from({ length: 1300 }, (_, i) => (i * 7) % 256);
const chunk = (index, from, to, extra = {}) => ({
  protocol: "omafox", version: 1, action: "wallpaper", id: "a", mime: "image/jpeg",
  size: bytes.length, index, count: 3, data: Buffer.from(bytes.slice(from, to)).toString("base64"), ...extra
});

(async () => {
  assert.equal(isWallpaperMessage(chunk(0, 0, 1)), true);
  assert.equal(isWallpaperMessage({ protocol: "omafox", action: "theme-set" }), false);

  // In-order chunks reassemble to the exact bytes.
  const accept = createAssembler();
  assert.equal(accept(chunk(0, 0, 500)), null);
  assert.equal(accept(chunk(1, 500, 1000)), null);
  const done = accept(chunk(2, 1000, 1300));
  assert.equal(done.id, "a");
  assert.equal(done.blob.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await done.blob.arrayBuffer()), bytes);

  // A skipped chunk drops the image; the next index 0 starts over.
  const gappy = createAssembler();
  gappy(chunk(0, 0, 500));
  assert.equal(gappy(chunk(2, 1000, 1300)), null);
  gappy(chunk(0, 0, 500));
  gappy(chunk(1, 500, 1000));
  assert.ok(gappy(chunk(2, 1000, 1300)).blob);

  // A size mismatch is rejected; "no wallpaper" clears.
  const short = createAssembler();
  short(chunk(0, 0, 500));
  short(chunk(1, 500, 1000));
  assert.equal(short(chunk(2, 1000, 1200)), null);
  assert.deepEqual(createAssembler()({ protocol: "omafox", action: "wallpaper", id: "", count: 0 }), { id: "", blob: null });

  console.log("wallpaper.test.js: ok");
})();
