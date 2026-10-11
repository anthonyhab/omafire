package main

import (
	"context"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	lua "github.com/yuin/gopher-lua"
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
// Hyprland (a TTY, a test sandbox).
//
// An option the theme's hyprland.lua sets is answered from that file:
// omarchy-theme-set syncs as soon as the theme is swapped in, before
// Hyprland is handed it, so Hyprland would still report the outgoing
// theme. An option the theme leaves alone is the same before and after
// the switch (the theme's settings are applied over the running config),
// so Hyprland is asked for it, over its socket as hyprctl does, all at
// once when sync starts.
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

// hyprPrefetch answers every option sync reads: from the theme where it
// sets one, else from Hyprland, the requests in flight together.
func hyprPrefetch() {
	theme := themeHyprOptions(themeDir + "/hyprland.lua")
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

// themeHyprOptions runs the theme's hyprland.lua with hl.config captured
// and answers, in hyprctl's reply format, each option of hyprOptions it
// sets to a value read here. Omarchy's template and its themes set the
// borders from locals, some as gradient tables, so the file is run rather
// than matched. Only the base, table, string and math libraries are open
// (os.getenv aside), every other hl.* and o.* call is a no-op, and a run
// gets 100 ms.
func themeHyprOptions(path string) map[string]string {
	out := map[string]string{}
	source, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	L := lua.NewState(lua.Options{SkipOpenLibs: true})
	defer L.Close()
	for _, lib := range []struct {
		name string
		open lua.LGFunction
	}{{lua.BaseLibName, lua.OpenBase}, {lua.TabLibName, lua.OpenTable},
		{lua.StringLibName, lua.OpenString}, {lua.MathLibName, lua.OpenMath}} {
		L.Push(L.NewFunction(lib.open))
		L.Push(lua.LString(lib.name))
		L.Call(1, 0)
	}
	for _, name := range []string{"dofile", "loadfile", "load", "loadstring", "require", "module"} {
		L.SetGlobal(name, lua.LNil)
	}
	osTable := L.NewTable()
	osTable.RawSetString("getenv", L.NewFunction(func(L *lua.LState) int {
		L.Push(lua.LString(os.Getenv(L.CheckString(1))))
		return 1
	}))
	L.SetGlobal("os", osTable)

	config := L.NewTable()
	noop := L.NewFunction(func(*lua.LState) int { return 0 })
	stub := func(fields map[string]lua.LValue) *lua.LTable {
		t := L.NewTable()
		for k, v := range fields {
			t.RawSetString(k, v)
		}
		meta := L.NewTable()
		meta.RawSetString("__index", L.NewFunction(func(L *lua.LState) int {
			L.Push(noop)
			return 1
		}))
		L.SetMetatable(t, meta)
		return t
	}
	L.SetGlobal("hl", stub(map[string]lua.LValue{
		"config": L.NewFunction(func(L *lua.LState) int {
			if t, ok := L.Get(1).(*lua.LTable); ok {
				luaMerge(L, config, t)
			}
			return 0
		}),
	}))
	L.SetGlobal("o", stub(nil))

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	L.SetContext(ctx)
	if err := L.DoString(string(source)); err != nil {
		return out
	}

	lookup := func(keys ...string) lua.LValue {
		var v lua.LValue = config
		for _, k := range keys {
			t, ok := v.(*lua.LTable)
			if !ok {
				return lua.LNil
			}
			v = t.RawGetString(k)
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
		if n, ok := lookup(keys...).(lua.LNumber); ok && float64(n) == math.Trunc(float64(n)) {
			out[option] = fmt.Sprintf(`{"option":%q,"int":%d,"set":true}`, option, int64(n))
		}
	}
	switch v := lookup("decoration", "blur", "enabled").(type) {
	case lua.LBool:
		out["decoration:blur:enabled"] = fmt.Sprintf(`{"option":"decoration:blur:enabled","bool":%t,"set":true}`, bool(v))
	case lua.LNumber:
		if v == 0 || v == 1 {
			out["decoration:blur:enabled"] = fmt.Sprintf(`{"option":"decoration:blur:enabled","bool":%t,"set":true}`, v == 1)
		}
	}
	return out
}

// luaMerge copies src into dst, merging nested tables: Hyprland applies
// each hl.config call over the last.
func luaMerge(L *lua.LState, dst, src *lua.LTable) {
	src.ForEach(func(k, v lua.LValue) {
		if t, ok := v.(*lua.LTable); ok && !luaIsGradient(t) {
			sub, ok := dst.RawGet(k).(*lua.LTable)
			if !ok {
				sub = L.NewTable()
				dst.RawSet(k, sub)
			}
			luaMerge(L, sub, t)
			return
		}
		dst.RawSet(k, v)
	})
}

func luaIsGradient(t *lua.LTable) bool {
	_, ok := t.RawGetString("colors").(*lua.LTable)
	return ok
}

// hyprGradient is a border value as Hyprland reports it: "AARRGGBB ...
// <angle>deg". A string is one colour at 0deg; a table is { colors = {...},
// angle = n }.
func hyprGradient(v lua.LValue) (string, bool) {
	var colors []string
	angle := 0.0
	switch v := v.(type) {
	case lua.LString:
		c, ok := hyprColor(string(v))
		if !ok {
			return "", false
		}
		colors = []string{c}
	case *lua.LTable:
		list, ok := v.RawGetString("colors").(*lua.LTable)
		if !ok {
			return "", false
		}
		for i := 1; i <= list.Len(); i++ {
			s, ok := list.RawGetInt(i).(lua.LString)
			if !ok {
				return "", false
			}
			c, ok := hyprColor(string(s))
			if !ok {
				return "", false
			}
			colors = append(colors, c)
		}
		if len(colors) == 0 {
			return "", false
		}
		if a, ok := v.RawGetString("angle").(lua.LNumber); ok {
			angle = float64(a)
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
