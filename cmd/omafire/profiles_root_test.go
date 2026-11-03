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

func TestFirefoxRootWithUnrelatedMozillaDirectory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("MOZ_LEGACY_HOME", "")
	t.Setenv("XDG_CONFIG_HOME", home+"/xdg")
	legacy := home + "/.mozilla/firefox"
	xdg := home + "/xdg/mozilla/firefox"
	for _, root := range []string{legacy, xdg} {
		if err := os.MkdirAll(root, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(xdg+"/profiles.ini", []byte("[Profile0]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := firefoxRoot(home); got != xdg {
		t.Fatalf("XDG profiles with unrelated legacy directory: %s, want %s", got, xdg)
	}
	t.Setenv("MOZ_LEGACY_HOME", "1")
	if got := firefoxRoot(home); got != legacy {
		t.Fatalf("explicit legacy: %s, want %s", got, legacy)
	}
	t.Setenv("MOZ_LEGACY_HOME", "")
	if err := os.WriteFile(legacy+"/profiles.ini", []byte("[Profile0]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := firefoxRoot(home); got != legacy {
		t.Fatalf("both registered roots: %s, want %s", got, legacy)
	}
}
