package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

const (
	protocol           = "omafox"
	protocolVersion    = 1
	action             = "theme-set"
	maxThemeNameLength = 100
)

// Palette key order is part of the JSON wire format.
var paletteKeys = []string{
	"mode",
	"accent", "selection", "muted",
	"background", "dark_background", "darker_background",
	"lighter_background",
	"foreground", "dark_foreground", "light_foreground",
	"bright_foreground",
	"red", "yellow", "orange", "green", "cyan", "blue", "magenta",
	"brown",
	"bright_red", "bright_yellow", "bright_green", "bright_cyan",
	"bright_blue", "bright_magenta",
}

// Every key after "mode".
var colorKeys = paletteKeys[1:]

type defaults struct{ bg, fg, accent, red, yellow, green, cyan, blue, magenta string }

var (
	darkDefaults  = defaults{"#1E1E2E", "#CDD6F4", "#89B4FA", "#F38BA8", "#F9E2AF", "#A6E3A1", "#94E2D5", "#89B4FA", "#CBA6F7"}
	lightDefaults = defaults{"#FFFFFF", "#181818", "#1565C0", "#C62828", "#8A6D00", "#2E7D32", "#007C91", "#1565C0", "#8E24AA"}
)

type palette struct {
	mode  string // "dark" or "light" once filled
	color map[string]string
	floor float64 // the glass floor, measured on first use (glassFloor)
}

func (p *palette) get(key string) string { return p.color[key] }

func (p *palette) has(key string) bool {
	_, ok := p.color[key]
	return ok
}

func isColorKey(key string) bool {
	for _, k := range colorKeys {
		if k == key {
			return true
		}
	}
	return false
}

func isHex(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'
}

func isColor(s string) bool {
	if len(s) != 7 || s[0] != '#' {
		return false
	}
	for i := 1; i < 7; i++ {
		if !isHex(s[i]) {
			return false
		}
	}
	return true
}

// normalizeColor turns #abc and 0xAABBCC into #AABBCC-style colors, keeping
// the digits' case; ok is false when the value is malformed.
func normalizeColor(in string) (string, bool) {
	switch {
	case len(in) == 7 && in[0] == '#':
		return in, isColor(in)
	case len(in) == 8 && strings.HasPrefix(in, "0x"):
		out := "#" + in[2:]
		return out, isColor(out)
	case len(in) == 4 && in[0] == '#':
		out := []byte{'#'}
		for i := 1; i < 4; i++ {
			if !isHex(in[i]) {
				return "", false
			}
			out = append(out, in[i], in[i])
		}
		return string(out), true
	}
	return "", false
}

func rgb(color string) (r, g, b int) {
	channel := func(i int) int {
		v, _ := strconv.ParseUint(color[i:i+2], 16, 8)
		return int(v)
	}
	return channel(1), channel(3), channel(5)
}

func mixColors(first, second string, pctSecond int) string {
	pctFirst := 100 - pctSecond
	fr, fg, fb := rgb(first)
	sr, sg, sb := rgb(second)
	return fmt.Sprintf("#%02X%02X%02X",
		(fr*pctFirst+sr*pctSecond)/100,
		(fg*pctFirst+sg*pctSecond)/100,
		(fb*pctFirst+sb*pctSecond)/100)
}

func inferMode(color string) string {
	r, g, b := rgb(color)
	if 299*r+587*g+114*b >= 145000 {
		return "light"
	}
	return "dark"
}

// setFrom fills target, unless set, from the first candidate that is a
// literal #color or a set palette key.
func (p *palette) setFrom(target string, candidates ...string) {
	if p.has(target) {
		return
	}
	for _, candidate := range candidates {
		if isColor(candidate) {
			p.color[target] = candidate
			return
		}
		if p.has(candidate) {
			p.color[target] = p.get(candidate)
			return
		}
	}
}

func (p *palette) setMixed(target, first, second string, pctSecond int) {
	if !p.has(target) {
		p.color[target] = mixColors(first, second, pctSecond)
	}
}

func (p *palette) deriveBright(target, source string) {
	if p.mode == "light" {
		p.setMixed(target, p.get(source), "#000000", 8)
	} else {
		p.setMixed(target, p.get(source), "#FFFFFF", 18)
	}
}

