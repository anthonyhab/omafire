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

    /* Zen Mode keybind: Ctrl+Alt+Z flips the runtime pref
     * "omarchy.zen-mode-active". It only takes effect while the
     * "zen-mode" feature pref is on, so the stylesheet can require both
     * and a disabled feature can never leave chrome hidden. Kept out of
     * features.json on purpose — this is runtime state, not config, so
     * the file bridge can never overwrite it mid-toggle. */
    var ZEN_ACTIVE_PREF = "omarchy.zen-mode-active";
    var ZEN_FEATURE_PREF = "omarchy.zen-mode";

    function toggleZenMode() {
        if (!prefs.getBoolPref(ZEN_FEATURE_PREF, false)) {
            return;
        }
        prefs.setBoolPref(
            ZEN_ACTIVE_PREF,
            !prefs.getBoolPref(ZEN_ACTIVE_PREF, false),
        );
    }

    /* A capture-phase window listener, not a <key> element: dynamically
     * added keys don't reliably re-register with the keyset, and this
     * path is what most userChrome modules use anyway. */
    function registerZenKey(win) {
        try {
            if (win.__omarchyZenKey) {
                return;
            }
            win.__omarchyZenKey = function (event) {
                if (
                    event.ctrlKey
                    && event.altKey
                    && (event.key === "z" || event.key === "Z")
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleZenMode();
                }
            };
            win.addEventListener("keydown", win.__omarchyZenKey, true);
        } catch (error) {
            Cu.reportError("[omarchy-features] " + error);
        }
    }

    /* Private-window mark: the stylesheet can only gate real elements —
     * XUL boxes never paint generated content, and the translucency layer
     * pins every rail element's own background — so the rail's private
     * indicator needs an injected <image>. sidebar-main is a shadow-DOM
     * custom element whose extra children never get a slot, so the mark
     * goes inside #vertical-tabs; CSS anchors it to the rail's bottom edge
     * and shows it only in private mode. */
    function injectPrivateMark(win) {
        try {
            var tabs = win.document.getElementById("tabbrowser-tabs");
            var host = win.document.getElementById("vertical-tabs");
            if (
                !tabs ||
                !host ||
                tabs.getAttribute("orient") !== "vertical" ||
                win.document.getElementById("omarchy-private-mark")
            ) {
                return;
            }
            var mark = win.document.createXULElement("image");
            mark.id = "omarchy-private-mark";
            mark.setAttribute("tooltiptext", "Private window");
            host.appendChild(mark);
        } catch (error) {
            Cu.reportError("[omarchy-features] " + error);
        }
    }

    /* Privileged content surfaces — the sidebar's Places/megalist
     * documents and friends — are chrome-docshell children, so they get
     * the userChrome sheet set (including generated omafox-palette.css
     * pins) but cannot see lwtheme vars the live theme sets on the
     * browser window root. Firefox's sheet cache holds the palette file
     * for the whole session, so a theme switch only reached them after
     * restart. Copy the window root's computed values into each sidebar
     * document's :root as inline styles instead: inline beats the stale
     * sheet, and the tick refreshes them within ~1.5s of any palette
     * change. */
    var CONTENT_PALETTE_VARS = [
        "--omarchy-surface", "--omarchy-fg", "--omarchy-muted",
        "--omarchy-panel", "--omarchy-field", "--omarchy-border",
        "--omarchy-accent", "--omarchy-focus-accent", "--omarchy-selection",
        "--omarchy-control-hover", "--omarchy-control-active",
        "--omarchy-control-selected", "--omarchy-control-border",
        "--omarchy-color-scheme", "--omarchy-ui-font",
        "--omarchy-ui-font-size", "--omarchy-ui-label-size",
        "--omarchy-radius-container", "--omarchy-radius-input",
        "--omarchy-transparency", "--omarchy-border-active-color",
        "--omarchy-border-inactive-color", "--omarchy-ring-focus",
        "--omarchy-ring-hover", "--omarchy-ring-inactive",
        "--omarchy-base-button-radius", "--omarchy-base-entry-radius",
    ];

    var LWT_MIRROR_ATTRS = ["lwtheme", "lwthemetextcolor", "lwtheme-brighttext"];

    function pushContentVars() {
        var mediator = Cc["@mozilla.org/appshell/window-mediator;1"]
            .getService(Ci.nsIWindowMediator);
        var windows = mediator.getEnumerator("navigator:browser");
        while (windows.hasMoreElements()) {
            var win = windows.getNext();
            try {
                /* SidebarController._loadUrl can swap the browser element
                 * at runtime (remoteType changes), dropping the load hook
                 * — re-arm here; the flag makes it a no-op when hooked. */
                hookSidebarContent(win);
                /* The tab strip can switch orientations after startup;
                 * this is idempotent, so a later switch to the vertical
                 * rail still gets its private mark. */
                injectPrivateMark(win);
                var browser = win.document.getElementById("sidebar");
                if (!browser || !browser.contentDocument) {
                    continue;
                }
                var doc = browser.contentDocument;
                var docRoot = doc.documentElement;
                if (
                    !docRoot ||
                    !docRoot.style ||
                    !doc.nodePrincipal ||
                    !doc.nodePrincipal.isSystemPrincipal
                ) {
                    continue;
                }
                var winRoot = win.document.documentElement;
                var cs = win.getComputedStyle(winRoot);
                var values = {};
                var signature = "";
                for (var i = 0; i < CONTENT_PALETTE_VARS.length; i++) {
                    var name = CONTENT_PALETTE_VARS[i];
                    var value = cs.getPropertyValue(name).trim();
                    if (value !== "") {
                        values[name] = value;
                        signature += name + "=" + value + ";";
                    } else if (
                        name !== "--omarchy-color-scheme" &&
                        docRoot.style.getPropertyValue(name) !== ""
                    ) {
                        /* Var went empty on the window — release the
                         * pushed value so the doc falls back to its own
                         * sheets the same way the window does.
                         * --omarchy-color-scheme is synthesized below, so
                         * it is exempt here. */
                        docRoot.style.removeProperty(name);
                    }
                }
                /* Numeric feature vars are pushed onto the window root by
                 * pushWindowVars; merge them so future feature vars reach
                 * the sidebar without growing this list. */
                for (var extra in lastVars) {
                    if (
                        extra.indexOf("--omarchy-") === 0 &&
                        !(extra in values)
                    ) {
                        var extraValue = cs.getPropertyValue(extra).trim();
                        if (extraValue !== "") {
                            values[extra] = extraValue;
                            signature += extra + "=" + extraValue + ";";
                        }
                    }
                }
                /* --omarchy-color-scheme lives only in the content
                 * palette, so the window root cannot supply it; derive it
                 * from the same lwtheme markers tokens.css keys on. */
                if (winRoot.hasAttribute("lwtheme")) {
                    var scheme = winRoot.hasAttribute("lwtheme-brighttext")
                        ? "dark"
                        : "light";
                    values["--omarchy-color-scheme"] = scheme;
                    signature += "--omarchy-color-scheme=" + scheme + ";";
                } else if (
                    docRoot.style.getPropertyValue("--omarchy-color-scheme") !== ""
                ) {
                    docRoot.style.removeProperty("--omarchy-color-scheme");
                }
                /* The generated palette pins --omarchy-* under
                 * :root:not([lwtheme]) with !important, and user-level
                 * !important beats author-level inline. Mirroring the
                 * window's lwtheme markers disengages those pins here
                 * exactly like on the chrome root so the pushed values
                 * actually win. */
                for (var a = 0; a < LWT_MIRROR_ATTRS.length; a++) {
                    var attr = LWT_MIRROR_ATTRS[a];
                    var desired = winRoot.getAttribute(attr);
                    signature += "|" + attr + "=" + String(desired);
                    if (desired !== null) {
                        if (docRoot.getAttribute(attr) !== desired) {
                            docRoot.setAttribute(attr, desired);
                        }
                    } else if (docRoot.hasAttribute(attr)) {
                        docRoot.removeAttribute(attr);
                    }
                }
                if (doc.__omarchyPaletteSignature === signature) {
                    continue;
                }
                for (var applied in values) {
                    docRoot.style.setProperty(
                        applied,
                        values[applied],
                        "important",
                    );
                }
                doc.__omarchyPaletteSignature = signature;
            } catch (error) {
                Cu.reportError("[omarchy-features] " + error);
            }
        }
    }

    function hookSidebarContent(win) {
        try {
            var browser = win.document.getElementById("sidebar");
            if (!browser || browser.__omarchyContentHooked) {
                return;
            }
            browser.__omarchyContentHooked = true;
            browser.addEventListener(
                "load",
                function () {
                    try {
                        pushContentVars();
                    } catch (error) {
                        Cu.reportError("[omarchy-features] " + error);
                    }
                },
                true,
            );
        } catch (error) {
            Cu.reportError("[omarchy-features] " + error);
        }
    }

    if (typeof window !== "undefined" && window.document) {
        registerZenKey(window);
        hookSidebarContent(window);
        injectPrivateMark(window);
    }

    // Windows opened after the last file change inherit nothing from the
    // inline-style push, so re-apply the latest vars as each browser window
    // finishes starting up.
    observers.addObserver(
        {
            observe: function (subject) {
                try {
                    if (subject && subject.document) {
                        registerZenKey(subject);
                        hookSidebarContent(subject);
                        injectPrivateMark(subject);
                    }
                } catch (error) {
                    Cu.reportError("[omarchy-features] " + error);
                }
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
            pushContentVars();
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
