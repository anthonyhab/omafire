package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	_ "golang.org/x/image/webp"
)

// The glass floor: the lowest window alpha at which the chrome's
// text tokens stay readable over the theme's wallpapers. The theme paints
// max(omafire.transparency, floor), so the slider can't make a theme
// unreadable, and themes that read at 0.50 keep their glass.

// glassScanWidth is the width a wallpaper is measured at. Hyprland's blur
// (size 3, passes 3) spreads about 12px at 1600 wide: 6px here, matched by
// three box passes of radius 6. Narrower scans average away the bright
// patches a label can sit on.
const (
	glassScanWidth  = 800
	glassBlurRadius = 6
	glassBlurPasses = 3
)

type srgb [3]float64

// hexSRGB reads a palette colour (#RRGGBB, normalised by the palette).
func hexSRGB(hex string) (srgb, bool) {
	if len(hex) < 7 || hex[0] != '#' {
		return srgb{}, false
	}
	r, g, b := rgb(hex)
	return srgb{float64(r) / 255, float64(g) / 255, float64(b) / 255}, true
}

func luminance(c srgb) float64 {
	lin := func(v float64) float64 {
		if v <= 0.04045 {
			return v / 12.92
		}
		return math.Pow((v+0.055)/1.055, 2.4)
	}
	return 0.2126*lin(c[0]) + 0.7152*lin(c[1]) + 0.0722*lin(c[2])
}

func contrast(a, b srgb) float64 {
	la, lb := luminance(a), luminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

// mixRGB is color-mix(in srgb, fg t, bg).
func mixRGB(fg, bg srgb, t float64) srgb {
	return srgb{fg[0]*t + bg[0]*(1-t), fg[1]*t + bg[1]*(1-t), fg[2]*t + bg[2]*(1-t)}
}

// glassTokens are tokens.css's text mixes over the surface and their
// floors: text and the resting tab label 4.5:1, dim glyphs 3:1.
func glassTokens(mode string) [][2]float64 {
	if mode == "light" {
		return [][2]float64{{1, 4.5}, {0.90, 4.5}, {0.70, 3}}
	}
	return [][2]float64{{1, 4.5}, {0.80, 4.5}, {0.62, 3}}
}

// glassFloorFor is the lowest alpha in [0.50, 1] at which every token over
// the frame at that alpha clears its floor on every backdrop.
func glassFloorFor(frame, text srgb, mode string, backdrops []srgb) float64 {
	for step := 50; step < 100; step++ {
		alpha := float64(step) / 100
		readable := true
		for _, back := range backdrops {
			surface := mixRGB(frame, back, alpha)
			for _, token := range glassTokens(mode) {
				if contrast(mixRGB(text, surface, token[0]), surface) < token[1] {
					readable = false
				}
			}
		}
		if readable {
			return alpha
		}
	}
	return 1
}

// wallpaperExtremes is a wallpaper's darkest and brightest patch: the 2nd
// and 98th luminance percentile, after a blur like Hyprland's when blur is
// on. It returns false for anything that isn't a still image.
func wallpaperExtremes(path string, blur bool) ([2]srgb, bool) {
	f, err := os.Open(path)
	if err != nil {
		return [2]srgb{}, false
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return [2]srgb{}, false
	}
	// A wallpaper narrower than the scan is measured as it is, its blur
	// scaled with it.
	width := min(glassScanWidth, img.Bounds().Dx())
	px := scaleDown(img, width)
	if len(px) == 0 {
		return [2]srgb{}, false
	}
	if blur {
		height := len(px) / width
		radius := max(1, glassBlurRadius*width/glassScanWidth)
		for range glassBlurPasses {
			boxBlur(px, width, height, radius)
		}
	}
	lum := make([]float64, len(px))
	order := make([]int, len(px))
	for i, c := range px {
		lum[i], order[i] = luminance(c), i
	}
	sort.Slice(order, func(a, b int) bool { return lum[order[a]] < lum[order[b]] })
	return [2]srgb{px[order[len(order)*2/100]], px[order[len(order)*98/100]]}, true
}

// scaleDown averages img into a width-wide grid of rows (area sampling,
// from at most two samples per cell along each axis: a 4K wallpaper has
// far more pixels than the measure needs, and a theme switch waits on it).
func scaleDown(img image.Image, width int) []srgb {
	b := img.Bounds()
	if b.Dx() < 1 || b.Dy() < 1 {
		return nil
	}
	height := max(1, int(math.Round(float64(width)*float64(b.Dy())/float64(b.Dx()))))
	step := max(1, b.Dx()/(2*width))
	at := func(x, y int) (uint32, uint32, uint32, uint32) { return img.At(x, y).RGBA() }
	if fast, ok := img.(image.RGBA64Image); ok {
		at = func(x, y int) (uint32, uint32, uint32, uint32) {
			c := fast.RGBA64At(x, y)
			return uint32(c.R), uint32(c.G), uint32(c.B), uint32(c.A)
		}
	}
	sum := make([]srgb, width*height)
	count := make([]float64, width*height)
	for y := b.Min.Y; y < b.Max.Y; y += step {
		row := (y - b.Min.Y) * height / b.Dy() * width
		for x := b.Min.X; x < b.Max.X; x += step {
			r, g, bl, _ := at(x, y)
			i := row + (x-b.Min.X)*width/b.Dx()
			sum[i][0] += float64(r) / 0xffff
			sum[i][1] += float64(g) / 0xffff
			sum[i][2] += float64(bl) / 0xffff
			count[i]++
		}
	}
	for i := range sum {
		if count[i] > 0 {
			for c := range 3 {
				sum[i][c] /= count[i]
			}
		}
	}
	return sum
}

// boxBlur is one separable box pass of the given radius, edges clamped.
func boxBlur(px []srgb, width, height, radius int) {
	line := make([]srgb, max(width, height))
	pass := func(n int, at func(int) int) {
		for i := range n {
			var acc srgb
			for k := -radius; k <= radius; k++ {
				c := px[at(min(max(i+k, 0), n-1))]
				acc[0], acc[1], acc[2] = acc[0]+c[0], acc[1]+c[1], acc[2]+c[2]
			}
			w := float64(2*radius + 1)
			line[i] = srgb{acc[0] / w, acc[1] / w, acc[2] / w}
		}
		for i := range n {
			px[at(i)] = line[i]
		}
	}
	for y := range height {
		pass(width, func(x int) int { return y*width + x })
	}
	for x := range width {
		pass(height, func(y int) int { return y*width + x })
	}
}

// glassWallpapers are the theme's backgrounds and the current one: Omarchy
// cycles through the former without a hook, and the latter may be the
// user's own.
func glassWallpapers() []string {
	paths, _ := filepath.Glob(themeDir + "/backgrounds/*")
	if current, err := filepath.EvalSymlinks(backgroundLink); err == nil {
		paths = append(paths, current)
	}
	return paths
}

// hyprBlur reports whether Hyprland blurs behind windows. Without Hyprland
// the wallpaper is taken as sharp, the stricter case.
func hyprBlur() bool {
	out, ok := hyprOption("decoration:blur:enabled")
	if !ok {
		return false
	}
	if _, field, found := strings.Cut(out, `"bool"`); found {
		return strings.HasPrefix(strings.TrimLeft(field, ": "), "true")
	}
	value, ok := hyprInt("decoration:blur:enabled", 1)
	return ok && value == 1
}

// glassCacheEntry is one wallpaper's extremes, keyed by blur and the
// file's SHA-256: decoding a theme's wallpapers takes hundreds of
// milliseconds, a theme switch shouldn't. Not by path, size and mtime:
// omarchy-theme-set copies the theme in afresh on every switch, so those
// never matched and every switch decoded every wallpaper again. Hashing a
// theme's backgrounds takes a few milliseconds.
type glassCacheEntry struct {
	Patches [2][3]float64 `json:"patches"`
}

// glassCacheKeyPrefix marks content keys. A cache from before them, keyed
// by path, is dropped on the next write.
const glassCacheKeyPrefix = "sha256:"

func glassCacheKey(blur bool, path string) (string, bool) {
	f, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer f.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, f); err != nil {
		return "", false
	}
	return fmt.Sprintf("%s%x:%t", glassCacheKeyPrefix, sum.Sum(nil), blur), true
}

