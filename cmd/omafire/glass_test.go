package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"strings"
	"testing"
)

func flatFloor(t *testing.T, mode, frame, text string) float64 {
	t.Helper()
	f, ok1 := hexSRGB(frame)
	x, ok2 := hexSRGB(text)
	if !ok1 || !ok2 {
		t.Fatalf("bad colours %s %s", frame, text)
	}
	return glassFloorFor(f, x, mode, []srgb{{0, 0, 0}, {1, 1, 1}})
}

// The flat black-and-white floors match the report's model
// (docs/reports/2026-10-02-glass-readability, "b/w" column).
func TestGlassFloorFlat(t *testing.T) {
	for _, c := range []struct {
		name, mode, frame, text string
		want                    float64
	}{
		{"tokyo-night", "dark", "#13141c", "#a9b1d6", 0.88},
		{"rose-pine", "light", "#ede7e1", "#575279", 0.97},
		{"white", "light", "#f5f5f5", "#000000", 0.50},
	} {
		if got := flatFloor(t, c.mode, c.frame, c.text); got != c.want {
			t.Errorf("%s: floor %.2f, want %.2f", c.name, got, c.want)
		}
	}
}

// A theme whose wallpaper is its own frame colour needs no floor; a white
// wallpaper under a dark theme does. Cached results survive a second run.
func TestGlassFloorWallpapers(t *testing.T) {
	dir := t.TempDir()
	themeDir, stateDir, backgroundLink = dir, dir+"/state", dir+"/none"
	os.Mkdir(dir+"/backgrounds", 0o700)
	// No Hyprland, so blur reads false even inside a session.
	t.Setenv("HYPRLAND_INSTANCE_SIGNATURE", "")
	t.Setenv("PATH", t.TempDir())
	hyprReplies = map[string]hyprReply{}
	t.Cleanup(func() { hyprReplies = map[string]hyprReply{} })
	writePNG := func(name string, c color.Color) {
		img := image.NewRGBA(image.Rect(0, 0, 64, 36))
		for y := range 36 {
			for x := range 64 {
				img.Set(x, y, c)
			}
		}
		f, err := os.Create(dir + "/backgrounds/" + name)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		png.Encode(f, img)
	}
	p := &palette{mode: "dark", color: map[string]string{"dark_background": "#13141c", "foreground": "#a9b1d6"}}

	writePNG("a.png", color.RGBA{0x13, 0x14, 0x1c, 0xff})
	if got := glassFloor(p); got != 0.50 {
		t.Errorf("own-colour wallpaper: floor %.2f, want 0.50", got)
	}
	writePNG("b.png", color.White)
	if got := glassFloor(p); got != 0.88 {
		t.Errorf("white wallpaper: floor %.2f, want 0.88", got)
	}
	cache, err := os.ReadFile(stateDir + "/glass-cache.json")
	if err != nil || strings.Count(string(cache), glassCacheKeyPrefix) != 2 {
		t.Fatalf("cache not written: %v %s", err, cache)
	}
	if got := glassFloor(p); got != 0.88 {
		t.Errorf("cached: floor %.2f, want 0.88", got)
	}

	// omarchy-theme-set copies the theme in afresh on every switch: the
	// same bytes at a new path and mtime must still hit. Poison b.png's
	// entry with a's colour; a hit then reads the own-colour floor.
	data, _ := os.ReadFile(dir + "/backgrounds/b.png")
	key, _ := glassCacheKey(false, dir+"/backgrounds/b.png")
	poisoned := strings.Replace(string(cache), `"`+key+`":{"patches":[[1,1,1],[1,1,1]]}`,
		`"`+key+`":{"patches":[[0.0745,0.0784,0.1098],[0.0745,0.0784,0.1098]]}`, 1)
	if poisoned == string(cache) {
		t.Fatalf("b.png's entry not found under %s in %s", key, cache)
	}
	os.WriteFile(stateDir+"/glass-cache.json", []byte(poisoned), 0o600)
	os.Remove(dir + "/backgrounds/b.png")
	os.WriteFile(dir+"/backgrounds/b-copy.png", data, 0o600)
	if got := glassFloor(p); got != 0.50 {
		t.Errorf("copied wallpaper: floor %.2f, want the cached 0.50 (it was decoded again)", got)
	}

	os.Remove(dir + "/backgrounds/a.png")
	os.Remove(dir + "/backgrounds/b-copy.png")
	os.WriteFile(dir+"/backgrounds/clip.mp4", []byte("not an image"), 0o600)
	if got := glassFloor(p); got != 0.88 {
		t.Errorf("no still wallpaper: floor %.2f, want the flat 0.88", got)
	}
}
