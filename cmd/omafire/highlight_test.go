package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Every installed theme gets a selection and a search-hit colour that hold
// their ink at 4.5:1 (WCAG AA), differ from each other, and stand apart from
// the canvas; a palette with a weak accent (Rose Pine) falls back to a tint.
func TestHighlightFollowsEveryTheme(t *testing.T) {
	raw, err := os.ReadFile("../../tests/fixtures/palettes.json")
	if err != nil {
		t.Fatal(err)
	}
	var themes map[string]map[string]string
	if err := json.Unmarshal(raw, &themes); err != nil {
		t.Fatal(err)
	}
	if len(themes) < 20 {
		t.Fatalf("palettes.json lost themes: %d", len(themes))
	}
	solid := 0
	for name, colors := range themes {
		p := &palette{color: colors, mode: colors["mode"]}
		h, ok := highlightFor(p)
		if !ok {
			t.Errorf("%s: no highlight", name)
			continue
		}
		c := func(hex string) srgb { v, _ := hexSRGB(hex); return v }
		if r := contrast(c(h.selectionText), c(h.selection)); r < 4.5 {
			t.Errorf("%s: selection ink %.2f:1", name, r)
		}
		if r := contrast(c(h.markText), c(h.mark)); r < 4.5 {
			t.Errorf("%s: mark ink %.2f:1", name, r)
		}
		if h.selection == h.mark {
			t.Errorf("%s: selection and mark are the same colour", name)
		}
		if contrast(c(h.selection), c(colors["background"])) < 1.1 || contrast(c(h.mark), c(colors["background"])) < 1.05 {
			t.Errorf("%s: highlight invisible on the canvas (%s, %s)", name, h.selection, h.mark)
		}
		if h.selection == colors["accent"] {
			solid++
		}
		if name == "rose-pine" && h.selection == colors["accent"] {
			t.Errorf("rose-pine: a 3:1 accent must not be the solid selection")
		}
	}
	if solid == 0 {
		t.Error("no theme keeps the accent solid")
	}
}

func TestHighlightPrefsAndVars(t *testing.T) {
	p := &palette{mode: "dark", color: map[string]string{"accent": "#7e9cd8", "background": "#1f1f28", "foreground": "#dcd7ba"}}
	for _, want := range []string{`user_pref("ui.highlight", "#7e9cd8");`, `user_pref("ui.highlighttext", "#`, `user_pref("ui.mark", "#`, `user_pref("ui.marktext", "#dcd7ba");`} {
		if !strings.Contains(highlightPrefs(p), want) {
			t.Errorf("prefs lack %s:\n%s", want, highlightPrefs(p))
		}
	}
	if !strings.Contains(highlightVars(p), "--omafire-mark-text: #dcd7ba;") {
		t.Errorf("vars: %s", highlightVars(p))
	}
	// a palette without usable colours writes nothing rather than bad prefs
	if highlightPrefs(&palette{color: map[string]string{}}) != "" {
		t.Error("prefs for an empty palette")
	}
}
