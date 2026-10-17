package main

import (
	"os"
	"testing"
)

func TestFirefoxRoot(t *testing.T) {
	home := t.TempDir()
	t.Setenv("MOZ_LEGACY_HOME", "")
	t.Setenv("XDG_CONFIG_HOME", "")
	if got, want := firefoxRoot(home), home+"/.config/mozilla/firefox"; got != want {
		t.Errorf("fresh home: %s, want %s", got, want)
	}
	t.Setenv("XDG_CONFIG_HOME", home+"/xdg")
	if got, want := firefoxRoot(home), home+"/xdg/mozilla/firefox"; got != want {
		t.Errorf("XDG_CONFIG_HOME: %s, want %s", got, want)
	}
	t.Setenv("MOZ_LEGACY_HOME", "1")
	if got, want := firefoxRoot(home), home+"/.mozilla/firefox"; got != want {
		t.Errorf("MOZ_LEGACY_HOME: %s, want %s", got, want)
	}
	t.Setenv("MOZ_LEGACY_HOME", "")
	if err := os.Mkdir(home+"/.mozilla", 0o700); err != nil {
		t.Fatal(err)
	}
	if got, want := firefoxRoot(home), home+"/.mozilla/firefox"; got != want {
		t.Errorf("existing ~/.mozilla: %s, want %s", got, want)
	}
}
