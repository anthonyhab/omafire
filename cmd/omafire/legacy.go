package main

// What omafox (<= 0.2.0, this program's earlier name) left behind:
// recognised so an upgrade replaces it and remove still finds it.

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

const (
	legacyFFPayloadDirname = "omarchy-firefox"
	legacyZenBridgeName    = "omafox.css"
	legacyGeneratedPrefix  = "/* OMAFOX GENERATED "
	legacyHookCommand      = "exec /usr/bin/omafox sync"
)

var legacyGeneratedNames = []string{"omafox-palette.css", "omafox-content-palette.css", "omarchy-radius.css"}

// removeLegacyFFPayload removes omafox's payload directory, once the
// profile imports the new one.
func removeLegacyFFPayload(chrome string) {
	dir := chrome + "/" + legacyFFPayloadDirname
	if !pathIsSymlink(dir) && ffPayloadOwned(dir) {
		removeTree(dir)
		fsyncParent(dir)
	}
}

// cleanLegacyGenerated removes omafox's generated files when their marker
// says they are ours. Unless everything goes (remove), one the profile's
// entrypoints still import stays: a checkout of an older theme, or a
// profile setup has not reached yet, would lose its palette.
func cleanLegacyGenerated(chrome string, all bool) {
	var userChrome, userContent string
	if !all {
		userChrome, _ = readFile(chrome + "/userChrome.css")
		userContent, _ = readFile(chrome + "/userContent.css")
	}
	for _, name := range legacyGeneratedNames {
		path := chrome + "/" + name
		if !isRegularFile(path) || pathIsSymlink(path) {
			continue
		}
		head, _ := readFile(path)
		used := strings.Contains(userChrome, name) || strings.Contains(userContent, name)
		if strings.HasPrefix(head, legacyGeneratedPrefix) && !used {
			unix.Unlink(path)
			fsyncParent(path)
		}
	}
}

// removeLegacyZenBridge removes omafox's Zen bridge file, once
// userChrome.css imports the new one.
func removeLegacyZenBridge(chrome string) {
	bridge := chrome + "/" + legacyZenBridgeName
	if zenBridgeOwned(bridge) {
		unix.Unlink(bridge)
		fsyncParent(bridge)
	}
}

// removeLegacyHooks removes omafox's theme hook, which ran /usr/bin/omafox:
// under its own name, or any other a user gave it (00-omafox to run first).
// Recognised by the command it runs, never by name alone.
func removeLegacyHooks() {
	dir := homeDir() + "/.config/omarchy/hooks/theme-set.d"
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		hook := dir + "/" + entry.Name()
		if !isRegularFile(hook) || pathIsSymlink(hook) {
			continue
		}
		if text, ok := readFile(hook); ok && strings.Contains(text, legacyHookCommand) {
			unix.Unlink(hook)
			fmt.Printf("Removed the omafox hook: %s\n", hook)
		}
	}
}

// migrateLegacyState moves omafox's state (theme.json, backups) from
// ~/.local/state/omafox.
func migrateLegacyState() {
	old := homeDir() + "/.local/state/omafox"
	st, err := os.Lstat(old)
	if err == nil && st.IsDir() && !pathExists(stateDir) && os.Rename(old, stateDir) == nil {
		fsyncParent(stateDir)
	}
}
