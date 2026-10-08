package main

import (
	"fmt"
	"strings"
)

// The Firefox theme variables, from the palette: what a lightweight theme
// would set (Firefox's toolkitVariableMap and ThemeVariableMap), written
// into omafire-palette.css so the chrome needs no add-on. Text colours are
// the first candidate that holds 4.5:1 on its background; button fills the
// first that holds 4.5:1 under the toolbar text, popup rows 3:1.

const (
	minTextContrast = 4.5
	minIconContrast = 3
)

func contrastHex(a, b string) float64 {
	ca, okA := hexSRGB(a)
	cb, okB := hexSRGB(b)
	if !okA || !okB {
		return 0
	}
	return contrast(ca, cb)
}

// readableText is the first of candidates that reads on bg, else black or
// white, whichever reads better.
func readableText(bg string, candidates ...string) string {
	for _, c := range candidates {
		if contrastHex(bg, c) >= minTextContrast {
			return c
		}
	}
	if contrastHex(bg, "#000000") >= contrastHex(bg, "#ffffff") {
		return "#000000"
	}
	return "#ffffff"
}

// readableFill is the first of candidates under which every fg holds min,
// else the candidate (or black or white) under which the weakest fg holds
// best.
func readableFill(fgs []string, min float64, candidates ...string) string {
	weakest := func(bg string) float64 {
		w := 99.0
		for _, fg := range fgs {
			w = min2(w, contrastHex(bg, fg))
		}
		return w
	}
	for _, c := range candidates {
		if weakest(c) >= min {
			return c
		}
	}
	best := candidates[0]
	for _, c := range append(candidates[1:], "#000000", "#ffffff") {
		if weakest(c) > weakest(best) {
			best = c
		}
	}
	return best
}

func min2(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// firefoxThemeVars is the ordered variable -> colour list.
func firefoxThemeVars(p *palette) [][2]string {
	c := p.get
	alts := []string{c("light_foreground"), c("bright_foreground"), c("dark_foreground"),
		c("background"), c("darker_background"), c("lighter_background")}
	text := func(bg, preferred string, more ...string) string {
		if more == nil {
			more = alts
		}
		return readableText(bg, append([]string{preferred}, more...)...)
	}
	toolbarText := text(c("dark_background"), c("foreground"))
	tabText := text(c("background"), c("foreground"))
	selectedTabText := text(c("lighter_background"), c("bright_foreground"),
		c("foreground"), c("light_foreground"), c("dark_foreground"),
		c("background"), c("dark_background"), c("darker_background"))
	inkAlts := []string{c("foreground"), c("light_foreground"), c("dark_foreground"),
		c("background"), c("dark_background"), c("darker_background"), c("lighter_background")}
	highlightText := text(c("selection"), c("bright_foreground"), inkAlts...)
	hover := readableFill([]string{toolbarText}, minTextContrast, c("lighter_background"),
		c("accent"), c("selection"), c("muted"), c("dark_background"), c("background"), c("darker_background"))
	active := readableFill([]string{toolbarText}, minTextContrast, c("selection"),
		c("accent"), c("muted"), c("lighter_background"), c("dark_background"), c("background"), c("darker_background"))
	row := readableFill([]string{c("foreground")}, minIconContrast, c("selection"),
		c("accent"), c("muted"), c("lighter_background"), c("dark_background"), c("background"), c("darker_background"))
	rowText := text(row, c("bright_foreground"), inkAlts...)

	return [][2]string{
		{"--lwt-accent-color", c("background")},
		{"--lwt-accent-color-inactive", c("dark_background")},
		{"--lwt-text-color", tabText},
		{"--tab-text-color-selected", selectedTabText},
		{"--tab-background-color-selected", c("lighter_background")},
		{"--lwt-tab-line-color", c("accent")},
		{"--tab-loading-fill", c("accent")},
		{"--toolbar-background-color", c("dark_background")},
		{"--toolbar-text-color", toolbarText},
		{"--toolbar-field-background-color", c("darker_background")},
		{"--toolbar-field-text-color", text(c("darker_background"), c("light_foreground"))},
		{"--toolbar-field-background-color-focus", c("background")},
		{"--toolbar-field-text-color-focus", text(c("background"), c("bright_foreground"))},
		{"--toolbar-field-border-color", c("muted")},
		{"--toolbar-field-border-color-focus", c("bright_blue")},
		{"--lwt-toolbar-field-highlight", c("selection")},
		{"--lwt-toolbar-field-highlight-text", highlightText},
		{"--toolbarbutton-background-color-hover", hover},
		{"--toolbarbutton-background-color-active", active},
		{"--toolbarbutton-icon-fill", c("light_foreground")},
		{"--toolbarbutton-icon-fill-attention", c("bright_yellow")},
		{"--panel-background-color", c("dark_background")},
		{"--panel-text-color", toolbarText},
		{"--panel-border-color", c("muted")},
		{"--urlbarview-background-color-selected", row},
		{"--urlbarview-text-color-selected", rowText},
		{"--sidebar-background-color", c("dark_background")},
		{"--sidebar-text-color", toolbarText},
		{"--sidebar-border-color", c("muted")},
		{"--tabpanel-background-color", c("background")},
		{"--tabs-navbar-separator-color", c("muted")},
		{"--chrome-content-separator-color", c("brown")},
		{"--toolbarseparator-color", c("muted")},
	}
}

// firefoxThemeCSS is the :root block of those variables. Each value is a
// plain --omafire-ff-* variable that the Firefox one reads with !important:
// the palette is user origin and Firefox's defaults author origin, and the
// theme's own rules come later and still win. live-palette.uc.js replaces
// only the plain values on a theme switch; an !important copy of the Firefox
// variable itself would lose to this file.
func firefoxThemeCSS(p *palette) string {
	vars := firefoxThemeVars(p)
	var out strings.Builder
	out.WriteString(":root {\n")
	fmt.Fprintf(&out, "  --omafire-ff-color-scheme: %s;\n", p.mode)
	for _, v := range vars {
		fmt.Fprintf(&out, "  --omafire-ff-%s: %s;\n", v[0][2:], v[1])
	}
	out.WriteString("  color-scheme: var(--omafire-ff-color-scheme) !important;\n")
	for _, v := range vars {
		fmt.Fprintf(&out, "  %s: var(--omafire-ff-%s) !important;\n", v[0], v[0][2:])
	}
	out.WriteString("}\n")
	return out.String()
}
