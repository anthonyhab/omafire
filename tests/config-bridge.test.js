"use strict";

// The Firefox side of the config bridge (chrome/config.sys.mjs), run in node
// against stubs for Services and Subprocess:
//   - a setting changed back while its `omafire set` is still running is
//     written again, not dropped;
//   - a `omafire set` that fails (nonzero exit, or no process) puts the prefs
//     back to the file's value instead of leaving them ahead of it;
//   - a sync that lands while no watcher runs (before the first is armed,
//     or between one's exit and the next) still refreshes the palette.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omafire-bridge-"));
const configFile = path.join(dir, "config.json");
fs.writeFileSync(configFile, "{}");
const schema = fs.readFileSync(path.join(root, "config", "schema.json"), "utf8");
const source = fs.readFileSync(path.join(root, "chrome", "config.sys.mjs"), "utf8")
  .replace(/^import \{ Subprocess \}.*$/m, "const Subprocess = globalThis.stub.Subprocess;")
  .replace(/^import \{ NetUtil \}.*$/m, "const NetUtil = globalThis.stub.NetUtil;")
  .replace(/^import \{ clearTimeout, setTimeout \}.*$/m, "");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A scripted `omafire watch`: lines are fed with say(); end() exits it.
function scriptedWatch() {
  const queue = [];
  let wake = null;
  const push = chunk => { queue.push(chunk); wake?.(); };
  return {
    say: line => push(`${line}\n`),
    end: () => push(""),
    process: {
      stdout: {readString: async () => {
        while (!queue.length) {
          await new Promise(resolve => { wake = resolve; });
        }
        return queue.shift();
      }},
      wait: async () => ({exitCode: 0}),
      kill() {},
    },
  };
}

const chromeDir = path.join(dir, "chrome");
fs.mkdirSync(chromeDir);
const palette = path.join(chromeDir, "omafire-palette.css");
let clock = 1700000000;
const sync = () => { fs.writeFileSync(palette, ":root {}"); fs.utimesSync(palette, ++clock, clock); };
sync();

async function session(name, onSet, watchers = []) {
  const calls = [];
  const notified = [];
  const values = new Map();
  const observers = [];
  const prefs = {
    PREF_BOOL: 128, PREF_INT: 64, PREF_STRING: 32,
    getPrefType: n => (typeof values.get(n) === "boolean" ? 128
      : typeof values.get(n) === "number" ? 64 : values.has(n) ? 32 : 0),
    getBoolPref: n => values.get(n),
    getIntPref: n => values.get(n),
    getStringPref: n => values.get(n),
    prefHasUserValue: n => values.has(n),
    clearUserPref: n => values.delete(n),
    addObserver: (_n, o) => observers.push(o),
  };
  for (const kind of ["Bool", "Int", "String"]) {
    prefs[`set${kind}Pref`] = (n, v) => {
      values.set(n, v);
      for (const o of observers) {
        o.observe(null, "nsPref:changed", n);
      }
    };
  }
  globalThis.Services = {
    prefs,
    env: {get: n => (n === "OMAFIRE_CONFIG" ? configFile : n === "OMAFIRE_BIN" ? "/bin/omafire" : "")},
    obs: {addObserver() {}, notifyObservers: (_s, topic) => notified.push(topic)},
    dirsvc: {get: () => ({path: chromeDir})},
  };
  globalThis.PathUtils = {join: (...p) => p.join("/")};
  globalThis.IOUtils = {stat: async p => ({lastModified: fs.statSync(p).mtimeMs})};
  globalThis.Cc = {
    "@mozilla.org/file/local;1": {createInstance: () => ({initWithPath(p) { this.p = p; }})},
    "@mozilla.org/network/file-input-stream;1": {createInstance: () => ({
      init(file) { this.text = fs.readFileSync(file.p, "utf8"); },
      available() {},
      close() {},
    })},
  };
  globalThis.Ci = {};
  globalThis.stub = {
    NetUtil: {
      newChannel: () => ({open: () => ({text: schema, available() {}, close() {}})}),
      readInputStreamToString: stream => stream.text,
    },
    Subprocess: {
      async call({arguments: args}) {
        if (args[0] === "watch") {
          const next = watchers.shift();
          return next ? next.process
            : {stdout: {readString: () => new Promise(() => {})}, wait: () => new Promise(() => {}), kill() {}};
        }
        calls.push(args.slice(1).join(" "));
        const result = await onSet(calls.length);
        return {stderr: {readString: async () => ""}, wait: async () => ({exitCode: result})};
      },
      pathSearch: async () => "/bin/omafire",
    },
  };
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, source.replace("import.meta.url", `"file://${root}/chrome/x"`));
  const {OmafireConfig} = await import(file);
  OmafireConfig.start();
  await sleep(20);
  return {calls, prefs, values, notified};
}

(async () => {
  // s6q: glass true goes out; while it runs the user sets it back to false.
  {
    let release;
    const first = new Promise(resolve => { release = resolve; });
    const s = await session("reversal", async n => { if (n === 1) { await first; } return 0; });
    s.prefs.setBoolPref("omafire.translucency", true);
    await sleep(350);
    assert.deepEqual(s.calls, ["glass true"]);
    s.prefs.setBoolPref("omafire.translucency", false);
    release();
    await sleep(450);
    assert.deepEqual(s.calls, ["glass true", "glass false"]);
    assert.equal(s.values.get("omafire.translucency"), false);
  }
  // 72s: the CLI refuses the write; the pref returns to the file's value.
  {
    const s = await session("refused", async () => 1);
    s.prefs.setBoolPref("omafire.translucency", true);
    await sleep(450);
    assert.deepEqual(s.calls, ["glass true"]);
    assert.equal(s.values.get("omafire.translucency"), false);
  }
  // 72s: the CLI cannot be started at all.
  {
    const s = await session("nostart", async () => { throw new Error("spawn failed"); });
    s.prefs.setBoolPref("omafire.translucency", true);
    await sleep(450);
    assert.equal(s.values.get("omafire.translucency"), false);
  }
  // 7n3/S8: nothing changed by the time the watcher arms: no refresh.
  {
    const w = scriptedWatch();
    const s = await session("quiet", async () => 0, [w]);
    w.say("{}");
    await sleep(30);
    assert.deepEqual(s.notified, []);
    w.say("palette");     // a sync while it watches, as before
    await sleep(30);
    assert.deepEqual(s.notified, ["omafire-palette-changed"]);
  }
  // A sync before the first watcher is armed is caught when it arms.
  {
    const w = scriptedWatch();
    const s = await session("early", async () => 0, [w]);
    sync();
    w.say("{}");
    await sleep(30);
    assert.deepEqual(s.notified, ["omafire-palette-changed"]);
  }
  // A sync in the gap between a watcher's exit and the next one.
  {
    const [first, second] = [scriptedWatch(), scriptedWatch()];
    const s = await session("gap", async () => 0, [first, second]);
    first.say("{}");
    await sleep(30);
    first.end();
    await sleep(100);
    sync();
    await sleep(1000);    // the restart delay
    second.say("{}");
    await sleep(30);
    assert.deepEqual(s.notified, ["omafire-palette-changed"]);
  }
  fs.rmSync(dir, {recursive: true});
  console.log("config-bridge.test.js: ok");
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
