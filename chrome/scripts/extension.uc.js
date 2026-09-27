// Omafire extension: install the Omafire WebExtension the package ships.
//
// The package carries the Mozilla-signed XPI beside this script. It is
// installed when missing and updated when the package brings a newer
// version. A user who removes it keeps it removed: each bundled version is
// offered once (omafire.extension.offered), and a disabled one is left
// disabled. Loaded into each browser window by omafire.cfg; the first
// window of a session does the work.
(function () {
  "use strict";
  if (window.OmafireExtension) {
    return;
  }
  window.OmafireExtension = {};

  const ID = "omarchy-ff-sync@bb.hab.rip";
  const OFFERED = "omafire.extension.offered";
  const SESSION = "omafire.internal.extension-checked";
  const defaults = Services.prefs.getDefaultBranch("");
  if (defaults.getBoolPref(SESSION, false)) {
    return;
  }
  defaults.setBoolPref(SESSION, true);

  const {AddonManager} = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs");

  // The XPI sits in the loader's directory, wherever resource://omafire/
  // points (the package's, or a working tree under fxlab --scripts).
  function bundledXpi() {
    try {
      const res = Services.io.getProtocolHandler("resource")
        .QueryInterface(Ci.nsIResProtocolHandler);
      const url = res.resolveURI(Services.io.newURI("resource://omafire/omafire.xpi"));
      const f = Services.io.newURI(url).QueryInterface(Ci.nsIFileURL).file;
      return f.exists() ? f : null;
    } catch {
      return null;
    }
  }

  function xpiVersion(file) {
    const zip = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
    zip.open(file);
    try {
      const stream = zip.getInputStream("manifest.json");
      const json = JSON.parse(NetUtil.readInputStreamToString(
        stream, stream.available(), {charset: "UTF-8"}));
      return json.version;
    } finally {
      zip.close();
    }
  }

  async function ensure() {
    const xpi = bundledXpi();
    if (!xpi) {
      return;
    }
    const bundled = xpiVersion(xpi);
    const installed = await AddonManager.getAddonByID(ID);
    const offered = Services.prefs.getStringPref(OFFERED, "");

    if (installed) {
      if (Services.vc.compare(installed.version, bundled) >= 0) {
        Services.prefs.setStringPref(OFFERED, bundled);
        return;
      }
    } else if (offered === bundled) {
      return;             // installed once and removed since: respected
    }

    const install = await AddonManager.getInstallForFile(xpi);
    if (!install || install.error) {
      throw new Error(`cannot read ${xpi.path}: ${install?.error}`);
    }
    const addon = await install.install();
    Services.prefs.setStringPref(OFFERED, bundled);
    console.info(`[omafire:extension] ${installed ? "updated to" : "installed"} ${addon.id} ${addon.version}`);
  }

  ensure().catch(e => console.error("[omafire:extension]", e));
})();
