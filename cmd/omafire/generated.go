package main

import (
	"fmt"
	"os"
	"strings"
)

// rawPaletteVars renders every palette color as --omarchy-<key>. The theme
// reads these only where the lightweight theme has no equivalent (tab-group
// swatches, about: pages); live chrome colors come from the extension.
// The glass floor (DEC-66) rides along: chrome and glass pages both clamp
// their alpha to it.
func rawPaletteVars(p *palette) string {
	var out strings.Builder
	out.WriteString(":root {\n")
	for _, key := range colorKeys {
		fmt.Fprintf(&out, "  --omarchy-%s: %s;\n", key, p.get(key))
	}
	if p.floor == 0 {
		p.floor = glassFloor(p)
	}
	fmt.Fprintf(&out, "  --omafire-glass-floor: %.2f;\n", p.floor)
	out.WriteString("}\n")
	return out.String()
}

// writePaletteCSS writes the chrome palette. Besides the raw keys, it
// mirrors the Firefox theme variables the extension's lightweight theme
// sets, under :root:not([lwtheme]), so the first painted frame already uses
// the current palette; the block goes inert the moment the extension's
// theme lands and owns the same variables live. !important is required:
// userChrome is user origin and Firefox's own defaults are author origin.
func writePaletteCSS(p *palette, path string) {
	css := "/* OMAFIRE GENERATED PALETTE — written by omafire sync; do not edit. */\n" +
		rawPaletteVars(p) + "\n" +
		":root:not([lwtheme]) {\n" +
		"  color-scheme: " + p.mode + " !important;\n" +
		"  --toolbar-background-color: " + p.get("dark_background") + " !important;\n" +
		"  --toolbar-text-color: " + p.get("foreground") + " !important;\n" +
		"  --toolbar-field-background-color: " + p.get("darker_background") + " !important;\n" +
		"  --toolbar-field-text-color: " + p.get("light_foreground") + " !important;\n" +
		"  --toolbar-field-border-color-focus: " + p.get("bright_blue") + " !important;\n" +
		"  --lwt-tab-line-color: " + p.get("accent") + " !important;\n" +
		"  --tabpanel-background-color: " + p.get("background") + " !important;\n" +
		"}\n"
	atomicWrite(path, css, 0o600, false)
}

// writeContentPaletteCSS writes the palette for userContent.css: the raw
// keys and the palette mode, never a color-scheme property, so importing it
// cannot restyle websites.
func writeContentPaletteCSS(p *palette, path string) {
	css := "/* OMAFIRE GENERATED CONTENT PALETTE — written by omafire sync; do not edit. */\n" +
		":root {\n  --omarchy-color-scheme: " + p.mode + ";\n}\n\n" +
		rawPaletteVars(p) + highlightVars(p)
	atomicWrite(path, css, 0o600, false)
}

// hyprOption is a `hyprctl getoption -j` reply; ok is false without
// Hyprland (a TTY, a test sandbox).
func hyprOption(option string) (string, bool) {
	status, out := runCommand([]string{"hyprctl", "getoption", option, "-j"}, true)
	return out, status == 0
}

// hyprInt is the reply's "int" field, within [0, max].
func hyprInt(option string, max int64) (int64, bool) {
	out, ok := hyprOption(option)
	if !ok {
		return 0, false
	}
	_, field, found := strings.Cut(out, `"int"`)
	if !found {
		return 0, false
	}
	_, field, found = strings.Cut(field, ":")
	if !found {
		return 0, false
	}
	value, digits := leadingInt(field)
	if !digits || value < 0 || value > max {
		return 0, false
	}
	return value, true
}