func (p *palette) fillFallbacks() {
	// Normalize common forms; malformed entries fall through to fallbacks.
	for key, value := range p.color {
		if normalized, ok := normalizeColor(value); ok {
			p.color[key] = normalized
		} else {
			delete(p.color, key)
		}
	}

	if p.mode != "dark" && p.mode != "light" {
		p.mode = "dark"
		for _, sample := range []string{"background", "dark_background", "darker_background", "lighter_background"} {
			if p.has(sample) {
				p.mode = inferMode(p.get(sample))
				break
			}
		}
	}

	d := darkDefaults
	if p.mode == "light" {
		d = lightDefaults
	}

	p.setFrom("background", "dark_background", "darker_background", "lighter_background", d.bg)
	p.setFrom("foreground", "light_foreground", "bright_foreground", "dark_foreground", d.fg)
	p.setFrom("accent", "blue", "bright_blue", "cyan", "bright_cyan", "magenta", "bright_magenta", d.accent)

	p.setMixed("selection", p.get("background"), p.get("accent"), 25)
	p.setMixed("muted", p.get("foreground"), p.get("background"), 55)
	p.setMixed("dark_background", p.get("background"), "#000000", 4)
	p.setMixed("darker_background", p.get("background"), "#000000", 10)
	if p.mode == "light" {
		p.setMixed("lighter_background", p.get("background"), "#000000", 10)
	} else {
		p.setMixed("lighter_background", p.get("background"), "#FFFFFF", 10)
	}

	p.setFrom("dark_foreground", "muted", "foreground")
	p.setFrom("light_foreground", "foreground")
	if p.mode == "light" {
		p.setFrom("bright_foreground", "foreground")
	} else {
		p.setMixed("bright_foreground", p.get("foreground"), "#FFFFFF", 12)
	}

	p.setFrom("red", "bright_red", d.red)
	p.setFrom("yellow", "bright_yellow", d.yellow)
	p.setFrom("green", "bright_green", d.green)
	p.setFrom("cyan", "bright_cyan", d.cyan)
	p.setFrom("blue", "bright_blue", "accent", d.blue)
	p.setFrom("magenta", "bright_magenta", d.magenta)
	p.setFrom("orange", "yellow", "accent", "#B56A32")
	p.setFrom("brown", "muted", "#795548")

	for _, color := range []string{"red", "yellow", "green", "cyan", "blue", "magenta"} {
		p.deriveBright("bright_"+color, color)
	}
}

// readPalette reads the current theme's colors.toml: `key = value` lines,
// the value quoted or bare up to a space or a # comment.
func readPalette() *palette {
	contents, ok := readFile(themeDir + "/colors.toml")
	if !ok {
		fail("could not read Quattro palette: %s/colors.toml", themeDir)
	}
	p := &palette{color: map[string]string{}}
	for _, line := range lines(contents) {
		rawKey, rawValue, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key, value := cTrim(rawKey), cTrim(rawValue)
		if key == "" || strings.Trim(key, "abcdefghijklmnopqrstuvwxyz_") != "" {
			continue
		}
		var parsed string
		if value != "" && (value[0] == '"' || value[0] == '\'') {
			parsed = value[1:]
			if end := strings.IndexByte(parsed, value[0]); end >= 0 {
				parsed = parsed[:end]
			}
		} else {
			end := strings.IndexAny(value, " \t\n\v\f\r#")
			if end < 0 {
				end = len(value)
			}
			parsed = value[:end]
		}
		if key == "mode" {
			// Kept raw (at most five bytes); fillFallbacks infers the mode
			// from the palette when it is not dark or light.
			p.mode = parsed[:min(len(parsed), 5)]
		} else if isColorKey(key) {
			p.color[key] = parsed
		}
	}
	p.fillFallbacks()
	return p
}

func requireQuattro() {
	// The theme-set hook proves Omarchy is installed by existing; skipping
	// the `omarchy version` subprocess there keeps fork+exec off the sync path.
	if _, skip := os.LookupEnv("OMAFIRE_SKIP_VERSION_CHECK"); !skip {
		status, out := runCommand([]string{"omarchy", "version"}, true)
		if status != 0 {
			fail("Omarchy is not installed")
		}
		// Development builds report "dev (<sha>)" and are newer than Quattro.
		if !strings.HasPrefix(out, "dev") {
			if major, _ := leadingInt(out); major < 4 {
				fail("Omarchy Quattro (version 4) or newer is required")
			}
		}
	}
	if !isRegularFile(themeDir + "/colors.toml") {
		fail("Quattro palette not found: %s/colors.toml", themeDir)
	}
}

func jsonEscape(input string) string {
	var out strings.Builder
	for i := 0; i < len(input); i++ {
		switch c := input[i]; {
		case c == '"':
			out.WriteString(`\"`)
		case c == '\\':
			out.WriteString(`\\`)
		case c < 0x20 || c == 0x7f:
			fmt.Fprintf(&out, `\u%04X`, c)
		default:
			out.WriteByte(c)
		}
	}
	return out.String()
}

func currentThemeName() string {
	name := ""
	if contents, ok := readFile(themeNameFile); ok {
		name = firstLine(contents)
	}
	if name == "" {
		name = "omarchy"
	}
	if len(name) > maxThemeNameLength {
		fail("theme name exceeds %d characters", maxThemeNameLength)
	}
	return name
}

func formatPayload(p *palette, escapedTheme string) string {
	var out strings.Builder
	fmt.Fprintf(&out, `{"protocol":"%s","version":%d,"action":"%s","theme":"%s","palette":{"mode":"%s"`,
		protocol, protocolVersion, action, escapedTheme, p.mode)
	for _, key := range colorKeys {
		fmt.Fprintf(&out, `,"%s":"%s"`, key, p.get(key))
	}
	out.WriteString("}}\n")
	return out.String()
}

func storeThemePayload(payload string) {
	mkdirP700(stateDir)
	atomicWrite(stateFile, payload, 0o600, false)
}
