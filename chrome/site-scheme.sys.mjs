// Cinder's Light sites: a site the user sets to Light in Cinder's panel
// never sees the dark scheme. Firefox has no per-site prefers-color-scheme
// and an extension can't set one, but a tab's top browsing context can
// override it for its whole tree, frames included (the field devtools'
// emulation uses). omafire.cfg starts this at final-ui-startup.
//
// The override is set when a top-level document request opens, in the
// parent, before any of the response reaches the content process, so the
// first paint has it. A cross-site load can replace the tab's top browsing
// context (a process switch) with one that has the same browserId and none
// of the old one's override, so the wish is kept per browserId and set again
// when the new one attaches. Each location change sets it too, since a page
// restored from the back-forward cache sends no request. Only an override
// set here is cleared here (devtools' own stays).
//
// The Light sites are Cinder's "modes" (host -> mode) in its storage.local,
// read when Cinder starts and again whenever it writes them.
//
// Off and Light sites also get forcedColorsOverride = "inactive" where
// Firefox knows that value (a patched build, k9b.48): forced colours off for
// the tab, as the Every site switch turns them off for all (DEC-110). Stock
// Firefox ignores the value, which reads back as before, so there Cinder's
// in-page undo is all there is.

const CINDER = "cinder-dark-mode@hab.rip";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionStorageIDB: "resource://gre/modules/ExtensionStorageIDB.sys.mjs",
  Management: "resource://gre/modules/Extension.sys.mjs",
});

let light = new Set();
let unforced = new Set();     // Off and Light hosts
let inactive = null;          // does this Firefox take "inactive"? (null: not tried)
let state = {modes: {}, enabled: true};
let reading = 0;
const wants = new Set();      // browserIds whose latest top-level load is a Light site
const unforce = new Set();    // browserIds whose latest top-level load is an Off or Light site
const ours = new WeakSet();   // browsing contexts whose scheme override is ours
const oursForced = new WeakSet();   // and whose forced-colours override is

function follow(next) {
  state = {...state, ...next};
  // (Cinder switched off everywhere hands the colours back to Firefox)
  const modes = state.enabled === false ? {} : state.modes || {};
  light = new Set(Object.keys(modes).filter((host) => modes[host] === "light"));
  unforced = new Set(Object.keys(modes).filter((host) => modes[host] === "light" || modes[host] === "off"));
}

async function read() {
  const n = ++reading;
  const extension = WebExtensionPolicy.getByID(CINDER)?.extension;
  if (!extension) {
    return;
  }
  const db = await lazy.ExtensionStorageIDB.open(lazy.ExtensionStorageIDB.getStoragePrincipal(extension));
  const {modes = {}, enabled = true} = await db.get(["modes", "enabled"]);
  if (n === reading) {
    follow({modes, enabled});
  }
}

function want(bc, uri) {
  if (!bc || bc.parent) {
    return;
  }
  let host = "";
  try {
    host = /^https?$/.test(uri.scheme) ? uri.host : "";
  } catch {}
  if (light.has(host)) {
    wants.add(bc.browserId);
  } else {
    wants.delete(bc.browserId);
  }
  if (unforced.has(host)) {
    unforce.add(bc.browserId);
  } else {
    unforce.delete(bc.browserId);
  }
  apply(bc);
}

function apply(bc) {
  if (bc.isDiscarded) {
    return;
  }
  if (wants.has(bc.browserId)) {
    if (bc.prefersColorSchemeOverride !== "light") {
      bc.prefersColorSchemeOverride = "light";
    }
    ours.add(bc);
  } else if (ours.has(bc)) {
    ours.delete(bc);
    bc.prefersColorSchemeOverride = "none";
  }
  if (unforce.has(bc.browserId) && inactive !== false) {
    if (bc.forcedColorsOverride !== "inactive") {
      bc.forcedColorsOverride = "inactive";
      // (an enum value Firefox doesn't know is dropped without an error)
      inactive = bc.forcedColorsOverride === "inactive";
    }
    if (inactive) {
      oursForced.add(bc);
    }
  } else if (oursForced.has(bc)) {
    oursForced.delete(bc);
    bc.forcedColorsOverride = "none";
  }
}

const requests = {
  observe(channel) {
    const {loadInfo, URI} = channel.QueryInterface(Ci.nsIChannel);
    if (loadInfo.externalContentPolicyType === Ci.nsIContentPolicy.TYPE_DOCUMENT) {
      want(loadInfo.browsingContext, URI);
    }
  },
};

const attached = {
  observe(bc) {
    if (!bc.parent && (wants.has(bc.browserId) || unforce.has(bc.browserId))) {
      apply(bc);
    }
  },
};

const tabs = {
  onLocationChange(browser, webProgress, request, location) {
    if (webProgress.isTopLevel) {
      want(browser.browsingContext, location);
    }
  },
  // a load that never became the page (a download, a 204, stopped) leaves
  // the page that is still there as it was
  onStateChange(browser, webProgress, request, flags) {
    const stop = Ci.nsIWebProgressListener.STATE_STOP | Ci.nsIWebProgressListener.STATE_IS_NETWORK;
    if (webProgress.isTopLevel && (flags & stop) === stop) {
      want(browser.browsingContext, browser.currentURI);
    }
  },
};

function watchWindow(win) {
  win.gBrowser?.addTabsProgressListener(tabs);
}

export const OmafireSiteScheme = {
  started: false,

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    const refresh = () => read().catch((error) => console.error("[omafire:site-scheme]", error));
    // A change is followed as it is told, not read back: Cinder reloads the
    // tab right after the write, and that reload's request reaches the
    // parent after this notice (one IPC channel) but before a read would.
    lazy.ExtensionStorageIDB.addOnChangedListener(CINDER, (changes) => {
      const next = {};
      for (const key of ["modes", "enabled"]) {
        if (key in changes) {
          const value = changes[key].newValue;
          next[key] = value?.deserialize ? value.deserialize(globalThis) : value;
        }
      }
      if (Object.keys(next).length) {
        reading++;      // (a read still running is older than this)
        follow(next);
      }
    });
    lazy.Management.on("ready", (event, extension) => {
      if (extension.id === CINDER) {
        refresh();
      }
    });
    lazy.Management.on("shutdown", (event, extension) => {
      if (extension.id === CINDER) {
        reading++;
        follow({modes: {}});
      }
    });
    refresh();
    Services.obs.addObserver(requests, "http-on-opening-request");
    Services.obs.addObserver(attached, "browsing-context-attached");
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      watchWindow(win);
    }
    Services.obs.addObserver((win) => watchWindow(win), "browser-delayed-startup-finished");
  },
};
