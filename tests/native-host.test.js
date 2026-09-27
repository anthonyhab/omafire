"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const projectDir = path.resolve(__dirname, "..");
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "omafire-native-host-"));
// The host as built (tests/run.sh runs make first).
const hostPath = process.env.OMAFIRE_NATIVE_HOST_BIN
  || path.join(projectDir, "build", "omafire-native-host");
const stateFile = path.join(testDir, "theme.json");
const firstMessage = {
  protocol: "omafox",
  version: 1,
  action: "theme-set",
  theme: "first",
  palette: {}
};
const secondMessage = { ...firstMessage, theme: "second" };
const firstPayload = JSON.stringify(firstMessage);
const secondPayload = JSON.stringify(secondMessage);
const wallpaperDir = path.join(testDir, "omarchy", "current");
const wallpaperLink = path.join(wallpaperDir, "background");
const imageDir = path.join(testDir, "backgrounds");
const firstImage = path.join(imageDir, "first.jpg");
const secondImage = path.join(imageDir, "second.PNG");
const firstImageBytes = crypto.randomBytes(1300 * 1024);
const secondImageBytes = crypto.randomBytes(600 * 1024 + 1);
const nativeMessageLimit = 1024 * 1024;
const chunkBytes = 512 * 1024;

function waitFor(predicate, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 2000);
    const check = () => {
      if (predicate()) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

(async () => {
  fs.writeFileSync(stateFile, `${firstPayload}\n`, { mode: 0o600 });
  fs.mkdirSync(wallpaperDir, { recursive: true });
  fs.mkdirSync(imageDir);
  fs.writeFileSync(firstImage, firstImageBytes);
  fs.writeFileSync(secondImage, secondImageBytes);
  fs.symlinkSync(firstImage, wallpaperLink);

  const child = spawn(hostPath, [], {
    env: {
      ...process.env,
      OMAFIRE_STATE_FILE: stateFile,
      OMAFIRE_WALLPAPER_FILE: wallpaperLink
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const all = [];
  const messages = [];
  const wallpapers = [];
  let output = Buffer.alloc(0);
  let errors = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  child.stdout.on("data", (chunk) => {
    output = Buffer.concat([output, chunk]);
    while (output.length >= 4) {
      const length = os.endianness() === "LE"
        ? output.readUInt32LE(0)
        : output.readUInt32BE(0);
      if (output.length < 4 + length) return;
      assert.ok(length < nativeMessageLimit, `native message of ${length} bytes`);
      const message = JSON.parse(output.subarray(4, 4 + length).toString("utf8"));
      all.push(message);
      (message.action === "wallpaper" ? wallpapers : messages).push(message);
      output = output.subarray(4 + length);
    }
  });

  // Reassembles the complete image that starts at wallpapers[start].
  function wallpaperAt(start) {
    const first = wallpapers[start];
    const parts = [];
    for (let index = 0; index < first.count; index++) {
      const chunk = wallpapers[start + index];
      assert.deepEqual(
        Object.keys(chunk),
        ["protocol", "version", "action", "id", "mime", "size", "index", "count", "data"]
      );
      assert.equal(chunk.protocol, "omafox");
      assert.equal(chunk.version, 1);
      assert.equal(chunk.id, first.id);
      assert.equal(chunk.mime, first.mime);
      assert.equal(chunk.size, first.size);
      assert.equal(chunk.count, first.count);
      assert.equal(chunk.index, index);
      const data = Buffer.from(chunk.data, "base64");
      assert.equal(data.toString("base64"), chunk.data);
      assert.ok(data.length <= chunkBytes);
      parts.push(data);
    }
    const bytes = Buffer.concat(parts);
    assert.equal(bytes.length, first.size);
    return { id: first.id, mime: first.mime, count: first.count, bytes };
  }

  try {
    await waitFor(() => messages.length >= 1, "native host did not send initial state");
    assert.deepEqual(messages[0], firstMessage);
    assert.deepEqual(all[0], firstMessage, "theme must precede the wallpaper");

    await waitFor(() => wallpapers.length >= 3, "native host did not send the wallpaper");
    const initial = wallpaperAt(0);
    assert.equal(initial.count, 3);
    assert.equal(initial.mime, "image/jpeg");
    assert.ok(initial.id.length > 0);
    assert.ok(initial.bytes.equals(firstImageBytes), "wallpaper bytes differ");
    assert.deepEqual(all.slice(1, 4), wallpapers.slice(0, 3), "chunks are not consecutive");

    const nextStateFile = path.join(testDir, ".theme.json.next");
    fs.writeFileSync(nextStateFile, `${secondPayload}\n`, { mode: 0o600 });
    fs.renameSync(nextStateFile, stateFile);
    await waitFor(() => messages.length >= 2, "native host did not send changed state");
    assert.deepEqual(messages[1], secondMessage);

    fs.unlinkSync(stateFile);
    const restoredStateFile = path.join(testDir, ".theme.json.restored");
    fs.writeFileSync(restoredStateFile, `${secondPayload}\n`, { mode: 0o600 });
    fs.renameSync(restoredStateFile, stateFile);
    await waitFor(
      () => messages.length >= 3,
      "native host did not resend state after recreation"
    );
    assert.deepEqual(messages[2], secondMessage);
    assert.equal(wallpapers.length, 3, "theme changes resent an unchanged wallpaper");

    // Omarchy swaps the wallpaper with ln -nsf: a new link renamed over the old.
    const nextLink = path.join(wallpaperDir, ".background.next");
    fs.symlinkSync(secondImage, nextLink);
    fs.renameSync(nextLink, wallpaperLink);
    await waitFor(() => wallpapers.length >= 5, "native host did not send the new wallpaper");
    const replaced = wallpaperAt(3);
    assert.equal(replaced.count, 2);
    assert.equal(replaced.mime, "image/png");
    assert.notEqual(replaced.id, initial.id);
    assert.ok(replaced.bytes.equals(secondImageBytes), "replaced wallpaper bytes differ");

    fs.unlinkSync(wallpaperLink);
    const empty = {
      protocol: "omafox",
      version: 1,
      action: "wallpaper",
      id: "",
      count: 0
    };
    await waitFor(() => wallpapers.length >= 6, "native host did not report a removed wallpaper");
    assert.deepEqual(wallpapers[5], empty);

    // An unsupported image type counts as no wallpaper and is not resent.
    const textFile = path.join(imageDir, "notes.txt");
    fs.writeFileSync(textFile, "not an image");
    fs.symlinkSync(textFile, wallpaperLink);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(wallpapers.length, 6, "unsupported wallpaper produced a message");
    fs.symlinkSync(firstImage, nextLink);
    fs.renameSync(nextLink, wallpaperLink);
    await waitFor(() => wallpapers.length >= 9, "native host did not resend the wallpaper");
    const restored = wallpaperAt(6);
    assert.equal(restored.id, initial.id);
    assert.ok(restored.bytes.equals(firstImageBytes));
    assert.equal(wallpapers.length, 9);
    assert.equal(messages.length, 3);

    child.stdin.end();
    const [exitCode] = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (...args) => resolve(args));
    });
    assert.equal(exitCode, 0, errors);
    assert.equal(output.length, 0, "native host emitted an incomplete frame");
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  console.log("native-host.test.js: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
