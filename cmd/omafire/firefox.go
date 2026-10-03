package main

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

const (
	ffPaletteName        = "omafire-palette.css"
	ffContentPaletteName = "omafire-content-palette.css"
	ffRadiusName         = "omafire-radius.css"
	ffPayloadDirname     = "omafire"
	ffPayloadEntry       = "userChrome.css"
)

type ffProfile struct{ chrome, payload, userChrome, userContent, userPrefs string }

func ffPaths(profile string) ffProfile {
	chrome := profile + "/chrome"
	return ffProfile{chrome, chrome + "/" + ffPayloadDirname, chrome + "/userChrome.css",
		chrome + "/userContent.css", profile + "/user.js"}
}

// ffPayloadOwned: the packaged payload directory owns
// profile/chrome/omafire/, marked by its entrypoint's first line.
func ffPayloadOwned(dir string) bool {
	entry := dir + "/" + ffPayloadEntry
	return isRegularFile(entry) && !pathIsSymlink(entry) && firstLineIs(entry, ffBridgeMarker)
}

// ffChromeIsCheckout: a profile whose chrome/ is itself an Omafire theme
// checkout (the development symlink) must not also get the packaged payload:
// both copies would load and the older one would shadow the checkout. Such a
// profile gets the prefs block and the generated files only, written in
// chrome/ like any profile's, where the checkout's entrypoints import them. The first marker
// is the Nova theme; the second the pre-Nova layout, still recognised so a
// checkout is never mistaken for an empty profile mid-migration.
func ffChromeIsCheckout(chrome string) bool {
	return isRegularFile(chrome+"/src/tokens.css") || isRegularFile(chrome+"/omarchy-chrome.css")
}

func validateFFPayload(dir string) {
	if pathIsSymlink(dir) {
		fail("refusing to replace symlinked Firefox payload: %s", dir)
	}
	if pathExists(dir) {
		if !isDir(dir) {
			fail("Firefox payload path is not a directory: %s", dir)
		}
		if !ffPayloadOwned(dir) {
			fail("refusing to modify unmanaged Firefox payload: %s", dir)
		}
	}
}

func validateFFProfile(profile string) {
	f := ffPaths(profile)
	if pathExists(f.chrome) && !isDir(f.chrome) {
		fail("Firefox chrome path is not a directory: %s", f.chrome)
	}
	validateFFPayload(f.payload)
	validateManagedBlock(f.userChrome, ffCSSBegin, ffCSSEnd, "Firefox profile file")
	validateManagedBlock(f.userContent, ffCSSBegin, ffCSSEnd, "Firefox profile file")
	validateManagedBlock(f.userPrefs, ffPrefsBegin, ffPrefsEnd, "Firefox profile file")
}

// copyTree stages the payload into a fresh directory; a file that cannot be
// read fails the install rather than leaving a partial payload. Symlinks
// are not copied.
func copyTree(src, dst string) {
	entries, err := os.ReadDir(src)
	if err != nil {
		fail("could not read Firefox payload: %s", src)
	}
	mkdirP700(dst)
	for _, entry := range entries {
		srcPath, dstPath := src+"/"+entry.Name(), dst+"/"+entry.Name()
		switch {
		case entry.IsDir():
			copyTree(srcPath, dstPath)
		case entry.Type().IsRegular():
			data, ok := readFile(srcPath)
			if !ok {
				fail("could not read Firefox payload file: %s", srcPath)
			}
			atomicWrite(dstPath, data, 0o600, false)
		}
	}
}

