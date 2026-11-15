// The chrome script loader (chrome/omafire.cfg), run against stub Firefox
// services: which window actors and modules it starts for a profile's prefs.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../chrome/omafire.cfg"), "utf8");

function start(boolPrefs, stringPrefs = {}) {
  const observers = {};
  const actors = [];
  const modules = [];
  const services = {
    "@mozilla.org/file/directory_service;1": {
      get: () => ({ append() {}, exists: () => true, isDirectory: () => true }),
    },
    "@mozilla.org/network/io-service;1": {
      getProtocolHandler: () => ({
        QueryInterface: () => ({ hasSubstitution: () => true, setSubstitution() {} }),
      }),
      newFileURI: () => ({}),
    },
    "@mozilla.org/preferences-service;1": {
      getBoolPref: (name, fallback) => (name in boolPrefs ? boolPrefs[name] : fallback),
      getStringPref: (name, fallback) => (name in stringPrefs ? stringPrefs[name] : fallback),
    },
    "@mozilla.org/moz/jssubscript-loader;1": { loadSubScript() {} },
    "@mozilla.org/consoleservice;1": { logStringMessage(message) { throw new Error(message); } },
    "@mozilla.org/observer-service;1": {
      addObserver(observer, topic) { observers[topic] = observer; },
      removeObserver(observer, topic) { delete observers[topic]; },
    },
  };
  const Components = {
    classes: new Proxy({}, { get: (_, id) => ({ getService: () => services[id] }) }),
    interfaces: new Proxy({}, { get: (_, name) => name }),
  };
  const ChromeUtils = {
    registerWindowActor(name, options) { actors.push({ name, options }); },
    importESModule(uri) {
      modules.push(uri);
      return { OmafireConfig: { start() {} }, OmafireSiteScheme: { start() {} } };
    },
  };
  vm.runInNewContext(source, { Components, ChromeUtils });
  observers["final-ui-startup"].observe();
  return { actors: actors.map(a => a.name), modules };
}

// An unmanaged profile gets nothing at all.
assert.deepStrictEqual(start({}), { actors: [], modules: [] });

// A managed profile: no page can reach the pseudo-state actor (any site
// could dispatch omafire:pseudo and learn omafire is installed) until the
// profile opts in.
const managed = start({ "omafire.managed": true });
assert.deepStrictEqual(managed.actors, []);
assert.ok(managed.modules.includes("resource://omafire/config.sys.mjs"));
assert.ok(managed.modules.includes("resource://omafire/site-scheme.sys.mjs"));

// Opted in, for Cinder's inspector: the actor answers pages.
assert.deepStrictEqual(
  start({ "omafire.managed": true, "omafire.pseudo-state": true }).actors, ["OmafirePseudo"]);

// The scripts switches still win over the opt-in.
assert.deepStrictEqual(start({ "omafire.managed": true, "omafire.pseudo-state": true },
  { "omafire.scripts.disabled": "keys, pseudo-state" }).actors, []);
assert.deepStrictEqual(
  start({ "omafire.managed": true, "omafire.pseudo-state": true, "omafire.scripts": false }).actors, []);

console.log("omafire-cfg.test.js: ok");
