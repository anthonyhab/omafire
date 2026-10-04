package main

import "fmt"

// pageHighlight is how Firefox's forced colours paint a selection
// (Highlight) and a search hit (Mark) on every page: the theme's accent, not
// the system's GTK blue and Mark yellow. A selection is the accent solid (the
// fill of an interaction); a hit is a faint tint of the same accent under
// the page's own ink, so one colour family speaks for both. Both clear 4.5:1
// by construction: a weak accent (Rose Pine) gets a tint, not a solid it
// cannot hold ink on.
type pageHighlight struct {
	selection, selectionText, mark, markText string
}

func hexOfSRGB(c srgb) string {
	b := func(v float64) int {
		n := int(v*255 + 0.5)
		if n < 0 {
			return 0
		}
		if n > 255 {
			return 255
		}
		return n
	}
	return fmt.Sprintf("#%02x%02x%02x", b(c[0]), b(c[1]), b(c[2]))
}

// tintOver is the accent mixed into the canvas at the strongest step (from
// start down to 0.10) whose ink still reads at 4.5:1; ok is false when no
// step does.
func tintOver(accent, canvas, ink srgb, start float64) (string, bool) {
	for t := start; t >= 0.10-1e-9; t -= 0.01 {
		c := mixRGB(accent, canvas, t)
		if contrast(ink, c) >= 4.5 {
			return hexOfSRGB(c), true
		}
	}
	return "", false
}

func highlightFor(p *palette) (pageHighlight, bool) {
	accent, ok1 := hexSRGB(p.get("accent"))
	canvas, ok2 := hexSRGB(p.get("background"))
	ink, ok3 := hexSRGB(p.get("foreground"))
	if !ok1 || !ok2 || !ok3 {
		return pageHighlight{}, false
	}
	var h pageHighlight
	// the solid selection takes the better end of the palette as its ink
	on := p.get("foreground")
	if contrast(canvas, accent) > contrast(ink, accent) {
		on = p.get("background")
	}
	onC, _ := hexSRGB(on)
	if contrast(onC, accent) >= 4.5 {
		h.selection, h.selectionText = p.get("accent"), on
	} else if tint, ok := tintOver(accent, canvas, ink, 0.45); ok {
		h.selection, h.selectionText = tint, p.get("foreground")
	} else {
		return pageHighlight{}, false
	}
	tint, ok := tintOver(accent, canvas, ink, 0.24)
	if !ok {
		return pageHighlight{}, false
	}
	h.mark, h.markText = tint, p.get("foreground")
	return h, true
}

// highlightVars are the content palette's Highlight/Mark variables, which
// live-palette.uc.js turns into the ui.* prefs on a theme switch.
func highlightVars(p *palette) string {
	h, ok := highlightFor(p)
	if !ok {
		return ""
	}
	return fmt.Sprintf(":root {\n  --omafire-highlight: %s;\n  --omafire-highlight-text: %s;\n  --omafire-mark: %s;\n  --omafire-mark-text: %s;\n}\n",
		h.selection, h.selectionText, h.mark, h.markText)
}

// highlightPrefs are the user.js lines for the same four colours.
func highlightPrefs(p *palette) string {
	h, ok := highlightFor(p)
	if !ok {
		return ""
	}
	return fmt.Sprintf("user_pref(\"ui.highlight\", \"%s\");\nuser_pref(\"ui.highlighttext\", \"%s\");\n"+
		"user_pref(\"ui.mark\", \"%s\");\nuser_pref(\"ui.marktext\", \"%s\");\n",
		h.selection, h.selectionText, h.mark, h.markText)
}
