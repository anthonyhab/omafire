// Omarchy Firefox: bridge from omafox-native-host feature toggles to prefs.
// Watches ~/.local/state/omafox/features.json; on change applies each
// key as a boolean "omarchy.<key>" pref so @media -moz-pref() gates in
// userChrome.css re-evaluate live, then flushes chrome skin caches.
(function () {
    var Cc = Components.classes;
    var Ci = Components.interfaces;
    var Cu = Components.utils;

    var defaults = Cc["@mozilla.org/preferences-service;1"]
        .getService(Ci.nsIPrefService)
        .getDefaultBranch("");
    if (defaults.getBoolPref("omarchy._features-bridge-active", false)) {
        return;
    }
    defaults.setBoolPref("omarchy._features-bridge-active", true);

    var stateFile = Cc["@mozilla.org/file/directory_service;1"]
        .getService(Ci.nsIProperties)
        .get("Home", Ci.nsIFile);
    stateFile.append(".local");
    stateFile.append("state");
    stateFile.append("omafox");
    stateFile.append("features.json");

    var prefs = Cc["@mozilla.org/preferences-service;1"].getService(
        Ci.nsIPrefBranch,
    );
    var observers = Cc["@mozilla.org/observer-service;1"].getService(
        Ci.nsIObserverService,
    );
    var lastModified = 0;

    function readFeatures() {
        var input = Cc["@mozilla.org/network/file-input-stream;1"]
            .createInstance(Ci.nsIFileInputStream);
        input.init(stateFile, -1, 0, 0);
        var converter = Cc["@mozilla.org/intl/converter-input-stream;1"]
            .createInstance(Ci.nsIConverterInputStream);
        converter.init(input, "UTF-8", 4096, 0);
        var buffer = {};
        var text = "";
        while (converter.readString(4096, buffer) > 0) {
            text += buffer.value;
        }
        converter.close();
        return JSON.parse(text);
    }

    function check() {
        try {
            if (!stateFile.exists()) {
                return;
            }
            var modified = stateFile.lastModifiedTime;
            if (modified === lastModified) {
                return;
            }
            lastModified = modified;

            var features = readFeatures();
            if (features === null || typeof features !== "object") {
                return;
            }
            var changed = false;
            for (var key in features) {
                if (!/^[a-z0-9-]{1,48}$/.test(key)) {
                    continue;
                }
                var value = features[key] === true;
                var pref = "omarchy." + key;
                if (prefs.getBoolPref(pref, null) !== value) {
                    prefs.setBoolPref(pref, value);
                    changed = true;
                }
            }
            if (changed) {
                observers.notifyObservers(null, "chrome-flush-skin-caches");
            }
        } catch (error) {
            Cu.reportError("[omarchy-features] " + error);
        }
    }

    // A pending timer is rooted by the timer thread; a repeating timer kept
    // only in this scope can be garbage-collected, so re-arm a one-shot from
    // inside its own callback instead.
    var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    var tick = function () {
        try {
            check();
        } finally {
            timer.initWithCallback(tick, 1500, Ci.nsITimer.TYPE_ONE_SHOT);
        }
    };
    tick();
})();
