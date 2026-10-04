package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// restore puts back what a run changed, but never over an edit made since
// (omafire-6ty).
func TestRestoreKeepsLaterEdits(t *testing.T) {
	state, prof := t.TempDir(), t.TempDir()
	oldState, oldCmd, oldDir, oldBacked := stateDir, backupCommand, backupDir, backedUp
	defer func() { stateDir, backupCommand, backupDir, backedUp = oldState, oldCmd, oldDir, oldBacked }()
	stateDir, backupCommand, backupDir, backedUp = state, "setup", "", map[string]bool{}

	untouched, edited := prof+"/user.js", prof+"/userChrome.css"
	for path, text := range map[string]string{untouched: "// mine\n", edited: "/* mine */\n"} {
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
		atomicWrite(path, text+"/* omafire */\n", 0o600, true) // the run's change, backed up first
	}
	recordWrote()
	set := filepath.Base(backupDir)
	if err := os.WriteFile(edited, []byte("/* mine */\n/* omafire */\n/* later edit */\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	backupCommand, backupDir, backedUp = "restore", "", map[string]bool{}
	res, err := restoreSet(state + "/backups/" + set)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.restored) != 1 || res.restored[0] != untouched || len(res.kept) != 1 || res.kept[0] != edited {
		t.Fatalf("restored=%v kept=%v", res.restored, res.kept)
	}
	if got, _ := os.ReadFile(untouched); string(got) != "// mine\n" {
		t.Errorf("user.js not restored: %q", got)
	}
	if got, _ := os.ReadFile(edited); !strings.Contains(string(got), "later edit") {
		t.Errorf("a later edit was overwritten: %q", got)
	}
	if backupDir == "" {
		t.Error("restore did not back up what it replaced")
	}
}

func TestRestoreNeedsTheRunRecord(t *testing.T) {
	dir := t.TempDir()
	if _, err := restoreSet(dir); err == nil || !strings.Contains(err.Error(), "predates") {
		t.Errorf("err = %v", err)
	}
}
