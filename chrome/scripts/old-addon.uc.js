// Omafire's old add-on: removed once the chrome scripts do its work.
//
// Releases before 0.7 installed a WebExtension (omarchy-ff-sync@bb.hab.rip)
// for the live theme, the new tab and site-coloured tabs. The chrome
// scripts do all of that now, and while it stays it still claims the new
// tab, so it is uninstalled, along with the pref that tracked it. Loaded
// into each browser window by omafire.cfg; the first window of a session
// does the work.
(function () {
  "use strict";
  if (window.OmafireOldAddon) {
    return;
  }
  window.OmafireOldAddon = {};

  const ID = "omarchy-ff-sync@bb.hab.rip";
  const OFFERED = "omafire.extension.offered";
  const SESSION = "omafire.internal.old-addon-checked";
  const defaults = Services.prefs.getDefaultBranch("");
  if (defaults.getBoolPref(SESSION, false)) {
    return;
  }
  defaults.setBoolPref(SESSION, true);

  const {AddonManager} = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs");

  async function retire() {
    // The new tab copies the add-on's settings first, while it can read
    // them; if it couldn't (the add-on not running yet), next session.
    if (await window.OmafireNewTab?.migrated === false) {
      return;
    }
    const addon = await AddonManager.getAddonByID(ID);
    if (addon) {
      await addon.uninstall();
      console.info(`[omafire:old-addon] removed ${ID} ${addon.version}`);
    }
    Services.prefs.clearUserPref(OFFERED);
  }

  retire().catch(e => console.error("[omafire:old-addon]", e));
})();
