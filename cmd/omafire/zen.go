package main

import (
	"fmt"

	"golang.org/x/sys/unix"
)

type zenProfile struct{ chrome, bridge, userChrome, userPrefs string }

func zenPaths(profile string) zenProfile {
	chrome := profile + "/chrome"
	return zenProfile{chrome, chrome + "/omafire.css", chrome + "/userChrome.css", profile + "/user.js"}
}

func zenBridgeOwned(target string) bool {
	return isRegularFile(target) && !pathIsSymlink(target) && firstLineIs(target, zenBridgeMarker)
}

func validateZenBridge(target string) {
	if pathIsSymlink(target) {
		fail("refusing to replace symlinked Zen bridge: %s", target)
	}
	if pathExists(target) && !isRegularFile(target) {
		fail("Zen bridge path is not a regular file: %s", target)
	}
	if isRegularFile(target) && !zenBridgeOwned(target) {
		fail("refusing to modify unmanaged Zen bridge: %s", target)
	}
}

func validateZenProfile(profile string) {
	z := zenPaths(profile)
	if pathExists(z.chrome) && !isDir(z.chrome) {
		fail("Zen chrome path is not a directory: %s", z.chrome)
	}
	validateZenBridge(z.bridge)
	validateManagedBlock(z.userChrome, zenCSSBegin, zenCSSEnd, "Zen profile file")
	validateManagedBlock(z.userPrefs, zenPrefsBegin, zenPrefsEnd, "Zen profile file")
}

func configureZenProfile(profile string) {
	z := zenPaths(profile)
	if pathExists(z.chrome) {
		if !isDir(z.chrome) {
			fail("Zen chrome path is not a directory: %s", z.chrome)
		}
	} else {
		mkdirP700(z.chrome)
	}

	bridge, ok := readFile(zenBridgeSource)
	if !ok {
		fail("packaged Zen bridge is missing or invalid: %s", zenBridgeSource)
	}
	atomicWrite(z.bridge, bridge, 0o600, false)

	installManagedBlock(z.userChrome, zenCSSBegin, zenCSSEnd,
		zenCSSBegin+"\n@import url(\"omafire.css\");\n\n"+zenCSSEnd+"\n",
		true, "Zen profile file")
	installManagedBlock(z.userPrefs, zenPrefsBegin, zenPrefsEnd,
		zenPrefsBegin+"\n"+
			"user_pref(\"toolkit.legacyUserProfileCustomizations.stylesheets\", true);\n"+
			"user_pref(\"zen.theme.disable-lightweight\", false);\n"+
			zenPrefsEnd+"\n",
		false, "Zen profile file")

	removeLegacyZenBridge(z.chrome)
	fmt.Printf("Configured Zen profile: %s\n", profile)
	noteWrittenProfile(profile, "Zen Browser")
}

// setupZenProfiles validates every writable profile before changing any,
// and returns how many it configured.
func setupZenProfiles() int {
	if !isRegularFile(zenProfilesFile) {
		return 0
	}
	var profiles []string
	for _, profile := range listProfiles(zenProfilesFile, zenRoot) {
		if profileWritable(profile, "Zen", true) {
			profiles = append(profiles, profile)
		}
	}
	if len(profiles) == 0 {
		return 0
	}
	if !zenBridgeOwned(zenBridgeSource) {
		fail("packaged Zen bridge is missing or invalid: %s", zenBridgeSource)
	}
	for _, profile := range profiles {
		validateZenProfile(profile)
	}
	for _, profile := range profiles {
		configureZenProfile(profile)
	}
	return len(profiles)
}

func zenProfileStatus(profile string) string {
	z := zenPaths(profile)
	switch {
	case pathExists(z.bridge) && !zenBridgeOwned(z.bridge):
		return "conflict"
	case zenBridgeOwned(z.bridge) &&
		managedBlockPresent(z.userChrome, zenCSSBegin, zenCSSEnd) &&
		managedBlockPresent(z.userPrefs, zenPrefsBegin, zenPrefsEnd):
		// "outdated" only when the packaged bridge exists and differs; a
		// missing package file still reports configured (upstream parity).
		packaged, havePackaged := readFile(zenBridgeSource)
		installed, haveInstalled := readFile(z.bridge)
		if havePackaged && !(haveInstalled && installed == packaged) {
			return "outdated"
		}
		return "configured"
	case pathExists(z.bridge) ||
		managedMarkerPresent(z.userChrome, zenCSSBegin, zenCSSEnd) ||
		managedMarkerPresent(z.userPrefs, zenPrefsBegin, zenPrefsEnd):
		return "incomplete"
	}
	return "not configured"
}

func removeZenProfile(profile string) {
	z := zenPaths(profile)
	validateZenBridge(z.bridge)
	configured := pathExists(z.bridge) ||
		managedMarkerPresent(z.userChrome, zenCSSBegin, zenCSSEnd) ||
		managedMarkerPresent(z.userPrefs, zenPrefsBegin, zenPrefsEnd)

	removeManagedBlock(z.userChrome, zenCSSBegin, zenCSSEnd, "Zen profile file")
	removeManagedBlock(z.userPrefs, zenPrefsBegin, zenPrefsEnd, "Zen profile file")
	if isRegularFile(z.bridge) {
		unix.Unlink(z.bridge)
	}
	removeLegacyZenBridge(z.chrome)
	if configured {
		fmt.Printf("Removed Zen profile bridge: %s\n", profile)
		noteWrittenProfile(profile, "Zen Browser")
	}
}

func removeZenProfiles() {
	if !isRegularFile(zenProfilesFile) {
		return
	}
	profiles := listProfiles(zenProfilesFile, zenRoot)
	for _, profile := range profiles {
		if profileWritable(profile, "Zen", false) {
			validateZenProfile(profile)
		}
	}
	for _, profile := range profiles {
		if profileWritable(profile, "Zen", true) {
			removeZenProfile(profile)
		}
	}
}