// hyprBorderColor is a border option's first color as CSS #RRGGBBAA.
// Hyprland serialises gradients as "AARRGGBB AARRGGBB ... <angle>deg" under
// "gradient" (older releases: "str").
func hyprBorderColor(option string) (string, bool) {
	out, ok := hyprOption(option)
	if !ok {
		return "", false
	}
	_, field, found := strings.Cut(out, `"gradient"`)
	if !found {
		_, field, found = strings.Cut(out, `"str"`)
	}
	if found {
		_, field, found = strings.Cut(field, ":")
	}
	if found {
		_, field, found = strings.Cut(field, `"`)
	}
	if !found {
		return "", false
	}
	if strings.HasPrefix(field, "0x") || strings.HasPrefix(field, "0X") {
		field = field[2:]
	}
	if len(field) < 8 {
		return "", false
	}
	for i := 0; i < 8; i++ {
		if !isHex(field[i]) {
			return "", false
		}
	}
	if len(field) > 8 && isHex(field[8]) {
		return "", false
	}
	return "#" + field[2:8] + field[0:2], true
}

// nativeAccent is the #RRGGBB native widgets (checkboxes, `outline: auto`
// focus rings) paint with: Hyprland's active border, like the theme's focus
// color, else the palette accent.
func nativeAccent(p *palette) string {
	if border, ok := hyprBorderColor("general:col.active_border"); ok {
		return border[:7]
	}
	return p.get("accent")
}

// textOn is readable text on hex (#RRGGBB): the darker or lighter palette end.
func textOn(p *palette, hex string) string {
	if !isColor(hex) {
		return p.get("foreground")
	}
	r, g, b := rgb(hex)
	// Explicit conversions keep each product rounded on its own (no fused
	// multiply-add), as in the C this replaced.
	luma := (float64(0.2126*float64(r)) + float64(0.7152*float64(g)) + float64(0.0722*float64(b))) / 255.0
	if p.mode == "dark" {
		if luma > 0.5 {
			return p.get("darker_background")
		}
		return p.get("bright_foreground")
	}
	if luma > 0.5 {
		return p.get("foreground")
	}
	return p.get("background")
}

// writeRadiusCSS writes Hyprland's window geometry for the theme: the chrome
// rounds its cards like the desktop rounds windows. Left untouched when
// hyprctl is unavailable, so a sync outside Hyprland keeps the last good
// values.
func writeRadiusCSS(path string) {
	rounding, ok := hyprInt("decoration:rounding", 64)
	if !ok {
		return
	}
	borders := ""
	if size, ok := hyprInt("general:border_size", 32); ok {
		if active, ok := hyprBorderColor("general:col.active_border"); ok {
			if inactive, ok := hyprBorderColor("general:col.inactive_border"); ok {
				borders = fmt.Sprintf("  --omarchy-border-width: %dpx;\n"+
					"  --omarchy-border-active-color: %s;\n"+
					"  --omarchy-border-inactive-color: %s;\n", size, active, inactive)
			}
		}
	}
	css := fmt.Sprintf("%s\n:root {\n  --omafire-radius-container: %dpx;\n%s}\n",
		ffRadiusMarker, rounding, borders)
	atomicWrite(path, css, 0o600, false)
}

