package main

// omafire status, as text or (--json) for the Omarchy shell plugin.

import (
	"encoding/json"
	"fmt"
	"os"
)

type profileState struct {
	Path   string `json:"path"`
	Status string `json:"status"`
	OK     bool   `json:"ok"`
}

type browserState struct {
	ProfilesFile string         `json:"profilesFile"`
	Detected     bool           `json:"detected"`
	Profiles     []profileState `json:"profiles"`
}

type fileState struct {
	Path    string `json:"path"`
	Present bool   `json:"present"`
}

type statusReport struct {
	Version     string       `json:"version"`
	Theme       string       `json:"theme"`
	Palette     string       `json:"palette"`
	Hook        fileState    `json:"hook"`
	ThemeState  fileState    `json:"themeState"`
	Settings    settingsInfo `json:"settings"`
	ShellPlugin fileState    `json:"shellPlugin"`
	Firefox     browserState `json:"firefox"`
	// Chords the browser already uses, as keys.uc.js last reported them from a
	// running window: setting name ("key-glass") -> chord and owner.
	KeyConflicts map[string]keyConflict `json:"keyConflicts"`
	// The opacity below which glass is raised to stay readable, as the last
	// sync measured it (theme.json); absent before one.
	GlassFloor float64 `json:"glassFloor,omitempty"`
}

func syncedGlassFloor() float64 {
	var state struct {
		GlassFloor float64 `json:"glassFloor"`
	}
	if data, err := os.ReadFile(stateFile); err == nil {
		json.Unmarshal(data, &state)
	}
	return state.GlassFloor
}

type keyConflict struct {
	Chord string `json:"chord"`
	Owner string `json:"owner"`
}

// keyConflicts merges omafire-keys.json from the browsers' profiles.
func keyConflicts(browsers ...browserState) map[string]keyConflict {
	out := map[string]keyConflict{}
	for _, b := range browsers {
		for _, p := range b.Profiles {
			data, ok := readFile(p.Path + "/omafire-keys.json")
			if !ok {
				continue
			}
			var report struct {
				Conflicts map[string]keyConflict `json:"conflicts"`
			}
			if json.Unmarshal([]byte(data), &report) != nil {
				continue
			}
			for name, c := range report.Conflicts {
				if c.Chord != "" {
					out["key-"+name] = c
				}
			}
		}
	}
	return out
}

type settingsInfo struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

// Statuses that need nothing from the user.
var profileOK = map[string]bool{"configured": true, "theme checkout": true}

func browserStatus(profilesFile, root string, status func(string) string) browserState {
	b := browserState{ProfilesFile: profilesFile, Profiles: []profileState{}}
	if !isRegularFile(profilesFile) {
		return b
	}
	b.Detected = true
	for _, profile := range listProfiles(profilesFile, root) {
		st := "missing"
		if isDir(profile) {
			st = status(profile)
		}
		b.Profiles = append(b.Profiles, profileState{profile, st, profileOK[st]})
	}
	return b
}

func collectStatus() statusReport {
	name := "unknown"
	if contents, ok := readFile(themeNameFile); ok {
		name = firstLine(contents)
	}
	ff := browserStatus(ffProfilesFile, ffRoot, ffProfileStatus)
	return statusReport{
		Version:      version,
		Theme:        name,
		Palette:      themeDir + "/colors.toml",
		Hook:         fileState{hookPath, pathExists(hookPath)},
		ThemeState:   fileState{stateFile, isRegularFile(stateFile)},
		Settings:     settingsInfo{configFile, configStatus()},
		ShellPlugin:  fileState{shellPluginLink, shellPluginLinked()},
		Firefox:      ff,
		KeyConflicts: keyConflicts(ff),
		GlassFloor:   syncedGlassFloor(),
	}
}

func printBrowserStatus(label string, b browserState) {
	switch {
	case !b.Detected:
		fmt.Printf("%s profiles: not detected (%s)\n", label, b.ProfilesFile)
	case len(b.Profiles) == 0:
		fmt.Printf("%s profiles: none listed in %s\n", label, b.ProfilesFile)
	}
	for _, p := range b.Profiles {
		fmt.Printf("%s profile: %s (%s)\n", label, p.Path, p.Status)
	}
}

func showStatus(args []string) {
	asJSON := len(args) == 1 && args[0] == "--json"
	if len(args) > 0 && !asJSON {
		fail("usage: omafire status [--json]")
	}
	r := collectStatus()
	if asJSON {
		data, _ := json.Marshal(r)
		os.Stdout.Write(append(data, '\n'))
		return
	}
	ready := map[bool]string{true: "ready", false: "missing"}
	fmt.Printf("Omafire version: %s\n", r.Version)
	fmt.Printf("Theme: %s\n", r.Theme)
	fmt.Printf("Palette: %s\n", r.Palette)
	fmt.Printf("Hook: %s\n", r.Hook.Path)
	fmt.Printf("Theme state: %s (%s)\n", r.ThemeState.Path, ready[r.ThemeState.Present])
	fmt.Printf("Settings: %s (%s)\n", r.Settings.Path, r.Settings.Status)
	fmt.Printf("Shell plugin: %s (%s)\n", r.ShellPlugin.Path, map[bool]string{true: "linked", false: "not linked"}[r.ShellPlugin.Present])
	printBrowserStatus("Firefox", r.Firefox)
}