// glassFloor measures the palette against the wallpapers. With no still
// wallpaper to measure (a video, none at all) it takes flat black and
// white.
func glassFloor(p *palette) float64 {
	frame, ok1 := hexSRGB(p.get("dark_background"))
	text, ok2 := hexSRGB(p.get("foreground"))
	if !ok1 || !ok2 {
		return 0.5
	}
	blur := hyprBlur()
	cachePath := stateDir + "/glass-cache.json"
	cache := map[string]glassCacheEntry{}
	if data, err := os.ReadFile(cachePath); err == nil {
		json.Unmarshal(data, &cache)
	}
	stale := false
	for key := range cache {
		if !strings.HasPrefix(key, glassCacheKeyPrefix) {
			delete(cache, key)
			stale = true
		}
	}
	// Hash, and measure what the cache lacks, every wallpaper at once: a
	// theme seen for the first time costs its slowest decode, not their sum.
	type measured struct {
		key     string
		entry   glassCacheEntry
		ok      bool
		pending bool
	}
	var found []*measured
	var wg sync.WaitGroup
	for _, path := range glassWallpapers() {
		st, err := os.Stat(path)
		if err != nil || !st.Mode().IsRegular() {
			continue
		}
		m := &measured{}
		found = append(found, m)
		wg.Go(func() {
			key, ok := glassCacheKey(blur, path)
			if !ok {
				return
			}
			m.key = key
			if entry, hit := cache[key]; hit {
				m.entry, m.ok = entry, true
				return
			}
			if patches, ok := wallpaperExtremes(path, blur); ok {
				m.entry = glassCacheEntry{[2][3]float64{patches[0], patches[1]}}
				m.ok, m.pending = true, true
			}
		})
	}
	wg.Wait()
	changed := stale
	var backdrops []srgb
	for _, m := range found {
		if !m.ok {
			continue
		}
		if m.pending {
			cache[m.key], changed = m.entry, true
		}
		backdrops = append(backdrops, m.entry.Patches[0], m.entry.Patches[1])
	}
	if changed {
		if data, err := json.Marshal(cache); err == nil {
			mkdirP700(stateDir)
			atomicWrite(cachePath, string(data)+"\n", 0o600, false)
		}
	}
	if len(backdrops) == 0 {
		backdrops = []srgb{{0, 0, 0}, {1, 1, 1}}
	}
	return glassFloorFor(frame, text, p.mode, backdrops)
}
