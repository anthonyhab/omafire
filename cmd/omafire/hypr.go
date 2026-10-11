package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The Hyprland options sync reads: the chrome follows the desktop's
// rounding, borders and blur.
var hyprOptions = []string{
	"general:col.active_border",
	"general:col.inactive_border",
	"general:border_size",
	"decoration:rounding",
	"decoration:blur:enabled",
}

// hyprOption is a `hyprctl getoption -j` reply; ok is false without
// Hyprland (a TTY, a test sandbox). Hyprland is asked over its socket, as
// hyprctl does, every option at once when sync starts.
//
// Except, with OMAFIRE_HYPR_THEME, for the options that file sets: the
// caller is about to hand Hyprland a theme, and the file holds what
// Hyprland will hold of it once it has (the theme's settings the user's
// config doesn't override). Sync then needn't wait for the switch, which
// keeps Hyprland busy for ~50 ms after (each answer waits for a frame);
// the options the file leaves out are the same before and after it.
func hyprOption(option string) (string, bool) {
	hyprOnce.Do(hyprPrefetch)
	hyprMu.Lock()
	reply, ok := hyprReplies[option]
	hyprMu.Unlock()
	if !ok {
		reply = hyprAsk(option)
		hyprMu.Lock()
		hyprReplies[option] = reply
		hyprMu.Unlock()
	}
	return reply.out, reply.ok
}

type hyprReply struct {
	out string
	ok  bool
}

var (
	hyprOnce    sync.Once
	hyprMu      sync.Mutex
	hyprReplies = map[string]hyprReply{}
)

// hyprReset forgets the replies, for tests.
func hyprReset() {
	hyprOnce = sync.Once{}
	hyprReplies = map[string]hyprReply{}
}

// hyprPrefetch answers every option sync reads: from OMAFIRE_HYPR_THEME
// where it sets one, else from Hyprland, the requests in flight together.
func hyprPrefetch() {
	theme := hyprThemeOptions(os.Getenv("OMAFIRE_HYPR_THEME"))
	var asked []string
	for _, option := range hyprOptions {
		if out, ok := theme[option]; ok {
			hyprReplies[option] = hyprReply{out, true}
		} else {
			asked = append(asked, option)
		}
	}
	replies := make([]hyprReply, len(asked))
	var wg sync.WaitGroup
	for i, option := range asked {
		wg.Go(func() { replies[i] = hyprAsk(option) })
	}
	wg.Wait()
	for i, option := range asked {
		hyprReplies[option] = replies[i]
	}
}

func hyprAsk(option string) hyprReply {
	if out, ok := hyprSocketRequest("j/getoption " + option); ok {
		return hyprReply{out, true}
	}
	status, out := runCommand([]string{"hyprctl", "getoption", option, "-j"}, true)
	return hyprReply{out, status == 0}
}

