// omafire: Omarchy → Firefox/Zen theme sync command.
//
// Speaks the omafox v1 protocol so both the upstream-signed @omafox
// WebExtension and the Omafire extension work unmodified: `sync` normalizes
// the current Quattro palette into ~/.local/state/omafire/theme.json and the
// native host pushes it to connected browsers over inotify.
//
// Firefox support adds the same managed-block pattern used for Zen:
//
//	chrome/userChrome.css       BEGIN/END OMAFIRE FIREFOX BRIDGE import block
//	user.js                     managed prefs (stylesheet loading, dark canvas)
//	chrome/omafire/             packaged theme payload
//	chrome/omafire-palette.css  regenerated on every sync so the first
//	                            painted frame already uses the palette.
package main

import (
	"fmt"
	"os"
	"slices"

	"golang.org/x/sys/unix"
)

const programName = "omafire"

// version is the release version from VERSION; make sets it with -ldflags.
var version = "unknown"

// Resolved paths, set once by initPaths.
var (
	themeDir           string
	themeNameFile      string
	backgroundLink     string
	hookPath           string
	stateDir           string
	stateFile          string
	nativeHostPath     string
	nativeManifestPath string
	hookSource         string
	zenRoot            string
	zenProfilesFile    string
	zenBridgeSource    string
	ffRoot             string
	ffProfilesFile     string
	ffPayloadSource    string
)

func fail(format string, args ...any) {
	if guarded {
		panic(guardedFailure(fmt.Sprintf(format, args...)))
	}
	fmt.Fprintf(os.Stderr, programName+": "+format+"\n", args...)
	os.Exit(1)
}

// guardedFailure is what fail raises inside guard instead of exiting.
type guardedFailure string

var guarded bool