// removeFFPayloadTree removes a payload tree with its ownership marker (the
// entrypoint) last, and only once everything else is gone: a removal cut
// short leaves a tree still marked as ours, which the next run finishes,
// never an unmarked one that setup and remove must refuse as the user's.
func removeFFPayloadTree(dir string) {
	st, err := os.Lstat(dir)
	if err != nil || !st.IsDir() {
		return
	}
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		child := dir + "/" + entry.Name()
		switch {
		case entry.Name() == ffPayloadEntry:
		case entry.IsDir():
			removeTree(child)
		default:
			unix.Unlink(child)
		}
	}
	if rest, _ := os.ReadDir(dir); len(rest) > 1 || len(rest) == 1 && rest[0].Name() != ffPayloadEntry {
		return
	}
	unix.Unlink(dir + "/" + ffPayloadEntry)
	unix.Rmdir(dir)
}

// Staging names beside the payload: .omafire.new.*, .omafire.old.*
func ffPayloadLeftover(name string) bool {
	return strings.HasPrefix(name, "."+ffPayloadDirname+".new.") ||
		strings.HasPrefix(name, "."+ffPayloadDirname+".old.")
}

// cleanFFPayloadLeftovers removes what an interrupted install left beside
// the payload, if ours.
func cleanFFPayloadLeftovers(chrome string) {
	entries, _ := os.ReadDir(chrome)
	for _, entry := range entries {
		path := chrome + "/" + entry.Name()
		if ffPayloadLeftover(entry.Name()) && !pathIsSymlink(path) && ffPayloadOwned(path) {
			removeFFPayloadTree(path)
		}
	}
}

// installFFPayload replaces the payload as one step: the new tree is built
// beside it, then swapped in. Firefox never sees a half-copied theme, and
// files dropped from the new payload go with the old tree.
func installFFPayload(chrome, payload string) {
	cleanFFPayloadLeftovers(chrome)
	stage, err := os.MkdirTemp(chrome, "."+ffPayloadDirname+".new.*")
	if err != nil {
		fail("could not stage the Firefox payload in %s", chrome)
	}
	copyTree(ffPayloadSource, stage)
	if !ffPayloadOwned(stage) {
		removeFFPayloadTree(stage)
		fail("staged Firefox payload has no ownership marker: %s", stage)
	}
	switch {
	case !pathExists(payload):
		if os.Rename(stage, payload) != nil {
			removeFFPayloadTree(stage)
			fail("could not install the Firefox payload: %s", payload)
		}
	case unix.Renameat2(unix.AT_FDCWD, stage, unix.AT_FDCWD, payload, unix.RENAME_EXCHANGE) == nil:
		removeFFPayloadTree(stage) // now the previous payload
	default:
		// No atomic exchange here: two renames, the window between them a
		// missing (not a mixed) payload that the next run repairs.
		old, err := os.MkdirTemp(chrome, "."+ffPayloadDirname+".old.*")
		if err == nil && unix.Rmdir(old) == nil && os.Rename(payload, old) == nil {
			if os.Rename(stage, payload) != nil {
				os.Rename(old, payload)
				removeFFPayloadTree(stage)
				fail("could not replace the Firefox payload: %s", payload)
			}
			removeFFPayloadTree(old)
			break
		}
		// Nor a rename of the old tree: profile-sync-daemon's fuse-overlayfs
		// refuses one (EXDEV) once psd has synced it to the lower layer. Our
		// own tree goes, and the new one moves in: the same window.
		if !ffPayloadOwned(payload) {
			removeFFPayloadTree(stage)
			fail("could not replace the Firefox payload: %s", payload)
		}
		removeFFPayloadTree(payload)
		if pathExists(payload) || os.Rename(stage, payload) != nil {
			removeFFPayloadTree(stage)
			fail("could not replace the Firefox payload: %s", payload)
		}
	}
	fsyncParent(payload)
}

// ffBootstrapPrefs is the prefs block before the first sync fills it in.
const ffBootstrapPrefs = ffPrefsBegin + "\n" +
	"user_pref(\"toolkit.legacyUserProfileCustomizations.stylesheets\", true);\n" +
	"user_pref(\"svg.context-properties.content.enabled\", true);\n" +
	"user_pref(\"browser.theme.dark-private-windows\", false);\n" +
	"user_pref(\"browser.tabs.allow_transparent_browser\", true);\n" +
	"user_pref(\"widget.wayland.opaque-region.enabled\", false);\n" +
	"user_pref(\"omafire.managed\", true);\n" +
	ffPrefsEnd + "\n"

