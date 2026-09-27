package main

// omafire status, as text or (--json) for the Omarchy shell plugin.

import (
	"encoding/json"
	"fmt"
	"os"

	"golang.org/x/sys/unix"
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
	Version        string       `json:"version"`
	Theme          string       `json:"theme"`
	Palette        string       `json:"palette"`
	Hook           fileState    `json:"hook"`
	ThemeState     fileState    `json:"themeState"`
	NativeHost     fileState    `json:"nativeHost"`
	NativeManifest fileState    `json:"nativeManifest"`
	Settings       settingsInfo `json:"settings"`
	Zen            browserState `json:"zen"`
	Firefox        browserState `json:"firefox"`
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
	return statusReport{
		Version:        version,
		Theme:          name,
		Palette:        themeDir + "/colors.toml",
		Hook:           fileState{hookPath, pathExists(hookPath)},
		ThemeState:     fileState{stateFile, isRegularFile(stateFile)},
		NativeHost:     fileState{nativeHostPath, unix.Access(nativeHostPath, unix.X_OK) == nil},
		NativeManifest: fileState{nativeManifestPath, isRegularFile(nativeManifestPath)},
		Settings:       settingsInfo{configFile, configStatus()},
		Zen:            browserStatus(zenProfilesFile, zenRoot, zenProfileStatus),
		Firefox:        browserStatus(ffProfilesFile, ffRoot, ffProfileStatus),
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
	installed := map[bool]string{true: "installed", false: "missing"}
	fmt.Printf("Omafire version: %s\n", r.Version)
	fmt.Printf("Theme: %s\n", r.Theme)
	fmt.Printf("Palette: %s\n", r.Palette)
	fmt.Printf("Hook: %s\n", r.Hook.Path)
	fmt.Printf("Theme state: %s (%s)\n", r.ThemeState.Path, ready[r.ThemeState.Present])
	fmt.Printf("Native host: %s (%s)\n", r.NativeHost.Path, installed[r.NativeHost.Present])
	fmt.Printf("Native manifest: %s (%s)\n", r.NativeManifest.Path, installed[r.NativeManifest.Present])
	fmt.Printf("Settings: %s (%s)\n", r.Settings.Path, r.Settings.Status)
	printBrowserStatus("Zen", r.Zen)
	printBrowserStatus("Firefox", r.Firefox)
}
