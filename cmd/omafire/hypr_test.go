package main

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeHyprland serves Hyprland's control socket under a fresh runtime dir,
// answering each getoption from replies and counting the requests.
func fakeHyprland(t *testing.T, replies map[string]string) *int {
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
	hyprReplies = map[string]hyprReply{}
	t.Cleanup(func() { hyprReplies = map[string]hyprReply{} })

	requests := new(int)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			buf := make([]byte, 512)
			n, _ := conn.Read(buf)
			*requests++
			option := strings.TrimPrefix(string(buf[:n]), "j/getoption ")
			if reply, ok := replies[option]; ok {
				conn.Write([]byte(reply))
			} else {
				conn.Write([]byte("no such option"))
			}
			conn.Close()
		}
	}()
	return requests
}

func TestHyprOptionReadsTheSocketOncePerOption(t *testing.T) {
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
	if *requests != 2 {
		t.Fatalf("socket requests = %d, want one per option (2)", *requests)
	}
}

func TestHyprOptionErrorReplyIsNotAnOption(t *testing.T) {
	fakeHyprland(t, nil)
	if out, ok := hyprOption("decoration:rounding"); ok {
		t.Fatalf("error reply taken as an option: %q", out)
	}
}
