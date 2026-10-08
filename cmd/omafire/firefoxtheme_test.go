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

func osakaJade() map[string]string {
	return map[string]string{
		"accent": "#509475", "selection": "#32473b", "muted": "#53685b",
		"background": "#111c18", "dark_background": "#0c1512", "darker_background": "#090f0d",
		"lighter_background": "#23372b", "foreground": "#c1c497", "dark_foreground": "#81b8a8",
		"light_foreground": "#d6d5bc", "bright_foreground": "#f7e8b2", "red": "#ff5345",
		"yellow": "#459451", "orange": "#a2734b", "green": "#549e6a", "cyan": "#2dd5b7",
		"blue": "#509475", "magenta": "#d2689c", "brown": "#513925", "bright_red": "#db9f9c",
		"bright_yellow": "#e5c736", "bright_green": "#63b07a", "bright_cyan": "#8cd3cb",
		"bright_blue": "#acd4cf", "bright_magenta": "#75bbb3",
	}
}

func themeVars(colors map[string]string, changes map[string]string) map[string]string {
	p := &palette{mode: "dark", color: map[string]string{}}
	for k, v := range colors {
		p.color[k] = v
	}
	for k, v := range changes {
		p.color[k] = v
	}
	vars := map[string]string{}
	for _, v := range firefoxThemeVars(p) {
		vars[v[0]] = v[1]
	}
	return vars
}

// Palettes the installed themes don't cover: text and fills still read.
func TestFirefoxThemeVarsHoldContrast(t *testing.T) {
	base := osakaJade()
	v := themeVars(base, nil)
	for name, want := range map[string]string{
		"--lwt-accent-color":                      base["background"],
		"--lwt-tab-line-color":                    base["accent"],
		"--lwt-toolbar-field-highlight":           base["selection"],
		"--lwt-toolbar-field-highlight-text":      base["bright_foreground"],
		"--toolbarbutton-background-color-active": base["selection"],
		"--urlbarview-background-color-selected":  base["selection"],
		"--chrome-content-separator-color":        base["brown"],
	} {
		if v[name] != want {
			t.Errorf("osaka-jade %s = %s, want %s", name, v[name], want)
		}
	}

	// Selection as light as its ink: the ink falls back to the background.
	v = themeVars(base, map[string]string{"selection": "#fdfafa", "bright_foreground": "#fefbfb"})
	if got := v["--lwt-toolbar-field-highlight-text"]; got != base["background"] {
		t.Errorf("light selection: highlight text %s, want %s", got, base["background"])
	}

	// Near-white inks: the pressed fill still holds the text, and a popup
	// row falls back to the accent.
	v = themeVars(base, map[string]string{"accent": "#ae6378", "selection": "#fdfafa",
		"foreground": "#fdfafa", "light_foreground": "#fdfbfb", "bright_foreground": "#fefbfb",
		"bright_yellow": "#ffd384"})
	if c := contrastHex(v["--toolbarbutton-background-color-active"], v["--toolbar-text-color"]); c < minTextContrast {
		t.Errorf("near-white inks: pressed fill contrast %.2f", c)
	}
	if got := v["--urlbarview-background-color-selected"]; got != "#ae6378" {
		t.Errorf("near-white inks: popup row %s, want the accent", got)
	}

	// Grey on grey: toolbar, hover and selected tab text all still read.
	v = themeVars(base, map[string]string{"dark_background": "#777777", "lighter_background": "#858585",
		"foreground": "#808080", "light_foreground": "#828282", "bright_foreground": "#848484"})
	for _, pair := range [][2]string{
		{"--toolbar-background-color", "--toolbar-text-color"},
		{"--toolbarbutton-background-color-hover", "--toolbar-text-color"},
		{"--tab-background-color-selected", "--tab-text-color-selected"},
	} {
		if c := contrastHex(v[pair[0]], v[pair[1]]); c < minTextContrast {
			t.Errorf("grey palette: %s under %s is %.2f:1", pair[1], pair[0], c)
		}
	}

	// One grey for everything: black ink.
	mono := map[string]string{}
	for k := range base {
		mono[k] = "#777777"
	}
	if got := themeVars(mono, nil)["--lwt-toolbar-field-highlight-text"]; got != "#000000" {
		t.Errorf("monochrome: highlight text %s, want #000000", got)
	}
}
