// Omafire new tab: chrome://omafire/content/newtab.html (chrome/newtab/)
// is the new tab page while omafire.newtab is on.
//
// The page's files sit beside this script, registered as chrome://omafire/
// by the chrome.manifest there. Settings made on the old add-on's new tab
// (its storage, and a picked image) are copied once into the page's pref
// and the profile before old-addon.uc.js removes it.
// Loaded into each browser window by omafire.cfg: the first window of a
// session registers and copies; every window keeps the page in place.
(function () {
  "use strict";
  if (window.OmafireNewTab) {
    return;
  }
  window.OmafireNewTab = {};

  const SESSION = "omafire.internal.newtab-registered";
  const defaults = Services.prefs.getDefaultBranch("");

  const PREF = "omafire.newtab";
  const SETTINGS = "omafire.newtab.settings";
  const URL = "chrome://omafire/content/newtab.html";
  const OLD_ADDON = "omarchy-ff-sync@bb.hab.rip";
  const log = e => console.error("[omafire:newtab]", e);

  const {AboutNewTab} = ChromeUtils.importESModule("resource:///modules/AboutNewTab.sys.mjs");

  // The manifest sits wherever resource://omafire/ points (the package's
  // directory, or a working tree under fxlab --scripts).
  function register() {
    const res = Services.io.getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler);
    const spec = res.resolveURI(Services.io.newURI("resource://omafire/chrome.manifest"));
    const file = Services.io.newURI(spec).QueryInterface(Ci.nsIFileURL).file;
    if (!file.exists()) {
      return false;
    }
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(file);
    return true;
  }

  function follow() {
    if (Services.prefs.getBoolPref(PREF, true)) {
      if (AboutNewTab.newTabURL !== URL) {
        AboutNewTab.newTabURL = URL;
      }
    } else if (AboutNewTab.newTabURL === URL) {
      AboutNewTab.resetNewTabURL();
    }
  }

  // The old add-on kept the page's settings in its storage.local
  // ("newtab") and a picked image in its IndexedDB ("omafox", "files",
  // "custom-wallpaper"); both are readable only while it runs. Resolves
  // false while it is enabled but not yet running: its removal waits.
  async function migrate() {
    if (Services.prefs.prefHasUserValue(SETTINGS)) {
      return true;
    }
    const policy = WebExtensionPolicy.getByID(OLD_ADDON);
    if (!policy?.extension) {
      const {AddonManager} = ChromeUtils.importESModule(
        "resource://gre/modules/AddonManager.sys.mjs");
      return !(await AddonManager.getAddonByID(OLD_ADDON))?.isActive;
    }
    const {ExtensionStorageIDB} = ChromeUtils.importESModule(
      "resource://gre/modules/ExtensionStorageIDB.sys.mjs");
    const db = await ExtensionStorageIDB.open(
      ExtensionStorageIDB.getStoragePrincipal(policy.extension));
    const {newtab} = await db.get(["newtab"]);
    if (newtab?.background === "custom") {
      const blob = await new Promise((resolve, reject) => {
        const open = indexedDB.openForPrincipal(policy.extension.principal, "omafox", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("files");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const files = open.result;
          const get = files.transaction("files").objectStore("files").get("custom-wallpaper");
          get.onsuccess = () => {
            files.close();
            resolve(get.result?.blob ?? null);
          };
          get.onerror = () => {
            files.close();
            reject(get.error);
          };
        };
      });
      if (blob) {
        const path = PathUtils.join(PathUtils.profileDir, "omafire-newtab-image");
        await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()), {tmpPath: `${path}.tmp`});
      }
    }
    if (newtab && typeof newtab === "object") {
      Services.prefs.setStringPref(SETTINGS, JSON.stringify(newtab));
    }
    return true;
  }

  if (!defaults.getBoolPref(SESSION, false)) {
    try {
      if (!register()) {
        return;
      }
    } catch (e) {
      log(e);
      return;
    }
    defaults.setBoolPref(SESSION, true);
    window.OmafireNewTab.migrated = migrate().catch(e => {
      log(e);
      return false;
    });
  }
  follow();
  // The old add-on sets its own page as it starts, which may be after
  // this window; and the setting can change any time.
  Services.obs.addObserver(follow, "newtab-url-changed");
  Services.prefs.addObserver(PREF, follow);
  window.addEventListener("unload", () => {
    Services.obs.removeObserver(follow, "newtab-url-changed");
    Services.prefs.removeObserver(PREF, follow);
  }, {once: true});
})();
