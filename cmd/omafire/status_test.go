package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestKeyConflictsMergesProfileReports(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(a, "omafire-keys.json"),
		[]byte(`{"conflicts":{"glass":{"chord":"Ctrl+Alt+G","owner":"key_x"}}}`), 0o600)
	os.WriteFile(filepath.Join(b, "omafire-keys.json"), []byte("not json"), 0o600)
	got := keyConflicts(
		browserState{Profiles: []profileState{{Path: a}}},
		browserState{Profiles: []profileState{{Path: b}, {Path: t.TempDir()}}})
	if len(got) != 1 || got["key-glass"] != (keyConflict{"Ctrl+Alt+G", "key_x"}) {
		t.Fatalf("got %v", got)
	}
}
