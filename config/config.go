// Package config reads, validates and writes ~/.config/omafire/config.json
// against schema.json. The file holds only what the user set;
// Effective fills in the rest from the schema's defaults.
package config

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

//go:embed schema.json
var SchemaJSON []byte

// Setting is one entry of schema.json. Prefs are Firefox's business; the
// CLI only carries them through.
type Setting struct {
	Key     string   `json:"key"`
	About   string   `json:"about"`
	Type    string   `json:"type"`
	Values  []string `json:"values"`
	Min     *float64 `json:"min"`
	Max     *float64 `json:"max"`
	Default any      `json:"default"`
}

var schema = func() (schema struct {
	Retired  []string  `json:"retired"`
	Settings []Setting `json:"settings"`
}) {
	if err := json.Unmarshal(SchemaJSON, &schema); err != nil {
		panic("config: schema.json: " + err.Error())
	}
	return schema
}()

var Settings = schema.Settings

// Retired settings were removed on purpose (zen-mode, DEC-104): a file that
// still has one loads without a warning, and the next write drops it.
var Retired = schema.Retired

// Lookup returns the setting named key.
func Lookup(key string) (Setting, bool) {
	i := slices.IndexFunc(Settings, func(s Setting) bool { return s.Key == key })
	if i < 0 {
		return Setting{}, false
	}
	return Settings[i], true
}

// chordPattern is a shortcut: one or more modifiers, then one letter or digit.
var chordPattern = regexp.MustCompile(`(?i)^((ctrl|control|alt|shift|super|meta)\+)+[a-z0-9]$`)

// Check reports whether v, as decoded from JSON, is a valid value.
func (s Setting) Check(v any) error {
	switch s.Type {
	case "enum":
		if str, ok := v.(string); ok && slices.Contains(s.Values, str) {
			return nil
		}
		return fmt.Errorf("%s must be one of %s", s.Key, strings.Join(s.Values, ", "))
	case "bool":
		if _, ok := v.(bool); ok {
			return nil
		}
		return fmt.Errorf("%s must be true or false", s.Key)
	case "chord":
		if str, ok := v.(string); ok && (str == "" || chordPattern.MatchString(str)) {
			return nil
		}
		return fmt.Errorf("%s must be modifiers plus one key like Ctrl+Alt+Z, or empty", s.Key)
	case "number":
		n, ok := v.(float64)
		if ok && !math.IsNaN(n) && (s.Min == nil || n >= *s.Min) && (s.Max == nil || n <= *s.Max) {
			return nil
		}
		return fmt.Errorf("%s must be a number from %s to %s", s.Key, Format(*s.Min), Format(*s.Max))
	}
	return fmt.Errorf("%s: unknown type %q in the schema", s.Key, s.Type)
}

// Parse turns a command-line word into a value for s.
func (s Setting) Parse(word string) (any, error) {
	var v any = word
	switch s.Type {
	case "bool":
		switch word {
		case "true", "on", "yes", "1":
			v = true
		case "false", "off", "no", "0":
			v = false
		}
	case "number":
		if n, err := strconv.ParseFloat(word, 64); err == nil {
			v = n
		}
	}
	return v, s.Check(v)
}

// Format prints a value the way `omafire get` shows it.
func Format(v any) string {
	if n, ok := v.(float64); ok {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

// File is the decoded config file: the user's values by key, in no order.
type File map[string]any

// Decode reads a config file. Syntax errors fail; a known key with a bad
// value, or a key this version does not know, is a warning, and Effective
// treats it as unset. Unknown keys are kept, so an older CLI does not drop
// a newer one's settings.
func Decode(data []byte) (File, []string, error) {
	file := File{}
	if len(bytes.TrimSpace(data)) == 0 {
		return file, nil, nil
	}
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, nil, err
	}
	if file == nil {
		return nil, nil, fmt.Errorf("not a JSON object")
	}
	var warnings []string
	for key, v := range file {
		if slices.Contains(Retired, key) {
			delete(file, key)
			continue
		}
		s, ok := Lookup(key)
		if !ok {
			warnings = append(warnings, fmt.Sprintf("unknown setting %q, ignored", key))
		} else if err := s.Check(v); err != nil {
			warnings = append(warnings, err.Error()+", using the default")
		}
	}
	slices.Sort(warnings)
	return file, warnings, nil
}

// Effective returns every setting's value, from the file where it is set
// and valid, else the default.
func (f File) Effective() map[string]any {
	out := make(map[string]any, len(Settings))
	for _, s := range Settings {
		out[s.Key] = s.Default
		if v, ok := f[s.Key]; ok && s.Check(v) == nil {
			out[s.Key] = v
		}
	}
	return out
}

// Encode writes the file in schema order, unknown keys last, one key per
// line.
func (f File) Encode() []byte {
	var keys []string
	for _, s := range Settings {
		if _, ok := f[s.Key]; ok {
			keys = append(keys, s.Key)
		}
	}
	var extra []string
	for key := range f {
		if _, ok := Lookup(key); !ok {
			extra = append(extra, key)
		}
	}
	slices.Sort(extra)
	return encodeObject(f, append(keys, extra...))
}

// EncodeEffective is one line of `omafire watch` and `get --json`.
func EncodeEffective(values map[string]any) []byte {
	keys := make([]string, len(Settings))
	for i, s := range Settings {
		keys[i] = s.Key
	}
	var b bytes.Buffer
	b.WriteByte('{')
	for i, key := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(key)
		v, _ := json.Marshal(values[key])
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteString("}\n")
	return b.Bytes()
}

func encodeObject(values map[string]any, keys []string) []byte {
	var b bytes.Buffer
	if len(keys) == 0 {
		return []byte("{}\n")
	}
	b.WriteString("{\n")
	for i, key := range keys {
		k, _ := json.Marshal(key)
		v, _ := json.Marshal(values[key])
		fmt.Fprintf(&b, "  %s: %s", k, v)
		if i < len(keys)-1 {
			b.WriteByte(',')
		}
		b.WriteByte('\n')
	}
	b.WriteString("}\n")
	return b.Bytes()
}
