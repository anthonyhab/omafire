package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// testdata/firefox-theme.json holds, for every installed Omarchy palette,
// the colours the Omafire add-on's lightweight theme set (extension/theme.js,
// generated before the add-on was retired). The chrome must look the same
// without it.
func TestFirefoxThemeVarsMatchTheAddOn(t *testing.T) {
	var palettes map[string]map[string]string
	var want map[string]map[string]string
	for path, v := range map[string]any{
		"../../tests/fixtures/palettes.json": &palettes,
		"testdata/firefox-theme.json":        &want,
	} {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(data, v); err != nil {
			t.Fatal(err)
		}
	}
	for name, colors := range palettes {
		p := &palette{mode: colors["mode"], color: map[string]string{}}
		for k, v := range colors {
			p.color[k] = strings.ToLower(v)
		}
		got := firefoxThemeVars(p)
		if len(got) != len(want[name]) {
			t.Errorf("%s: %d variables, want %d", name, len(got), len(want[name]))
		}
		for _, v := range got {
			if v[1] != want[name][v[0]] {
				t.Errorf("%s: %s = %s, want %s", name, v[0], v[1], want[name][v[0]])
			}
		}
	}
}