// refreshFFProfileColors rewrites the dynamic prefs inside the Firefox
// managed block, so pages report the palette mode and the pre-CSS canvas
// starts dark or light, and the generated palette and geometry files.
func refreshFFProfileColors(profile string, p *palette) {
	f := ffPaths(profile)
	var bridged bool
	if ffChromeIsCheckout(f.chrome) {
		bridged = managedBlockPresent(f.userPrefs, ffPrefsBegin, ffPrefsEnd) ||
			managedBlockPresent(f.userChrome, ffCSSBegin, ffCSSEnd)
	} else {
		bridged = managedBlockPresent(f.userChrome, ffCSSBegin, ffCSSEnd)
	}
	if !bridged {
		return
	}

	// content-override: 0=dark, 1=light: pages with native dark CSS render
	// correctly before any content-script theme engine wakes up.
	override := 0
	if p.mode == "light" {
		override = 1
	}
	accent := nativeAccent(p)
	block := ffPrefsBegin + "\n" +
		"user_pref(\"toolkit.legacyUserProfileCustomizations.stylesheets\", true);\n" +
		"user_pref(\"svg.context-properties.content.enabled\", true);\n" +
		"user_pref(\"browser.theme.dark-private-windows\", false);\n" +
		// Lets the new tab's Desktop background show the window surface;
		// pages that paint no background fall back to the theme's canvas,
		// which matches browser.display.background_color below.
		"user_pref(\"browser.tabs.allow_transparent_browser\", true);\n" +
		// Hyprland skips its blur wherever the window claims to be opaque,
		// and Firefox only refreshes that claim on some repaints: chrome that
		// moves the page (the theme's zen row slides it down) leaves the
		// glass above it unblurred until the next tab switch. Never claim
		// opacity; the whole window is glass under omarchy anyway.
		"user_pref(\"widget.wayland.opaque-region.enabled\", false);\n" +
		// Marks the profile as omafire's: the package's chrome script loader
		// (omafire.cfg) runs only where this is set, and the user's own
		// omafire.scripts switch, never written here, stays theirs.
		"user_pref(\"omafire.managed\", true);\n" +
		"user_pref(\"browser.nova.enabled\", true);\n" +
		"user_pref(\"browser.newtabpage.activity-stream.nova.enabled\", true);\n" +
		"user_pref(\"widget.gtk.rounded-bottom-corners.enabled\", true);\n" +
		// A dragged tab's "drop here to pin" zone opens after 500ms by
		// default, long enough to read as missing: open it sooner.
		"user_pref(\"browser.tabs.dragDrop.pinInteractionCue.delayMS\", 150);\n" +
		fmt.Sprintf("user_pref(\"layout.css.prefers-color-scheme.content-override\", %d);\n", override) +
		fmt.Sprintf("user_pref(\"browser.display.background_color\", \"%s\");\n", p.get("background")) +
		fmt.Sprintf("user_pref(\"browser.display.foreground_color\", \"%s\");\n", p.get("foreground")) +
		// Forced colours (Firefox's colour override, which Cinder builds on)
		// paint every page from these and the two above: links would keep
		// Firefox's #0000ee otherwise. live-palette.uc.js follows theme
		// switches.
		"user_pref(\"browser.display.use_system_colors\", false);\n" +
		fmt.Sprintf("user_pref(\"browser.anchor_color\", \"%s\");\n", p.get("accent")) +
		fmt.Sprintf("user_pref(\"browser.visited_color\", \"%s\");\n", p.get("magenta")) +
		// Forced colours draw a Canvas plate behind every text run, which
		// would box the text on Cinder's surface steps and on glass pages.
		"user_pref(\"browser.display.permit_backplate\", false);\n" +
		// Selection and search hits on forced-colour pages: the theme's
		// accent, not the system's blue and Mark yellow (highlight.go).
		highlightPrefs(p) +
		fmt.Sprintf("user_pref(\"ui.accentcolor\", \"%s\");\n", accent) +
		fmt.Sprintf("user_pref(\"ui.accentcolortext\", \"%s\");\n", textOn(p, accent)) +
		ffPrefsEnd + "\n"
	installManagedBlock(f.userPrefs, ffPrefsBegin, ffPrefsEnd, block, false, "Firefox profile file")

	writePaletteCSS(p, f.chrome+"/"+ffPaletteName)
	writeContentPaletteCSS(p, f.chrome+"/"+ffContentPaletteName)
	writeRadiusCSS(f.chrome + "/" + ffRadiusName)
	cleanLegacyGenerated(f.chrome, false)
}

// A profile that refuses (malformed markers, a symlinked file) is skipped
// with a line on stderr and counted; the others still follow the palette.
func refreshFFProfilesColors(p *palette) (skipped int) {
	if !isRegularFile(ffProfilesFile) {
		return 0
	}
	for _, profile := range listProfiles(ffProfilesFile, ffRoot) {
		if !profileWritable(profile, "Firefox", false) {
			continue
		}
		if msg := guard(func() { refreshFFProfileColors(profile, p) }); msg != "" {
			fmt.Fprintf(os.Stderr, programName+": skipped Firefox profile %s: %s\n", profile, msg)
			skipped++
		}
	}
	return skipped
}