func configureFFProfile(profile string) {
	f := ffPaths(profile)
	if !pathExists(f.chrome) {
		mkdirP700(f.chrome)
	}
	checkout := ffChromeIsCheckout(f.chrome)
	if checkout {
		// Undo what earlier releases installed into the checkout. Its marker
		// pair is kept, narrowed to the palette import: omafox <= 1.1.0
		// refreshes the palette only while the markers exist.
		replaceManagedBlockInPlace(f.userChrome, ffCSSBegin, ffCSSEnd,
			ffCSSBegin+"\n@import \""+ffPaletteName+"\";\n"+ffCSSEnd+"\n", "Firefox profile file")
		removeManagedBlock(f.userContent, ffCSSBegin, ffCSSEnd, "Firefox profile file")
		if ffPayloadOwned(f.payload) {
			removeFFPayloadTree(f.payload)
		}
	} else {
		installFFPayload(f.chrome, f.payload)
		installManagedBlock(f.userChrome, ffCSSBegin, ffCSSEnd,
			ffCSSBegin+"\n"+
				"@import url(\""+ffPayloadDirname+"/"+ffPayloadEntry+"\");\n"+
				"@import url(\""+ffPaletteName+"\");\n\n"+
				ffCSSEnd+"\n",
			true, "Firefox profile file")
		installManagedBlock(f.userContent, ffCSSBegin, ffCSSEnd,
			ffCSSBegin+"\n@import url(\""+ffPayloadDirname+"/userContent.css\");\n\n"+ffCSSEnd+"\n",
			true, "Firefox profile file")
	}
	// The profile imports the new names now; omafox's payload can go.
	removeLegacyFFPayload(f.chrome)

	// The bootstrap prefs, only where there is no block yet: the sync that
	// setup runs next writes the full block (palette prefs included), so
	// rewriting it here would only churn the user's user.js on every run.
	if !managedBlockPresent(f.userPrefs, ffPrefsBegin, ffPrefsEnd) {
		installManagedBlock(f.userPrefs, ffPrefsBegin, ffPrefsEnd, ffBootstrapPrefs, false, "Firefox profile file")
	}

	if checkout {
		fmt.Printf("Configured Firefox profile (theme checkout): %s\n", profile)
	} else {
		fmt.Printf("Configured Firefox profile: %s\n", profile)
	}
	noteWrittenProfile(profile, "Firefox")
}

// setupFFProfiles validates every writable profile before changing any,
// and returns how many it configured.
func setupFFProfiles() int {
	if !isRegularFile(ffProfilesFile) {
		return 0
	}
	if !ffPayloadOwned(ffPayloadSource) {
		return 0 // Firefox payload not packaged; palette sync still works.
	}
	var profiles []string
	for _, profile := range listProfiles(ffProfilesFile, ffRoot) {
		if profileWritable(profile, "Firefox", true) {
			profiles = append(profiles, profile)
		}
	}
	for _, profile := range profiles {
		validateFFProfile(profile)
	}
	for _, profile := range profiles {
		configureFFProfile(profile)
	}
	return len(profiles)
}

