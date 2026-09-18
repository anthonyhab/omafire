/* Omarchy Workspaces — Arc/Zen-style tab spaces on the stock vertical rail.
 * Loaded per window by configuration/mozilla.cfg; gated live on the
 * "omarchy.workspaces" pref so the extension toggle turns it on and off
 * without a restart.
 *
 * Model: the workspace list lives in a SessionStore *window* value (spaces
 * are window-scoped, like Zen), and each tab's membership rides in a
 * SessionStore *tab* value, so both survive restarts. Switching is
 * hideTab/showTab on unpinned tabs — pinned tabs stay visible in every
 * space, matching Zen's Essentials behaviour.
 */
(function () {
    if (window.__omarchyWorkspaces) {
        return;
    }
    window.__omarchyWorkspaces = true;

    var PREF = "omarchy.workspaces";
    var TAB_KEY = "omarchyWorkspace";
    var WIN_KEY = "omarchyWorkspaces";
    var DEFAULT_ID = "main";
    var SS = window.SessionStore;
    var prefs = Services.prefs;
    var built = null;
    var listening = false;

    function enabled() {
        return prefs.getBoolPref(PREF, false);
    }

    function readState() {
        var state = null;
        try {
            var raw = SS.getCustomWindowValue(window, WIN_KEY);
            if (raw) {
                state = JSON.parse(raw);
            }
        } catch (error) {
            state = null;
        }
        if (
            !state
            || !Array.isArray(state.order)
            || state.order.length === 0
            || typeof state.names !== "object"
            || !state.names
            || typeof state.active !== "string"
        ) {
            state = {
                order: [DEFAULT_ID],
                names: { main: "Main" },
                active: DEFAULT_ID,
            };
        }
        return state;
    }

    function writeState(state) {
        try {
            SS.setCustomWindowValue(window, WIN_KEY, JSON.stringify(state));
        } catch (error) {
            Cu.reportError("[omarchy-workspaces] " + error);
        }
    }

    function setTabWorkspace(tab, workspaceId) {
        try {
            SS.setCustomTabValue(tab, TAB_KEY, workspaceId);
        } catch (error) {
            Cu.reportError("[omarchy-workspaces] " + error);
        }
    }

    function workspaceOf(tab) {
        try {
            var id = SS.getCustomTabValue(tab, TAB_KEY);
            /* A stored id that no longer exists in this window's order is a
             * stranded id (deleted workspace, cross-window adopt, undo-close
             * residue) — treat the tab as belonging to the active space so
             * it can never be hidden with no pill to reach it. */
            if (id && readState().order.indexOf(id) !== -1) {
                return id;
            }
        } catch (error) {
            /* fall through */
        }
        return readState().active;
    }

    function claimTab(tab) {
        try {
            var stored = SS.getCustomTabValue(tab, TAB_KEY);
            var state = readState();
            if (!stored || state.order.indexOf(stored) === -1) {
                setTabWorkspace(tab, state.active);
            }
        } catch (error) {
            Cu.reportError("[omarchy-workspaces] " + error);
        }
    }

    function tabsIn(workspaceId) {
        var result = [];
        for (var i = 0; i < gBrowser.tabs.length; i++) {
            var tab = gBrowser.tabs[i];
            if (!tab.pinned && workspaceOf(tab) === workspaceId) {
                result.push(tab);
            }
        }
        return result;
    }

    function switchTo(workspaceId) {
        var state = readState();
        if (!state.order.includes(workspaceId)) {
            return;
        }
        state.active = workspaceId;
        writeState(state);

        /* Show first, activate, then hide — hiding the selected tab before a
         * replacement is active makes Firefox pick an arbitrary neighbour. */
        var mine = tabsIn(workspaceId);
        for (var i = 0; i < mine.length; i++) {
            gBrowser.showTab(mine[i]);
        }
        var selected = gBrowser.selectedTab;
        if (selected.pinned || workspaceOf(selected) !== workspaceId) {
            if (mine.length > 0) {
                gBrowser.selectedTab = mine[0];
            } else {
                gBrowser.addTab("about:newtab", {
                    triggeringPrincipal:
                        Services.scriptSecurityManager.getSystemPrincipal(),
                });
            }
        }
        for (var j = 0; j < gBrowser.tabs.length; j++) {
            var tab = gBrowser.tabs[j];
            if (!tab.pinned && workspaceOf(tab) !== workspaceId) {
                gBrowser.hideTab(tab);
            }
        }
        render();
    }

    function createWorkspace() {
        var state = readState();
        var id = "ws-" + Date.now().toString(36);
        state.order.push(id);
        state.names[id] = "Space " + (state.order.length);
        state.active = id;
        writeState(state);
        render();
        switchTo(id);
    }

    function renameWorkspace(workspaceId) {
        var state = readState();
        var box = { value: state.names[workspaceId] || workspaceId };
        var ok = Services.prompt.prompt(
            window,
            "Omarchy",
            "Workspace name",
            box,
            null,
            {},
        );
        if (ok && box.value.trim()) {
            state.names[workspaceId] = box.value.trim();
            writeState(state);
            render();
        }
    }

    function deleteWorkspace(workspaceId) {
        var state = readState();
        if (state.order.length <= 1) {
            return;
        }
        if (!Services.prompt.confirm(
                window,
                "Omarchy",
                "Delete this workspace? Its tabs move to the active space.",
            )) {
            return;
        }
        /* Compute the destination FIRST: when the deleted space was active,
         * remapping its tabs to `state.active` would write the dead id back
         * into them and strand them under a pill that no longer exists. */
        var target = state.active;
        if (state.active === workspaceId) {
            target = state.order.filter(function (id) {
                return id !== workspaceId;
            })[0];
        }
        for (var i = 0; i < gBrowser.tabs.length; i++) {
            var tab = gBrowser.tabs[i];
            if (workspaceOf(tab) === workspaceId) {
                setTabWorkspace(tab, target);
            }
        }
        state.order = state.order.filter(function (id) {
            return id !== workspaceId;
        });
        delete state.names[workspaceId];
        state.active = target;
        writeState(state);
        switchTo(target);
    }

    function moveSelectedTo(workspaceId) {
        var tab = gBrowser.selectedTab;
        if (tab.pinned) {
            return;
        }
        setTabWorkspace(tab, workspaceId);
        switchTo(workspaceId);
    }

    function render() {
        if (!built) {
            return;
        }
        var state = readState();
        var list = built.list;
        list.textContent = "";
        for (var i = 0; i < state.order.length; i++) {
            (function (id) {
                var button = document.createXULElement("toolbarbutton");
                button.className = "omarchy-workspace";
                if (id === state.active) {
                    button.setAttribute("active", "true");
                }
                button.setAttribute(
                    "label",
                    state.names[id] || "Space",
                );
                button.setAttribute(
                    "tooltiptext",
                    "Click: switch — Shift+click: move this tab — "
                        + "Double-click: rename — Right-click: delete",
                );
                /* `command` covers mouse AND keyboard activation (Enter/
                 * Space). The second click of a double-click also fires
                 * command, but switching to the already-active space is a
                 * no-op, so no detail guard is needed. */
                button.addEventListener("command", function (event) {
                    if (event.shiftKey) {
                        moveSelectedTo(id);
                    } else {
                        switchTo(id);
                    }
                });
                button.addEventListener("dblclick", function () {
                    renameWorkspace(id);
                });
                button.addEventListener("contextmenu", function (event) {
                    event.preventDefault();
                    deleteWorkspace(id);
                });
                list.appendChild(button);
            })(state.order[i]);
        }
    }

    function onTabOpen(event) {
        var tab = event.target;
        if (!tab || tab.tagName !== "tab") {
            return;
        }
        claimTab(tab);
        /* A restored/adopted tab that belongs to a *valid but non-active*
         * space must hide immediately — otherwise it sits visible in the
         * wrong space until the next switch. */
        var state = readState();
        if (!tab.pinned && workspaceOf(tab) !== state.active) {
            gBrowser.hideTab(tab);
        }
    }

    /* When the selected tab closes and no *visible* tab remains, Firefox's
     * removeTab calls window.close() before TabClose even dispatches —
     * hidden tabs in other spaces don't count as selectable. Intercept
     * removeTab and seed the active space first so the window survives. */
    var originalRemoveTab = null;

    function wrappedRemoveTab(aTab) {
        if (
            enabled()
            && aTab
            && !aTab.pinned
            && typeof gBrowser !== "undefined"
            && workspaceOf(aTab) === readState().active
        ) {
            var visible = 0;
            for (var i = 0; i < gBrowser.tabs.length; i++) {
                var t = gBrowser.tabs[i];
                if (t !== aTab && !t.pinned && !t.hidden) {
                    visible++;
                }
            }
            if (visible === 0) {
                gBrowser.addTab("about:newtab", {
                    triggeringPrincipal:
                        Services.scriptSecurityManager.getSystemPrincipal(),
                });
            }
        }
        return originalRemoveTab.apply(this, arguments);
    }

    function init() {
        if (built) {
            return;
        }
        /* #vertical-tabs is the rail's horizontal row — the strip's column
         * is #tabbrowser-tabs (promo card, pinned area, scrollbox stack).
         * The switcher must become its first child to land as a fixed top
         * row rather than a parallel column. */
        var tabsElement = document.getElementById("tabbrowser-tabs");
        if (!tabsElement || tabsElement.getAttribute("orient") !== "vertical") {
            return;
        }

        var bar = document.createXULElement("hbox");
        bar.id = "omarchy-workspaces";
        var list = document.createXULElement("hbox");
        list.id = "omarchy-workspaces-list";
        var add = document.createXULElement("toolbarbutton");
        add.id = "omarchy-workspaces-add";
        add.setAttribute("label", "+");
        add.setAttribute("tooltiptext", "New workspace");
        add.addEventListener("command", createWorkspace);
        bar.appendChild(list);
        bar.appendChild(add);
        tabsElement.insertBefore(bar, tabsElement.firstChild);
        built = { bar: bar, list: list };

        if (!listening) {
            tabsElement.addEventListener("TabOpen", onTabOpen);
            if (typeof gBrowser !== "undefined" && !originalRemoveTab) {
                originalRemoveTab = gBrowser.removeTab;
                gBrowser.removeTab = wrappedRemoveTab;
            }
            listening = true;
        }
        for (var i = 0; i < gBrowser.tabs.length; i++) {
            claimTab(gBrowser.tabs[i]);
        }
        switchTo(readState().active);
    }

    function teardown() {
        if (built) {
            built.bar.remove();
            built = null;
        }
        var tabsElement = document.getElementById("tabbrowser-tabs");
        if (tabsElement && listening) {
            tabsElement.removeEventListener("TabOpen", onTabOpen);
            if (typeof gBrowser !== "undefined" && originalRemoveTab) {
                gBrowser.removeTab = originalRemoveTab;
                originalRemoveTab = null;
            }
            listening = false;
        }
        /* Never strand hidden tabs: turning the feature off reveals every
         * tab this window hid. Non-browser windows (Library etc.) have no
         * gBrowser — nothing to unhide there. */
        if (typeof gBrowser === "undefined" || !gBrowser.tabs) {
            return;
        }
        for (var i = 0; i < gBrowser.tabs.length; i++) {
            if (gBrowser.tabs[i].hidden) {
                gBrowser.showTab(gBrowser.tabs[i]);
            }
        }
    }

    var prefObserver = {
        observe: function (subject, topic, data) {
            if (data === PREF) {
                if (enabled()) {
                    init();
                } else {
                    teardown();
                }
            }
        },
    };
    prefs.addObserver(PREF, prefObserver, false);

    window.addEventListener("unload", function () {
        prefs.removeObserver(PREF, prefObserver);
    });

    if (enabled()) {
        init();
    }
})();