// guard runs fn and returns the message of the first fail inside it
// ("" when it finished): one unit of work (a profile) may refuse without
// ending the run for the others. Not for concurrent use.
func guard(fn func()) (msg string) {
	outer := guarded
	guarded = true
	defer func() {
		guarded = outer
		if r := recover(); r != nil {
			f, ok := r.(guardedFailure)
			if !ok {
				panic(r)
			}
			msg = string(f)
		}
	}()
	fn()
	return ""
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func homeDir() string {
	home := os.Getenv("HOME")
	if home == "" {
		fail("HOME is not set")
	}
	return home
}

func initPaths() {
	home := homeDir()
	themeDir = envOr("OMAFIRE_THEME_DIR", home+"/.local/state/omarchy/current/theme")
	themeNameFile = envOr("OMAFIRE_THEME_NAME_FILE", home+"/.local/state/omarchy/current/theme.name")
	backgroundLink = envOr("OMAFIRE_BACKGROUND", home+"/.local/state/omarchy/current/background")
	hookPath = home + "/.config/omarchy/hooks/theme-set.d/omafire"
	stateDir = home + "/.local/state/omafire"
	stateFile = stateDir + "/theme.json"
	nativeHostPath = envOr("OMAFIRE_NATIVE_HOST_PATH", "/usr/lib/omafire/omafire-native-host")
	nativeManifestPath = envOr("OMAFIRE_NATIVE_MANIFEST_PATH",
		"/usr/lib/mozilla/native-messaging-hosts/org.omarchy.omafox.json")
	hookSource = envOr("OMAFIRE_HOOK_SOURCE", "/usr/share/omafire/hooks/omafire")
	zenRoot = envOr("OMAFIRE_ZEN_ROOT", home+"/.config/zen")
	zenProfilesFile = envOr("OMAFIRE_ZEN_PROFILES_FILE", zenRoot+"/profiles.ini")
	zenBridgeSource = envOr("OMAFIRE_ZEN_BRIDGE_SOURCE", "/usr/share/omafire/zen/omafire.css")
	ffRoot = envOr("OMAFIRE_FIREFOX_ROOT", home+"/.mozilla/firefox")
	ffProfilesFile = envOr("OMAFIRE_FIREFOX_PROFILES_FILE", ffRoot+"/profiles.ini")
	ffPayloadSource = envOr("OMAFIRE_FIREFOX_PAYLOAD_SOURCE", "/usr/share/omafire/firefox/chrome")
	initConfigPath(home)
	initShellPluginPaths(home)
}

// ---------------------------------------------------------------- commands

func cmdSync() {
	requireQuattro()
	p := readPalette()
	payload := formatPayload(p, jsonEscape(currentThemeName()))
	// Profile files first: the same palette for the first painted frame, and
	// ready before theme.json below wakes the extension, whose repaint is
	// what tells the live-palette chrome script to reread them.
	skipped := refreshFFProfilesColors(p)
	storeThemePayload(payload)
	sweepLeftoverTemps()
	if skipped > 0 {
		// The refusals were printed as they happened; the exit status
		// still says that not every profile follows the theme.
		fmt.Fprintf(os.Stderr, programName+": %d Firefox profile(s) skipped; fix them and run omafire sync again\n", skipped)
		os.Exit(1)
	}
}

func cmdSetup() {
	requireQuattro()
	readPalette() // refuses an unusable palette before anything is changed
	if unix.Access(nativeHostPath, unix.X_OK) != nil {
		fail("packaged native host not found: %s", nativeHostPath)
	}
	if !isRegularFile(nativeManifestPath) {
		fail("packaged native manifest not found: %s", nativeManifestPath)
	}
	if unix.Access(hookSource, unix.X_OK) != nil {
		fail("packaged Omarchy hook not found: %s", hookSource)
	}

	if status, _ := runCommand([]string{"omarchy", "hook", "install", "theme-set", hookSource}, false); status != 0 {
		fail("omarchy hook install failed")
	}
	fmt.Printf("Enabled user hook: %s\n", hookPath)
	removeLegacyHooks()
	fmt.Printf("Using packaged native host: %s\n", nativeHostPath)

	backupCommand = "setup"
	zenConfigured := setupZenProfiles()
	ffConfigured := setupFFProfiles()
	setupShellPlugin()
	backupCommand = "" // the palette refresh below changes no user file
	cmdSync()
	fmt.Println("Queued the current Omarchy palette for connected browsers.")
	if zenConfigured > 0 {
		fmt.Println("Restart Zen Browser once to load the Omafire bridge.")
	}
	if ffConfigured > 0 {
		fmt.Println("Restart Firefox once to load the Omafire bridge.")
	}
	if backupDir != "" {
		recordWrote()
		fmt.Printf("Backed up the files it changed to %s\n", backupDir)
	}
	psdResync()
}

func cmdRemove() {
	backupCommand = "remove"
	removeZenProfiles()
	removeFFProfiles()
	removeShellPlugin()
	sweepLeftoverTemps()

	if pathExists(hookPath) {
		unix.Unlink(hookPath)
		fmt.Printf("Removed hook: %s\n", hookPath)
	}
	removeLegacyHooks()
	if pathExists(stateFile) {
		unix.Unlink(stateFile)
		fmt.Printf("Removed theme state: %s\n", stateFile)
	}
	// Backups stay (they are how a remove is undone); the lock goes with the
	// state directory when nothing else is left in it.
	unix.Unlink(stateDir + "/lock")
	unix.Rmdir(stateDir)
	if backupDir != "" {
		recordWrote()
		fmt.Printf("Backed up the files it changed to %s\n", backupDir)
	}
	psdResync()
	fmt.Println("System files are managed by pacman; remove them with: sudo pacman -Rns omafire")
}

func usage() {
	fmt.Print(`Usage: omafire <command>

Keep Firefox and Zen Browser in sync with the current Omarchy Quattro palette.
Settings live in ~/.config/omafire/config.json; Firefox follows them live.

Commands:
  sync     Queue the current palette for connected browsers
  payload  Print the current JSON protocol message
  status   Show the current theme and integration state (--json for scripts)
  setup    Enable the packaged Omafire integration for this user
  remove   Remove this user's Omafire hook and theme state
  restore  Put back the files a setup or remove changed, unless edited since: restore [<set>]
  get      Print the settings, or one: get [--json | <setting>]
  set      Change settings: set <setting> <value> [<setting> <value>]...
  reset    Return settings to their defaults: reset <setting>...
  watch    Print the settings as a JSON line now and after every change
  version  Print the Omafire version
  help     Show this help
`)
}

func main() {
	initPaths()

	command := "help"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	known := []string{"sync", "payload", "setup", "remove",
		"version", "-V", "--version", "help", "-h", "--help"}
	if slices.Contains(known, command) && len(os.Args) > 2 {
		fail("command '%s' does not accept arguments", command)
	}

	switch command {
	case "sync", "setup", "remove", "restore":
		migrateLegacyState()
		acquireLock()
	}

	switch command {
	case "sync":
		cmdSync()
	case "payload":
		requireQuattro()
		fmt.Print(formatPayload(readPalette(), jsonEscape(currentThemeName())))
	case "status":
		showStatus(os.Args[2:])
	case "get":
		cmdGet(os.Args[2:])
	case "set":
		cmdSet(os.Args[2:])
	case "reset":
		cmdReset(os.Args[2:])
	case "watch":
		cmdWatch(os.Args[2:])
	case "setup":
		cmdSetup()
	case "remove":
		cmdRemove()
	case "restore":
		cmdRestore(os.Args[2:])
	case "version", "-V", "--version":
		fmt.Println(version)
	case "help", "-h", "--help":
		usage()
	default:
		if len(command) > 0 && command[0] == '-' {
			fail("unknown option: %s", command)
		}
		fail("unknown command: %s", command)
	}
}
