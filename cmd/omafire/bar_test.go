package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBarSize(t *testing.T) {
	dir := t.TempDir()
	theme := filepath.Join(dir, "theme.toml")
	user := filepath.Join(dir, "user.toml")
	os.WriteFile(theme, []byte("[bar]\nbackground = \"#1f1f28\" # c\nscale-with-font  = true\nsize-horizontal  = 26\nsize-vertical    = 28\n"), 0o600)
	os.WriteFile(user, []byte("[font]\nbase-size = 11\n\n[bar]\nbackground-alpha = 0.5\n"), 0o600)
	values := shellValues(theme, user)
	for _, c := range []struct {
		name     string
		values   map[string]string
		vertical bool
		want     float64
	}{
		{"user's base-size 11", values, false, 24},
		{"vertical", values, true, 26},
		{"defaults", map[string]string{}, false, 26},
		{"fixed", map[string]string{"bar.scale-with-font": "false", "font.base-size": "16", "bar.size-horizontal": "30"}, false, 30},
		{"large font", map[string]string{"font.base-size": "16"}, false, 35},
	} {
		if got := barSize(c.values, c.vertical); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
	if got := barCSS(24, 0.9091); got != "26.4px" {
		t.Errorf("barCSS: %s", got)
	}
}
