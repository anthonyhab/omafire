// Omarchy Firefox: bridge from omafox-native-host feature toggles to prefs.
// Watches ~/.local/state/omafox/features.json; on change applies each
// key as a boolean "omarchy.<key>" pref so @media -moz-pref() gates in
// userChrome.css re-evaluate live, then flushes chrome skin caches.
//
// The "site-colors" toggle additionally forces web content to use the
// Omarchy palette (browser.display.* + prefers-color-scheme override),
// re-applied whenever ~/.local/state/omafox/theme.json changes.
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

    function stateFile(name) {
        var file = Cc["@mozilla.org/file/directory_service;1"]
            .getService(Ci.nsIProperties)
            .get("Home", Ci.nsIFile);
        file.append(".local");
        file.append("state");
        file.append("omafox");
        file.append(name);
        return file;
    }

    var featuresFile = stateFile("features.json");
    var themeFile = stateFile("theme.json");

    var prefs = Cc["@mozilla.org/preferences-service;1"].getService(
        Ci.nsIPrefBranch,
    );
    var observers = Cc["@mozilla.org/observer-service;1"].getService(
        Ci.nsIObserverService,
    );
    var lastFeaturesModified = 0;
    var lastThemeModified = 0;
    var contentColorsApplied = false;

    var HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

    // browser.display.* char prefs mapped to palette keys.
    var CONTENT_COLOR_PREFS = {
        "browser.display.background_color": "background",
        "browser.display.foreground_color": "foreground",
        "browser.display.anchor_color": "accent",
        "browser.display.visited_color": "magenta",
    };
    // Non-color flags fixed while site-colors is on.
    var CONTENT_BOOL_PREFS = {
        "browser.display.use_system_colors": false,
        "layout.css.forced-colors.enabled": false,
    };
    var CONTENT_INT_PREFS = {
        "browser.display.document_color_use": 2,
    };

    function readJson(file) {
        var input = Cc["@mozilla.org/network/file-input-stream;1"]
            .createInstance(Ci.nsIFileInputStream);
        input.init(file, -1, 0, 0);
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

    function restoreContentColors() {
        for (var name in CONTENT_COLOR_PREFS) {
            prefs.clearUserPref(name);
        }
        for (var flag in CONTENT_BOOL_PREFS) {
            prefs.clearUserPref(flag);
        }
        for (var intPref in CONTENT_INT_PREFS) {
            prefs.clearUserPref(intPref);
        }
        prefs.clearUserPref("layout.css.prefers-color-scheme.content-override");
        contentColorsApplied = false;
    }

    function applyContentColors(palette) {
        var changed = !contentColorsApplied;
        for (var name in CONTENT_COLOR_PREFS) {
            var value = palette[CONTENT_COLOR_PREFS[name]];
            if (!HEX_COLOR.test(value || "")) {
                continue;
            }
            if (prefs.getCharPref(name, null) !== value) {
                prefs.setCharPref(name, value);
                changed = true;
            }
        }
        for (var flag in CONTENT_BOOL_PREFS) {
            var wanted = CONTENT_BOOL_PREFS[flag];
            if (prefs.getBoolPref(flag, null) !== wanted) {
                prefs.setBoolPref(flag, wanted);
                changed = true;
            }
        }
        for (var intName in CONTENT_INT_PREFS) {
            var intWanted = CONTENT_INT_PREFS[intName];
            if (prefs.getIntPref(intName, -9999) !== intWanted) {
                prefs.setIntPref(intName, intWanted);
                changed = true;
            }
        }
        var override = palette.mode === "dark" ? 0 : 1;
        if (
            prefs.getIntPref(
                "layout.css.prefers-color-scheme.content-override",
                -1,
            ) !== override
        ) {
            prefs.setIntPref(
                "layout.css.prefers-color-scheme.content-override",
                override,
            );
            changed = true;
        }
        contentColorsApplied = true;
        return changed;
    }

    function check() {
        try {
            var featuresChanged = false;
            var themeChanged = false;
            if (featuresFile.exists()
                && featuresFile.lastModifiedTime !== lastFeaturesModified) {
                lastFeaturesModified = featuresFile.lastModifiedTime;
                featuresChanged = true;
            }
            if (themeFile.exists()
                && themeFile.lastModifiedTime !== lastThemeModified) {
                lastThemeModified = themeFile.lastModifiedTime;
                themeChanged = true;
            }
            if (!featuresChanged && !themeChanged) {
                return;
            }

            var skinChanged = false;
            if (featuresChanged) {
                var features = readJson(featuresFile);
                if (features !== null && typeof features === "object") {
                    for (var key in features) {
                        if (!/^[a-z0-9-]{1,48}$/.test(key)) {
                            continue;
                        }
                        var value = features[key] === true;
                        var pref = "omarchy." + key;
                        if (prefs.getBoolPref(pref, null) !== value) {
                            prefs.setBoolPref(pref, value);
                            skinChanged = true;
                        }
                    }
                }
            }

            if (
                prefs.getBoolPref("omarchy.site-colors", false)
                && themeFile.exists()
            ) {
                var message = readJson(themeFile);
                if (
                    message !== null
                    && typeof message === "object"
                    && message.palette !== null
                    && typeof message.palette === "object"
                    && applyContentColors(message.palette)
                ) {
                    skinChanged = true;
                }
            } else if (contentColorsApplied) {
                restoreContentColors();
                skinChanged = true;
            }

            if (skinChanged) {
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
