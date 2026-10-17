// Omafire settings in Firefox: ~/.config/omafire/config.json drives prefs.
//
// The theme reads prefs with -moz-pref(), so prefs stay what renders; this
// module keeps them equal to the file. omafire.cfg starts it once per
// session, before the first window shows:
//
//   1. The file is read synchronously and applied, so the first frame
//      already has the settings. With no file yet, this profile's own
//      user-set prefs seed it (`omafire set --if-missing`).
//   2. `omafire watch` runs as a child process and prints the settings as a
//      JSON line on every change; each changed setting is applied.
//      A "palette" line (a sync wrote a new palette) and a "wallpaper" line
//      (Omarchy's wallpaper changed) are passed on as the
//      omafire-palette-changed and omafire-wallpaper-changed notifications.
//   3. A mapped pref changed in Firefox (the Omafire panel, a keybinding,
//      about:config) goes back through `omafire set`, which validates it and
//      wakes every other Firefox through its own watch.
//
// Keys, types, defaults and the pref each setting drives come from
// config-schema.json beside this file, the schema the CLI embeds.
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const LOG = "[omafire:config]";
const prefs = Services.prefs;

function readSync(file) {
  const stream = Cc["@mozilla.org/network/file-input-stream;1"]
    .createInstance(Ci.nsIFileInputStream);
  stream.init(file, -1, 0, 0);
  try {
    return NetUtil.readInputStreamToString(stream, stream.available(), {charset: "UTF-8"});
  } finally {
    stream.close();
  }
}

function localFile(path) {
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  return file;
}

// Beside this module: /usr/lib/firefox/omafire/ in the package.
const SCHEMA = (() => {
  const channel = NetUtil.newChannel({
    uri: new URL("config-schema.json", import.meta.url).href,
    loadUsingSystemPrincipal: true,
  });
  const stream = channel.open();
  try {
    return JSON.parse(NetUtil.readInputStreamToString(stream, stream.available(),
      {charset: "UTF-8"})).settings;
  } finally {
    stream.close();
  }
})();

const env = name => Services.env.get(name);
const CONFIG_PATH = env("OMAFIRE_CONFIG")
  || PathUtils.join(env("XDG_CONFIG_HOME") || PathUtils.join(env("HOME"), ".config"),
    "omafire", "config.json");

// ---- values ---------------------------------------------------------------

function valid(setting, v) {
  switch (setting.type) {
    case "enum": return typeof v === "string" && setting.values.includes(v);
    case "bool": return typeof v === "boolean";
    case "number": return typeof v === "number" && v >= setting.min && v <= setting.max;
    case "chord": return typeof v === "string" && (v === "" || CHORD.test(v));
  }
  return false;
}

// The file's value where it is set and valid, else the default: what the
// CLI's Effective does.
function effective(file) {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    file = {};
  }
  const out = {};
  for (const s of SCHEMA) {
    out[s.key] = s.key in file && valid(s, file[s.key]) ? file[s.key] : s.default;
  }
  return out;
}

// What CLI word `omafire set` takes for a value.
const word = v => String(v);

// ---- prefs ----------------------------------------------------------------

function readPref(name) {
  switch (prefs.getPrefType(name)) {
    case prefs.PREF_BOOL: return prefs.getBoolPref(name);
    case prefs.PREF_INT: return prefs.getIntPref(name);
    case prefs.PREF_STRING: return prefs.getStringPref(name);
  }
  return undefined;
}

// A shortcut: modifiers plus one letter or digit (config/config.go's chordPattern).
const CHORD = /^((ctrl|control|alt|shift|super|meta)\+)+[a-z0-9]$/i;

function writePref(name, value) {
  if (readPref(name) === value) {
    return;
  }
  const set = () => {
    if (typeof value === "boolean") {
      prefs.setBoolPref(name, value);
    } else if (typeof value === "number") {
      prefs.setIntPref(name, value);
    } else {
      prefs.setStringPref(name, value);
    }
  };
  try {
    set();
  } catch {
    // A user value of another type: replace it.
    prefs.clearUserPref(name);
    set();
  }
}

function prefValue(pref, v) {
  if ("const" in pref) {
    return pref.const;
  }
  if (pref.map) {
    return pref.map[v];
  }
  if (pref.format === "fixed2") {
    return v.toFixed(2);
  }
  return v;
}

// The setting as the prefs hold it, or undefined when they hold nothing
// valid for it. A constant pref that does not hold its constant means the
// setting is off.
function fromPrefs(setting) {
  let value;
  for (const pref of setting.prefs) {
    const raw = readPref(pref.name);
    if ("const" in pref) {
      if (raw !== pref.const) {
        return setting.default;
      }
      continue;
    }
    if (raw === undefined) {
      return undefined;
    }
    if (pref.map) {
      value = Object.keys(pref.map).find(k => pref.map[k] === raw);
    } else if (pref.format === "fixed2") {
      value = Number.parseFloat(raw);
    } else {
      value = raw;
    }
  }
  return valid(setting, value) ? value : undefined;
}

function userSet(setting) {
  return setting.prefs.some(p => !("const" in p) && prefs.prefHasUserValue(p.name));
}

// ---- the session ------------------------------------------------------------

let started = false;
let current = null;       // the settings last applied from the file
let applying = false;
const pending = new Map(); // key -> value waiting to go through `omafire set`
let flushTimer = null;
let inFlight = false;
let batchInFlight = new Map(); // key -> value the running `omafire set` is writing
let binary = null;
let watcher = null;
let stopping = false;

