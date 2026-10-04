package main

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

const prefsBefore = `// Mozilla User Preferences
user_pref("browser.startup.homepage", "about:blank");
user_pref("omafire.managed", true);
user_pref("browser.display.background_color", "#000000");
user_pref("browser.display.use_system_colors", false);
user_pref("browser.nova.enabled", true);
user_pref("omafire.extension.offered", true);
user_pref("ui.accentcolor", "#8d8d8d");
user_pref("omafire.scripts", false);
`

// remove must clear what keeps a profile managed (omafire-v2z.16) and leave
// the rest of prefs.js, including the user's own omafire.scripts switch.
func TestClearOwnedFFPrefs(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/prefs.js", []byte(prefsBefore), 0o600); err != nil {
		t.Fatal(err)
	}
	cleared, pending := clearOwnedFFPrefs(dir)
	if !cleared || pending {
		t.Fatalf("cleared=%v pending=%v", cleared, pending)
	}
	got, _ := os.ReadFile(dir + "/prefs.js")
	for _, gone := range []string{"omafire.managed", "background_color", "use_system_colors", "extension.offered", "ui.accentcolor"} {
		if strings.Contains(string(got), gone) {
			t.Errorf("%s still in prefs.js:\n%s", gone, got)
		}
	}
	for _, kept := range []string{"browser.startup.homepage", "browser.nova.enabled", "omafire.scripts", "// Mozilla User Preferences"} {
		if !strings.Contains(string(got), kept) {
			t.Errorf("%s was dropped:\n%s", kept, got)
		}
	}
	if cleared, pending = clearOwnedFFPrefs(dir); cleared || pending {
		t.Errorf("second run: cleared=%v pending=%v, want nothing to do", cleared, pending)
	}
}

// A running Firefox rewrites prefs.js on exit: the edit is deferred, the file
// untouched.
func TestClearOwnedFFPrefsWaitsForRunningFirefox(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/prefs.js", []byte(prefsBefore), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(fmt.Sprintf("host:+%d", os.Getpid()), dir+"/lock"); err != nil {
		t.Fatal(err)
	}
	cleared, pending := clearOwnedFFPrefs(dir)
	if cleared || !pending {
		t.Fatalf("cleared=%v pending=%v", cleared, pending)
	}
	if got, _ := os.ReadFile(dir + "/prefs.js"); string(got) != prefsBefore {
		t.Errorf("prefs.js changed while Firefox runs:\n%s", got)
	}
}

// One profile's refusal ends that profile's work, not the run (omafire-v2z.20).
func TestGuardReturnsTheFailure(t *testing.T) {
	if msg := guard(func() { fail("bad %s", "markers") }); msg != "bad markers" {
		t.Errorf("guard = %q", msg)
	}
	if msg := guard(func() {}); msg != "" {
		t.Errorf("guard of clean work = %q", msg)
	}
	if guarded {
		t.Error("guard left itself armed")
	}
}

// A colors.toml with no readable colour is refused (omafire-v2z.18); a
// partial one is fine and falls back for the rest.
func TestReadPaletteRefusesNoValidColour(t *testing.T) {
	dir := t.TempDir()
	old := themeDir
	themeDir = dir
	defer func() { themeDir = old }()
	write := func(s string) {
		if err := os.WriteFile(dir+"/colors.toml", []byte(s), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, bad := range []string{"", "garbage\n", "background = \"#zzzzzz\"\n", "mode = \"dark\"\n"} {
		write(bad)
		if msg := guard(func() { readPalette() }); !strings.Contains(msg, "no colour omafire can read") {
			t.Errorf("%q: guard = %q, want a refusal", bad, msg)
		}
	}
	write("background = \"#101010\"\n")
	if msg := guard(func() { readPalette() }); msg != "" {
		t.Errorf("partial palette refused: %q", msg)
	}
}

// An interrupted run's temp files and unmarked stages go (omafire-v2z.17);
// other names and the user's files stay.
func TestSweepTemps(t *testing.T) {
	dir := t.TempDir()
	old := time.Now().Add(-time.Hour)
	mk := func(name string, dir_ bool, age time.Time) {
		path := dir + "/" + name
		if dir_ {
			os.MkdirAll(path+"/x", 0o700)
		} else {
			os.WriteFile(path, []byte("x"), 0o600)
		}
		os.Chtimes(path, age, age)
	}
	mk(".omafire.123456", false, old)
	mk(".omafire.new.987", true, old)
	mk(".omafire.old.55", true, old)
	mk(".omafire.new.abc", true, old)  // not our name
	mk(".omafire.123.bak", false, old) // not our name
	mk("user.js", false, old)
	sweepTemps(dir)
	for _, gone := range []string{".omafire.123456", ".omafire.new.987", ".omafire.old.55"} {
		if _, err := os.Lstat(dir + "/" + gone); err == nil {
			t.Errorf("%s was not swept", gone)
		}
	}
	for _, kept := range []string{".omafire.new.abc", ".omafire.123.bak", "user.js"} {
		if _, err := os.Lstat(dir + "/" + kept); err != nil {
			t.Errorf("%s was removed", kept)
		}
	}
}
