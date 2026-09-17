// Omarchy Firefox: bridge from omafox-native-host feature toggles to prefs.
// Watches ~/.local/state/omafox/features.json; on change applies each
// boolean key as an "omarchy.<key>" pref so @media -moz-pref() gates in
// userChrome.css re-evaluate live, then flushes chrome skin caches.
// Numeric keys instead become a string pref plus a live --omarchy-<key>
// CSS custom property pushed onto every navigator:browser window root.
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
    var appliedVars = [];
    var lastVars = {};

    function pushWindowVars(vars) {
        var mediator = Cc["@mozilla.org/appshell/window-mediator;1"]
            .getService(Ci.nsIWindowMediator);
        var windows = mediator.getEnumerator("navigator:browser");
        while (windows.hasMoreElements()) {
            var root = windows.getNext().document.documentElement;
            if (!root || !root.style) {
                continue;
            }
            for (var i = 0; i < appliedVars.length; i++) {
                if (!(appliedVars[i] in vars)) {
                    root.style.removeProperty(appliedVars[i]);
                }
            }
            for (var name in vars) {
                var value = String(vars[name]);
                if (root.style.getPropertyValue(name) !== value) {
                    root.style.setProperty(name, value);
                }
            }
        }
        appliedVars = [];
        lastVars = vars;
        for (var applied in vars) {
            appliedVars.push(applied);
        }
    }

    // Windows opened after the last file change inherit nothing from the
    // inline-style push, so re-apply the latest vars as each browser window
    // finishes starting up.
    observers.addObserver(
        {
            observe: function () {
                try {
                    var keys = [];
                    for (var name in lastVars) {
                        keys.push(name);
                    }
                    if (keys.length > 0) {
                        pushWindowVars(lastVars);
                    }
                } catch (error) {
                    Cu.reportError("[omarchy-features] " + error);
                }
            },
        },
        "browser-delayed-startup-finished",
        false,
    );

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
        /* Re-push every tick: the startup-observer race can miss the first
         * window, and restored or unusual windows get the vars within one
         * interval instead of waiting for the next file write. The push is
         * idempotent — it compares before setting. */
        try {
            pushWindowVars(lastVars);
        } catch (error) {
            Cu.reportError("[omarchy-features] " + error);
        }
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
            if (features !== null && typeof features === "object") {
                var changed = false;
                var vars = {};
                for (var key in features) {
                    if (!/^[a-z0-9-]{1,48}$/.test(key)) {
                        continue;
                    }
                    var pref = "omarchy." + key;
                    if (typeof features[key] === "number"
                            && isFinite(features[key])) {
                        vars["--omarchy-" + key] = features[key];
                        var text = String(features[key]);
                        if (prefs.getCharPref(pref, "") !== text) {
                            prefs.setCharPref(pref, text);
                            changed = true;
                        }
                        continue;
                    }
                    var value = features[key] === true;
                    if (prefs.getBoolPref(pref, null) !== value) {
                        prefs.setBoolPref(pref, value);
                        changed = true;
                    }
                }
                /* Translucent pages needs the platform flag that lets
                 * <browser> composite without an opaque backing; tied to
                 * the feature pair so the default returns when either half
                 * is off. The pref also tracks the file exactly — a stale
                 * omarchy.content-glass=true must not keep stripping page
                 * backgrounds after the key disappears from the file. */
                if (!("content-glass" in features)
                        && prefs.getBoolPref(
                               "omarchy.content-glass", false)) {
                    prefs.setBoolPref("omarchy.content-glass", false);
                    changed = true;
                }
                if (features["content-glass"] === true
                        && features["translucency"] === true) {
                    if (!prefs.getBoolPref(
                            "browser.tabs.allow_transparent_browser", false)) {
                        prefs.setBoolPref(
                            "browser.tabs.allow_transparent_browser", true);
                        changed = true;
                    }
                } else if (prefs.prefHasUserValue(
                               "browser.tabs.allow_transparent_browser")) {
                    prefs.clearUserPref(
                        "browser.tabs.allow_transparent_browser");
                    changed = true;
                }
                pushWindowVars(vars);
                if (changed) {
                    observers.notifyObservers(null, "chrome-flush-skin-caches");
                }
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