function apply(values, keys = SCHEMA.map(s => s.key)) {
  applying = true;
  try {
    for (const key of keys) {
      // The user is still changing it here, unless the change is the write
      // in flight: then the file holds set's answer to it.
      if (pending.has(key) && pending.get(key) !== batchInFlight.get(key)) {
        continue;
      }
      const setting = SCHEMA.find(s => s.key === key);
      for (const pref of setting.prefs) {
        try {
          writePref(pref.name, prefValue(pref, values[key]));
        } catch (error) {
          console.error(LOG, pref.name, error);
        }
      }
    }
  } finally {
    applying = false;
  }
}

async function findBinary() {
  if (!binary) {
    binary = env("OMAFIRE_BIN") || await Subprocess.pathSearch("omafire")
      .catch(() => "/usr/bin/omafire");
  }
  return binary;
}

async function run(args) {
  const proc = await Subprocess.call({
    command: await findBinary(), arguments: args, stderr: "pipe",
  });
  const [err, {exitCode}] = await Promise.all([proc.stderr.readString(), proc.wait()]);
  if (exitCode !== 0 || err) {
    console.error(LOG, `omafire ${args.join(" ")}:`, exitCode, err.trim());
  }
  if (exitCode !== 0) {
    throw new Error(`omafire ${args[0]} exited ${exitCode}`);
  }
}

async function flush() {
  flushTimer = null;
  if (inFlight || !pending.size) {
    return;
  }
  inFlight = true;
  const batch = new Map(pending);
  batchInFlight = batch;
  let written = false;
  try {
    await run(["set", ...[...batch].flatMap(([k, v]) => [k, word(v)])]);
    written = true;
  } catch (error) {
    console.error(LOG, error);
  } finally {
    inFlight = false;
    batchInFlight = new Map();
    const revert = [];
    for (const [k, v] of batch) {
      if (pending.get(k) === v) {
        pending.delete(k);
        if (!written) {
          revert.push(k);     // refused: the prefs go back to the file's value
        }
      }
    }
    if (revert.length && current) {
      apply(current, revert);
    }
    if (pending.size) {
      schedule();
    }
  }
}

function schedule() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 250);
}

const observer = {
  observe(_subject, _topic, name) {
    if (applying || !current) {
      return;
    }
    for (const setting of SCHEMA) {
      if (!setting.prefs.some(p => p.name === name)) {
        continue;
      }
      const value = fromPrefs(setting);
      // What this change must beat: the value a running write is about to
      // make the file's, else the file's own.
      const settled = batchInFlight.has(setting.key)
        ? batchInFlight.get(setting.key) : current[setting.key];
      if (value === undefined || value === settled) {
        pending.delete(setting.key);
        continue;
      }
      // last changed last: omafire set lets the later of a coupled pair win
      pending.delete(setting.key);
      pending.set(setting.key, value);
      schedule();
    }
  },
};

async function watch() {
  let delay = 1000;
  while (!stopping) {
    try {
      watcher = await Subprocess.call({
        command: await findBinary(), arguments: ["watch"], stdin: "pipe", stderr: "stdout",
      });
      let buffer = "";
      for (;;) {
        const chunk = await watcher.stdout.readString();
        if (!chunk) {
          break;
        }
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line === "palette" || line === "wallpaper") {
            Services.obs.notifyObservers(null, `omafire-${line}-changed`);
            continue;
          }
          if (!line.startsWith("{")) {
            console.error(LOG, line);   // the CLI's warnings
            continue;
          }
          let values;
          try {
            values = effective(JSON.parse(line));
          } catch (error) {
            console.error(LOG, "watch line:", error);
            continue;
          }
          // Against the prefs, not the last line: a set may answer a change
          // made here with a different value (omafire set couples the
          // toolbar and the tabs), which the file alone shows as no change.
          const changed = SCHEMA.filter(s => values[s.key] !== (fromPrefs(s) ?? s.default))
            .map(s => s.key);
          current = values;
          apply(values, changed);
          delay = 1000;
        }
      }
      await watcher.wait();
    } catch (error) {
      console.error(LOG, "watch:", error);
    }
    watcher = null;
    if (!stopping) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 60000);
    }
  }
}

// Seed the file from this profile's user-set prefs, then follow it.
async function seed() {
  const args = [];
  for (const setting of SCHEMA) {
    const value = userSet(setting) ? fromPrefs(setting) : undefined;
    if (value !== undefined && value !== setting.default) {
      args.push(setting.key, word(value));
    }
  }
  if (args.length) {
    await run(["set", "--if-missing", ...args]);
  }
}

export const OmafireConfig = {
  path: CONFIG_PATH,

  start() {
    if (started) {
      return;
    }
    started = true;

    let text = null;
    try {
      text = readSync(localFile(CONFIG_PATH));
    } catch {
      // no file yet
    }
    let seeding = null;
    if (text === null) {
      current = null;
      seeding = seed().catch(error => console.error(LOG, "seed:", error));
    } else {
      try {
        current = effective(JSON.parse(text || "{}"));
        apply(current);
      } catch (error) {
        console.error(LOG, `${CONFIG_PATH}:`, error);
      }
    }

    for (const setting of SCHEMA) {
      for (const pref of setting.prefs) {
        prefs.addObserver(pref.name, observer);
      }
    }
    Services.obs.addObserver(() => {
      stopping = true;
      watcher?.kill();
    }, "quit-application");

    // The first watch line is the baseline; until then (seeding, or a file
    // that did not parse) prefs are left as they are.
    Promise.resolve(seeding).then(() => {
      if (!current) {
        current = Object.fromEntries(SCHEMA.map(s => [s.key, fromPrefs(s) ?? s.default]));
      }
      watch();
    });
  },
};
