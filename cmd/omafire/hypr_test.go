package main

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeHyprland serves Hyprland's control socket under a fresh runtime dir,
// answering each getoption from replies, and points themeDir at an empty
// theme. It returns the request counter.
func fakeHyprland(t *testing.T, replies map[string]string) *atomic.Int32 {
	t.Helper()
	runtime, err := os.MkdirTemp("/tmp", "omafire-hypr-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(runtime) })
	dir := filepath.Join(runtime, "hypr", "test")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", filepath.Join(dir, ".socket.sock"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	t.Setenv("XDG_RUNTIME_DIR", runtime)
	t.Setenv("HYPRLAND_INSTANCE_SIGNATURE", "test")
	// No hyprctl: a request that misses the socket must fail, not reach
	// the real compositor.
	t.Setenv("PATH", t.TempDir())
	saved := themeDir
	themeDir = t.TempDir()
	t.Cleanup(func() { themeDir = saved })
	hyprReset()
	t.Cleanup(hyprReset)

	requests := new(atomic.Int32)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				buf := make([]byte, 512)
				n, _ := conn.Read(buf)
				requests.Add(1)
				option := strings.TrimPrefix(string(buf[:n]), "j/getoption ")
				if reply, ok := replies[option]; ok {
					conn.Write([]byte(reply))
				} else {
					conn.Write([]byte("no such option"))
				}
			}()
		}
	}()
	return requests
}

func TestHyprOptionAsksTheSocketOncePerOption(t *testing.T) {
	requests := fakeHyprland(t, map[string]string{
		"general:col.active_border": `{"option":"general:col.active_border","gradient":"ffe68e0d 0deg","set":true}`,
		"decoration:rounding":       `{"option":"decoration:rounding","int":9,"set":true}`,
	})

	for i := 0; i < 3; i++ {
		if got, ok := hyprBorderColor("general:col.active_border"); !ok || got != "#e68e0dff" {
			t.Fatalf("active border = %q, %v", got, ok)
		}
	}
	if got, ok := hyprInt("decoration:rounding", 64); !ok || got != 9 {
		t.Fatalf("rounding = %d, %v", got, ok)
	}
	hyprInt("general:border_size", 32)
	if n := requests.Load(); n != int32(len(hyprOptions)) {
		t.Fatalf("socket requests = %d, want one per option (%d)", n, len(hyprOptions))
	}
}

func TestHyprOptionErrorReplyIsNotAnOption(t *testing.T) {
	fakeHyprland(t, nil)
	if out, ok := hyprOption("decoration:rounding"); ok {
		t.Fatalf("error reply taken as an option: %q", out)
	}
}

// The theme's hyprland.lua answers what it sets, without asking Hyprland:
// sync runs while Hyprland is being handed that theme. What it leaves
// alone still comes from Hyprland.
func TestHyprOptionReadsTheThemeFirst(t *testing.T) {
	requests := fakeHyprland(t, map[string]string{
		"general:col.active_border":   `{"option":"general:col.active_border","gradient":"ff000000 0deg","set":true}`,
		"general:col.inactive_border": `{"option":"general:col.inactive_border","gradient":"aa595959 0deg","set":true}`,
		"decoration:rounding":         `{"option":"decoration:rounding","int":9,"set":true}`,
	})
	// Kanagawa's shape: an active border only, and an o.* call.
	os.WriteFile(themeDir+"/hyprland.lua", []byte(`local active_border_color = "rgb(dcd7ba)"
hl.config({ general = { col = { active_border = active_border_color } } })
o.transparent_window({ tag = "terminal" }, "0.99 0.985")
`), 0o600)

	if got, ok := hyprBorderColor("general:col.active_border"); !ok || got != "#dcd7baff" {
		t.Fatalf("active border = %q, %v; want the theme's", got, ok)
	}
	if got, ok := hyprBorderColor("general:col.inactive_border"); !ok || got != "#595959aa" {
		t.Fatalf("inactive border = %q, %v; want Hyprland's", got, ok)
	}
	if n := requests.Load(); n != int32(len(hyprOptions)-1) {
		t.Fatalf("socket requests = %d, want all but the theme's (%d)", n, len(hyprOptions)-1)
	}
}

func TestThemeHyprOptions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hyprland.lua")
	write := func(source string) map[string]string {
		os.WriteFile(path, []byte(source), 0o600)
		return themeHyprOptions(path)
	}

	// Omarchy's template, rendered.
	got := write(`local active_border_color = "#BB9AF7"
local inactive_border_color = "rgba(595959aa)"
hl.config({
  general = { col = { active_border = active_border_color, inactive_border = inactive_border_color } },
  group = { col = { border_active = active_border_color, border_inactive = inactive_border_color } },
})`)
	if !strings.Contains(got["general:col.active_border"], `"ffbb9af7 0deg"`) ||
		!strings.Contains(got["general:col.inactive_border"], `"aa595959 0deg"`) {
		t.Errorf("template: %v", got)
	}

	// A gradient, and calls merged over each other.
	got = write(`local a = { colors = { "rgba(8a8588ee)", "rgba(e2dddcee)" }, angle = 45 }
hl.config({ general = { col = { active_border = a } } })
hl.config({ decoration = { rounding = 0, blur = { enabled = false } }, general = { border_size = 3 } })`)
	want := map[string]string{
		"general:col.active_border": `"ee8a8588 eee2dddc 45deg"`,
		"decoration:rounding":       `"int":0`,
		"general:border_size":       `"int":3`,
		"decoration:blur:enabled":   `"bool":false`,
	}
	for option, fragment := range want {
		if !strings.Contains(got[option], fragment) {
			t.Errorf("%s = %q, want %s", option, got[option], fragment)
		}
	}
	if _, ok := got["general:col.inactive_border"]; ok {
		t.Errorf("inactive border answered though the theme doesn't set it")
	}

	// Errors, sandboxed libraries and runaway loops answer nothing.
	for _, source := range []string{
		`hl.config({ general = { col = { active_border = "#BB9AF7" } } }) error("x")`,
		`io.open("/etc/passwd")`,
		`while true do end`,
		`hl.config({ general = { col = { active_border = "teal" } } })`,
	} {
		if got := write(source); len(got) != 0 {
			t.Errorf("%q answered %v", source, got)
		}
	}
}

func TestHyprColor(t *testing.T) {
	for in, want := range map[string]string{
		"rgba(595959aa)":        "aa595959",
		"rgb(dcd7ba)":           "ffdcd7ba",
		"#BB9AF7":               "ffbb9af7",
		"#bb9af780":             "80bb9af7",
		"0xffe68e0d":            "ffe68e0d",
		"rgb(220, 215, 186)":    "ffdcd7ba",
		"rgba(220,215,186,0.5)": "80dcd7ba",
	} {
		if got, ok := hyprColor(in); !ok || got != want {
			t.Errorf("hyprColor(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"teal", "rgb(1,2)", "#12345", "rgba(1,2,3,2)", "0x123"} {
		if got, ok := hyprColor(in); ok {
			t.Errorf("hyprColor(%q) = %q, want no colour", in, got)
		}
	}
}