func ffProfileStatus(profile string) string {
	f := ffPaths(profile)
	legacy := ffPayloadOwned(f.chrome + "/" + legacyFFPayloadDirname)
	checkout := ffChromeIsCheckout(f.chrome)
	switch {
	case pathExists(f.payload) && !ffPayloadOwned(f.payload):
		return "conflict"
	case legacy && !checkout:
		return "outdated (set up by omafox; run omafire setup)"
	case checkout:
		// A leftover payload or import block would shadow the checkout.
		userChrome, _ := readFile(f.userChrome)
		userContent, _ := readFile(f.userContent)
		switch {
		case pathExists(f.payload) ||
			strings.Contains(userChrome, ffPayloadDirname+"/") ||
			strings.Contains(userContent, ffPayloadDirname+"/"):
			return "theme checkout, outdated"
		case managedBlockPresent(f.userPrefs, ffPrefsBegin, ffPrefsEnd):
			return "theme checkout"
		}
		return "theme checkout, not configured"
	case ffPayloadOwned(f.payload) &&
		managedBlockPresent(f.userChrome, ffCSSBegin, ffCSSEnd) &&
		managedBlockPresent(f.userContent, ffCSSBegin, ffCSSEnd) &&
		managedBlockPresent(f.userPrefs, ffPrefsBegin, ffPrefsEnd):
		packaged, havePackaged := readFile(ffPayloadSource + "/" + ffPayloadEntry)
		installed, haveInstalled := readFile(f.payload + "/" + ffPayloadEntry)
		if havePackaged && !(haveInstalled && installed == packaged) {
			return "outdated"
		}
		return "configured"
	case pathExists(f.payload) ||
		managedMarkerPresent(f.userChrome, ffCSSBegin, ffCSSEnd) ||
		managedMarkerPresent(f.userContent, ffCSSBegin, ffCSSEnd) ||
		managedMarkerPresent(f.userPrefs, ffPrefsBegin, ffPrefsEnd):
		return "incomplete"
	}
	return "not configured"
}

func removeFFProfile(profile string) {
	f := ffPaths(profile)
	validateFFPayload(f.payload)
	// A checkout's userChrome.css carries the marker pair as tracked source
	// (theme/userChrome.css): the checkout's, never ours to strip.
	checkout := ffChromeIsCheckout(f.chrome)
	configured := pathExists(f.payload) ||
		ffPayloadOwned(f.chrome+"/"+legacyFFPayloadDirname) ||
		!checkout && managedMarkerPresent(f.userChrome, ffCSSBegin, ffCSSEnd) ||
		managedMarkerPresent(f.userContent, ffCSSBegin, ffCSSEnd) ||
		managedMarkerPresent(f.userPrefs, ffPrefsBegin, ffPrefsEnd)

	if !checkout {
		removeManagedBlock(f.userChrome, ffCSSBegin, ffCSSEnd, "Firefox profile file")
	}
	removeManagedBlock(f.userContent, ffCSSBegin, ffCSSEnd, "Firefox profile file")
	removeManagedBlock(f.userPrefs, ffPrefsBegin, ffPrefsEnd, "Firefox profile file")
	if ffPayloadOwned(f.payload) {
		removeFFPayloadTree(f.payload)
	}
	removeLegacyFFPayload(f.chrome)
	cleanLegacyGenerated(f.chrome, true)
	for _, name := range []string{ffPaletteName, ffContentPaletteName} {
		if isRegularFile(f.chrome + "/" + name) {
			unix.Unlink(f.chrome + "/" + name)
		}
	}
	// The radius file is shared with the old per-user hook; only ours goes.
	if radius := f.chrome + "/" + ffRadiusName; firstLineIs(radius, ffRadiusMarker) {
		unix.Unlink(radius)
	}
	if configured {
		fmt.Printf("Removed Firefox profile bridge: %s\n", profile)
		noteWrittenProfile(profile, "Firefox")
	}
}

func removeFFProfiles() {
	if !isRegularFile(ffProfilesFile) {
		return
	}
	profiles := listProfiles(ffProfilesFile, ffRoot)
	for _, profile := range profiles {
		if profileWritable(profile, "Firefox", false) {
			validateFFProfile(profile)
		}
	}
	for _, profile := range profiles {
		if profileWritable(profile, "Firefox", true) {
			removeFFProfile(profile)
		}
	}
}
