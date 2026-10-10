package config

import "testing"

// A shortcut setting takes modifiers plus one key, or empty for none.
func TestChordCheck(t *testing.T) {
	s, ok := Lookup("key-zen")
	if !ok {
		t.Fatal("key-zen is not in the schema")
	}
	for _, good := range []string{"Ctrl+Alt+H", "alt+z", "Ctrl+Shift+7", "Super+Alt+K", ""} {
		if err := s.Check(good); err != nil {
			t.Errorf("%q: %v", good, err)
		}
	}
	for _, bad := range []any{"H", "Ctrl+", "Ctrl+Alt+Home", "Hyper+Z", "Ctrl+Alt+HH", true, 3.0} {
		if err := s.Check(bad); err == nil {
			t.Errorf("%v was accepted", bad)
		}
	}
	if v, err := s.Parse("Ctrl+Alt+Q"); err != nil || v != "Ctrl+Alt+Q" {
		t.Errorf("Parse = %v, %v", v, err)
	}
}

// A retired setting loads quietly and is gone from the next write.
func TestRetired(t *testing.T) {
	file, warnings, err := Decode([]byte(`{"zen-mode": true, "glass": true}`))
	if err != nil || len(warnings) != 0 {
		t.Fatalf("Decode: %v %v", warnings, err)
	}
	if _, ok := file["zen-mode"]; ok {
		t.Error("zen-mode kept")
	}
	if string(file.Encode()) == "" || file["glass"] != true {
		t.Errorf("glass lost: %s", file.Encode())
	}
}
