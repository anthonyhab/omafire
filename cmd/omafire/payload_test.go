package main

import (
	"bytes"
	"os"
	"testing"
	"unsafe"

	"golang.org/x/sys/unix"
)

// A payload removal cut short must leave the tree marked as ours: the
// entrypoint is deleted after every other entry (a remove
// killed after it left an unmarked chrome/omafire/ that blocked every later
// setup and remove).
func TestRemoveFFPayloadTreeDeletesMarkerLast(t *testing.T) {
	dir := t.TempDir() + "/omafire"
	for _, sub := range []string{"/src/icons", "/src/modes"} {
		if err := os.MkdirAll(dir+sub, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		"/" + ffPayloadEntry:  ffBridgeMarker + "\n",
		"/userContent.css":    "/* content */\n",
		"/zz-after-entry.css": "/* sorts after the entrypoint */\n",
		"/src/tokens.css":     "/* tokens */\n",
		"/src/modes/zen.css":  "/* zen */\n",
	}
	for name, data := range files {
		if err := os.WriteFile(dir+name, []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	fd, err := unix.InotifyInit1(unix.IN_NONBLOCK | unix.IN_CLOEXEC)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(fd)
	if _, err := unix.InotifyAddWatch(fd, dir, unix.IN_DELETE); err != nil {
		t.Fatal(err)
	}

	removeFFPayloadTree(dir)
	if pathExists(dir) {
		t.Fatalf("payload not removed: %s", dir)
	}

	var deleted []string
	buf := make([]byte, 64*1024)
	n, err := unix.Read(fd, buf)
	if err != nil {
		t.Fatal(err)
	}
	for off := 0; off+unix.SizeofInotifyEvent <= n; {
		ev := (*unix.InotifyEvent)(unsafe.Pointer(&buf[off]))
		name := buf[off+unix.SizeofInotifyEvent : off+unix.SizeofInotifyEvent+int(ev.Len)]
		if ev.Mask&unix.IN_DELETE != 0 {
			deleted = append(deleted, string(bytes.TrimRight(name, "\x00")))
		}
		off += unix.SizeofInotifyEvent + int(ev.Len)
	}
	if len(deleted) != 4 || deleted[len(deleted)-1] != ffPayloadEntry {
		t.Fatalf("deleted %v; want the entrypoint last of 4", deleted)
	}
}

// A tree that cannot be emptied keeps its marker, so it stays ours.
func TestRemoveFFPayloadTreeKeepsMarkerWhenNotEmptied(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root removes read-only entries")
	}
	dir := t.TempDir() + "/omafire"
	if err := os.MkdirAll(dir+"/src", 0o700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(dir+"/"+ffPayloadEntry, []byte(ffBridgeMarker+"\n"), 0o600)
	os.WriteFile(dir+"/src/a.css", []byte("a\n"), 0o600)
	os.Chmod(dir+"/src", 0o500)
	defer os.Chmod(dir+"/src", 0o700)

	if removeFFPayloadTree(dir) {
		t.Fatal("reported a payload it could not empty as removed")
	}
	if !ffPayloadOwned(dir) {
		t.Fatal("a payload removal that could not finish dropped its ownership marker")
	}
}

// A payload directory left unreadable but searchable (0311) still shows its
// marker; removal must list it (restoring our 0700) and finish, never take
// the failed listing for an empty tree and drop the marker.
func TestRemoveFFPayloadTreeUnreadableDir(t *testing.T) {
	dir := t.TempDir() + "/omafire"
	if err := os.MkdirAll(dir+"/src", 0o700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(dir+"/"+ffPayloadEntry, []byte(ffBridgeMarker+"\n"), 0o600)
	os.WriteFile(dir+"/userContent.css", []byte("c\n"), 0o600)
	os.WriteFile(dir+"/src/a.css", []byte("a\n"), 0o600)
	os.Chmod(dir+"/src", 0o311)
	os.Chmod(dir, 0o311)
	defer os.Chmod(dir, 0o700)
	if !ffPayloadOwned(dir) {
		t.Fatal("fixture: the marker should be readable through a 0311 directory")
	}

	if !removeFFPayloadTree(dir) || pathExists(dir) {
		t.Fatal("an owned 0311 payload was not removed")
	}
}
