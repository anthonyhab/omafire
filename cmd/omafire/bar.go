package main

import (
	"math"
	"strconv"
	"strings"
)

// The Omarchy bar's cross size, which the chrome's rows and rail match
// (DEC-104). It mirrors the shell's Style.barToken: [bar] size-horizontal
// (top/bottom bars) or size-vertical (left/right), defaults 26 and 28, at
// [font] base-size 12, scaled with base-size unless [bar] scale-with-font
// is false, then rounded. The theme's shell.toml is the base and the
// user's ~/.config/omarchy/shell.toml overrides it, as in the shell.

// shellValues reads shell.toml's "section.key" values; later files win.
func shellValues(paths ...string) map[string]string {
	values := map[string]string{}
	for _, path := range paths {
		contents, ok := readFile(path)
		if !ok {
			continue
		}
		section := ""
		for _, line := range lines(contents) {
			line = cTrim(line)
			if strings.HasPrefix(line, "[") {
				section = strings.Trim(line, "[] \t")
				continue
			}
			key, value, found := strings.Cut(line, "=")
			if !found || section == "" {
				continue
			}
			value = cTrim(value)
			if i := strings.IndexByte(value, '#'); i >= 0 && !strings.HasPrefix(value, "\"") {
				value = cTrim(value[:i])
			}
			values[section+"."+cTrim(key)] = strings.Trim(value, `"'`)
		}
	}
	return values
}

// barSize is the bar's cross size in logical pixels.
func barSize(values map[string]string, vertical bool) float64 {
	key, size := "bar.size-horizontal", 26.0
	if vertical {
		key, size = "bar.size-vertical", 28.0
	}
	if n, err := strconv.ParseFloat(values[key], 64); err == nil && n > 0 {
		size = n
	}
	base := 12.0
	if n, err := strconv.Atoi(values["font.base-size"]); err == nil {
		base = float64(max(1, n))
	}
	switch strings.ToLower(values["bar.scale-with-font"]) {
	case "false", "0", "no", "off":
	default:
		size *= max(1.0/12, base/12)
	}
	return math.Max(1, math.Round(size))
}

// barVertical is whether the shell's bar sits on a side edge.
func barVertical(shellJSON string) bool {
	contents, ok := readFile(shellJSON)
	if !ok {
		return false
	}
	_, field, found := strings.Cut(contents, `"position"`)
	if !found {
		return false
	}
	_, field, _ = strings.Cut(field, `"`)
	return strings.HasPrefix(field, "left") || strings.HasPrefix(field, "right")
}

// textScale is GTK's text-scaling-factor, which Firefox multiplies into
// its device pixel ratio; 1 without gsettings.
func textScale() float64 {
	status, out := runCommand([]string{"gsettings", "get", "org.gnome.desktop.interface", "text-scaling-factor"}, true)
	if status != 0 {
		return 1
	}
	n, err := strconv.ParseFloat(cTrim(out), 64)
	if err != nil || n < 0.5 || n > 3 {
		return 1
	}
	return n
}

// barCSS is the bar's size in Firefox CSS pixels. A CSS pixel is
// monitor scale × text scale device pixels and the bar logical × monitor
// scale, so the scale cancels: one value fits every monitor.
func barCSS(logical, text float64) string {
	return strconv.FormatFloat(math.Round(logical/text*100)/100, 'f', -1, 64) + "px"
}