// hyprSocketRequest sends one request to the running Hyprland's control
// socket and returns the reply; ok is false without one, or on an error
// reply, so the caller falls back to hyprctl.
func hyprSocketRequest(request string) (string, bool) {
	signature := os.Getenv("HYPRLAND_INSTANCE_SIGNATURE")
	runtime := os.Getenv("XDG_RUNTIME_DIR")
	if signature == "" || runtime == "" || strings.Contains(signature, "/") {
		return "", false
	}
	conn, err := net.DialTimeout("unix", runtime+"/hypr/"+signature+"/.socket.sock", time.Second)
	if err != nil {
		return "", false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := io.WriteString(conn, request); err != nil {
		return "", false
	}
	reply, err := io.ReadAll(conn)
	if err != nil || len(reply) == 0 || !strings.HasPrefix(strings.TrimSpace(string(reply)), "{") {
		return "", false
	}
	return string(reply), true
}

// hyprThemeOptions answers, in hyprctl's reply format, each option of
// hyprOptions the file at path sets. The file is the theme's hl.config
// tree as JSON ({"general": {"col": {"active_border": "rgb(dcd7ba)"}}});
// a border may be a gradient, {"colors": [...], "angle": 45}.
func hyprThemeOptions(path string) map[string]string {
	out := map[string]string{}
	if path == "" {
		return out
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	var config map[string]any
	if json.Unmarshal(data, &config) != nil {
		return out
	}
	lookup := func(keys ...string) any {
		var v any = config
		for _, k := range keys {
			m, ok := v.(map[string]any)
			if !ok {
				return nil
			}
			v = m[k]
		}
		return v
	}
	for option, keys := range map[string][]string{
		"general:col.active_border":   {"general", "col", "active_border"},
		"general:col.inactive_border": {"general", "col", "inactive_border"},
	} {
		if gradient, ok := hyprGradient(lookup(keys...)); ok {
			out[option] = fmt.Sprintf(`{"option":%q,"gradient":%q,"set":true}`, option, gradient)
		}
	}
	for option, keys := range map[string][]string{
		"general:border_size": {"general", "border_size"},
		"decoration:rounding": {"decoration", "rounding"},
	} {
		if n, ok := lookup(keys...).(float64); ok && n == math.Trunc(n) {
			out[option] = fmt.Sprintf(`{"option":%q,"int":%d,"set":true}`, option, int64(n))
		}
	}
	switch v := lookup("decoration", "blur", "enabled").(type) {
	case bool:
		out["decoration:blur:enabled"] = fmt.Sprintf(`{"option":"decoration:blur:enabled","bool":%t,"set":true}`, v)
	case float64:
		if v == 0 || v == 1 {
			out["decoration:blur:enabled"] = fmt.Sprintf(`{"option":"decoration:blur:enabled","bool":%t,"set":true}`, v == 1)
		}
	}
	return out
}

// hyprGradient is a border value as Hyprland reports it: "AARRGGBB ...
// <angle>deg". A string is one colour at 0deg; a gradient is {"colors":
// [...], "angle": n}.
func hyprGradient(v any) (string, bool) {
	var colors []string
	angle := 0.0
	switch v := v.(type) {
	case string:
		c, ok := hyprColor(v)
		if !ok {
			return "", false
		}
		colors = []string{c}
	case map[string]any:
		list, ok := v["colors"].([]any)
		if !ok || len(list) == 0 {
			return "", false
		}
		for _, item := range list {
			s, ok := item.(string)
			if !ok {
				return "", false
			}
			c, ok := hyprColor(s)
			if !ok {
				return "", false
			}
			colors = append(colors, c)
		}
		if a, ok := v["angle"].(float64); ok {
			angle = a
		}
	default:
		return "", false
	}
	return strings.Join(colors, " ") + " " + strconv.FormatFloat(angle, 'f', -1, 64) + "deg", true
}

// hyprColor is a Hyprland colour string as lowercase AARRGGBB: rgba(hex8),
// rgb(hex6), rgba(r, g, b, a), rgb(r, g, b), #RRGGBB[AA] and 0xAARRGGBB.
func hyprColor(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	hex := func(h string) bool {
		for i := range len(h) {
			if !isHex(h[i]) {
				return false
			}
		}
		return true
	}
	inner := func(prefix string) (string, bool) {
		if strings.HasPrefix(s, prefix+"(") && strings.HasSuffix(s, ")") {
			return strings.TrimSpace(s[len(prefix)+1 : len(s)-1]), true
		}
		return "", false
	}
	decimal := func(parts []string, alpha bool) (string, bool) {
		var v [4]int
		v[3] = 255
		for i, p := range parts {
			p = strings.TrimSpace(p)
			if i == 3 && alpha {
				f, err := strconv.ParseFloat(p, 64)
				if err != nil || f < 0 || f > 1 {
					return "", false
				}
				v[3] = int(math.Round(f * 255))
				continue
			}
			n, err := strconv.Atoi(p)
			if err != nil || n < 0 || n > 255 {
				return "", false
			}
			v[i] = n
		}
		return fmt.Sprintf("%02x%02x%02x%02x", v[3], v[0], v[1], v[2]), true
	}
	switch {
	case strings.HasPrefix(s, "0x") && len(s) == 10 && hex(s[2:]):
		return s[2:], true
	case strings.HasPrefix(s, "#") && len(s) == 7 && hex(s[1:]):
		return "ff" + s[1:], true
	case strings.HasPrefix(s, "#") && len(s) == 9 && hex(s[1:]):
		return s[7:9] + s[1:7], true
	}
	if body, ok := inner("rgba"); ok {
		if len(body) == 8 && hex(body) {
			return body[6:8] + body[0:6], true
		}
		if parts := strings.Split(body, ","); len(parts) == 4 {
			return decimal(parts, true)
		}
		return "", false
	}
	if body, ok := inner("rgb"); ok {
		if len(body) == 6 && hex(body) {
			return "ff" + body, true
		}
		if parts := strings.Split(body, ","); len(parts) == 3 {
			return decimal(parts, false)
		}
	}
	return "", false
}
