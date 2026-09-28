// omafire-native-host: the native messaging host the browser extension
// starts. It sends the theme message in ~/.local/state/omafire/theme.json
// and the Omarchy wallpaper whenever either changes, asleep on inotify in
// between, and exits when the browser closes stdin.
//
// It also starts `omafire sync` the moment Omarchy swaps a theme in (it
// writes current/theme.name right after moving the theme into place),
// rather than waiting for the theme-set hook: Omarchy runs its hooks only
// after every app's retint has finished, about half a second later, and
// Firefox was the last thing on the desktop to change. The hook still runs
// and finds nothing left to do.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

const (
	maxStateBytes       = 65536
	retryIntervalMS     = 1000
	eventBufferBytes    = 16 * 1024
	maxWallpaperBytes   = 32 << 20
	wallpaperChunkBytes = 512 * 1024
	// Every watch uses the same mask: watches on one directory share a
	// descriptor, and a narrower mask would replace the wider one.
	watchMask = unix.IN_CLOSE_WRITE | unix.IN_MOVED_FROM | unix.IN_MOVED_TO | unix.IN_CREATE |
		unix.IN_DELETE | unix.IN_ATTRIB | unix.IN_DELETE_SELF | unix.IN_MOVE_SELF
)

type watchTarget struct {
	path, directory, filename string
	wd                        int
	changed, removed, lost    bool
}

func newTarget(path string) (*watchTarget, bool) {
	t := &watchTarget{path: path, directory: ".", filename: path, wd: -1}
	if slash := strings.LastIndexByte(path, '/'); slash >= 0 {
		t.directory, t.filename = path[:max(slash, 1)], path[slash+1:]
	}
	return t, t.filename != ""
}

func writeAll(data []byte) error {
	for len(data) > 0 {
		n, err := unix.Write(1, data)
		if err == unix.EINTR {
			continue
		}
		if err != nil || n <= 0 {
			return fmt.Errorf("write failed")
		}
		data = data[n:]
	}
	return nil
}

// send writes one native message: its length in native byte order, then
// the message.
func send(message []byte) error {
	if uint64(len(message)) > 0xFFFFFFFF {
		return fmt.Errorf("message too long")
	}
	header := binary.NativeEndian.AppendUint32(nil, uint32(len(message)))
	if err := writeAll(header); err != nil {
		return err
	}
	return writeAll(message)
}

// readThemeMessage reads the state file when it holds one JSON object of at
// most maxStateBytes, never through a symlink.
func readThemeMessage(path string) ([]byte, bool) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, false
	}
	defer unix.Close(fd)
	var st unix.Stat_t
	if unix.Fstat(fd, &st) != nil || st.Mode&unix.S_IFMT != unix.S_IFREG || st.Size > maxStateBytes {
		return nil, false
	}
	message := make([]byte, maxStateBytes+1)
	total := 0
	for total < len(message) {
		n, err := unix.Read(fd, message[total:])
		if err == unix.EINTR {
			continue
		}
		if err != nil {
			return nil, false
		}
		if n == 0 {
			break
		}
		total += n
	}
	if total > maxStateBytes {
		return nil, false
	}
	message = bytes.TrimRight(message[:total], " \t\r\n")
	if len(message) < 2 || message[0] != '{' || message[len(message)-1] != '}' ||
		bytes.IndexByte(message, 0) >= 0 {
		return nil, false
	}
	return message, true
}

// checkTheme sends the theme message when it differs from the last one
// sent; an error means the browser side is gone.
func checkTheme(path string, last *[]byte) error {
	message, ok := readThemeMessage(path)
	if !ok || bytes.Equal(message, *last) {
		return nil
	}
	if err := send(message); err != nil {
		return err
	}
	*last = message
	return nil
}

// wallpaperTargets are the candidate "background" links, most preferred
// first. An override replaces the Omarchy locations entirely (tests).
func wallpaperTargets() []*watchTarget {
	var paths []string
	if override := os.Getenv("OMAFIRE_WALLPAPER_FILE"); override != "" {
		paths = []string{override}
	} else if home := os.Getenv("HOME"); home != "" {
		paths = []string{
			home + "/.local/state/omarchy/current/background",
			home + "/.config/omarchy/current/background",
		}
	}
	var targets []*watchTarget
	for _, path := range paths {
		if t, ok := newTarget(path); ok {
			targets = append(targets, t)
		}
	}
	return targets
}

func wallpaperMime(path string) string {
	base := path[strings.LastIndexByte(path, '/')+1:]
	dot := strings.LastIndexByte(base, '.')
	if dot < 0 {
		return ""
	}
	switch ext := base[dot+1:]; {
	case strings.EqualFold(ext, "jpg"), strings.EqualFold(ext, "jpeg"):
		return "image/jpeg"
	case strings.EqualFold(ext, "png"):
		return "image/png"
	case strings.EqualFold(ext, "webp"):
		return "image/webp"
	}
	return ""
}

// hashString is 64-bit FNV-1a.
func hashString(text string) uint64 {
	hash := uint64(14695981039346656037)
	for i := 0; i < len(text); i++ {
		hash ^= uint64(text[i])
		hash *= 1099511628211
	}
	return hash
}

type wallpaper struct {
	id, mime string
	size     int
}

// openWallpaper opens the first existing candidate (following its symlink).
// The id changes with the resolved path, inode, size and modification time.
func openWallpaper(targets []*watchTarget) (int, wallpaper, bool) {
	var none wallpaper
	path := ""
	for _, t := range targets {
		var st unix.Stat_t
		if unix.Stat(t.path, &st) == nil {
			path = t.path
			break
		}
	}
	if path == "" {
		return -1, none, false
	}
	resolved, err := filepath.Abs(path)
	if err == nil {
		resolved, err = filepath.EvalSymlinks(resolved)
	}
	if err != nil {
		return -1, none, false
	}
	w := wallpaper{mime: wallpaperMime(resolved)}
	if w.mime == "" {
		return -1, none, false
	}
	fd, err := unix.Open(resolved, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return -1, none, false
	}
	var st unix.Stat_t
	if unix.Fstat(fd, &st) != nil || st.Mode&unix.S_IFMT != unix.S_IFREG || st.Size <= 0 || st.Size > maxWallpaperBytes {
		unix.Close(fd)
		return -1, none, false
	}
	w.size = int(st.Size)
	w.id = fmt.Sprintf("%016x-%x-%x-%d-%d%09d", hashString(resolved), st.Dev, st.Ino, w.size,
		st.Mtim.Sec, st.Mtim.Nsec)
	return fd, w, true
}

func readExact(fd int, buffer []byte) bool {
	for total := 0; total < len(buffer); {
		n, err := unix.Read(fd, buffer[total:])
		if err == unix.EINTR {
			continue
		}
		if err != nil || n <= 0 {
			return false
		}
		total += n
	}
	return true
}

// sendWallpaper streams the image as consecutive chunk messages, each well
// below the 1 MB host-to-browser limit.
func sendWallpaper(w wallpaper, data []byte) error {
	count := (w.size + wallpaperChunkBytes - 1) / wallpaperChunkBytes
	for index := 0; index < count; index++ {
		chunk := data[index*wallpaperChunkBytes : min((index+1)*wallpaperChunkBytes, w.size)]
		message := fmt.Appendf(nil,
			`{"protocol":"omafox","version":1,"action":"wallpaper","id":"%s","mime":"%s","size":%d,"index":%d,"count":%d,"data":"`,
			w.id, w.mime, w.size, index, count)
		message = base64.StdEncoding.AppendEncode(message, chunk)
		message = append(message, '"', '}')
		if err := send(message); err != nil {
			return err
		}
	}
	return nil
}

// checkWallpaper sends the current wallpaper when its id differs from the
// last one sent, or a single empty message when none is usable. An error
// means the browser side is gone.
func checkWallpaper(targets []*watchTarget, lastID *string, sent *bool) error {
	fd, w, ok := openWallpaper(targets)
	if ok && *sent && w.id == *lastID {
		unix.Close(fd)
		return nil
	}
	if ok {
		data := make([]byte, w.size)
		loaded := readExact(fd, data)
		unix.Close(fd)
		if loaded {
			if err := sendWallpaper(w, data); err != nil {
				return err
			}
			*lastID, *sent = w.id, true
			return nil
		}
	}
	if *sent && *lastID == "" {
		return nil
	}
	if err := send([]byte(`{"protocol":"omafox","version":1,"action":"wallpaper","id":"","count":0}`)); err != nil {
		return err
	}
	*lastID, *sent = "", true
	return nil
}

// consumeEvents drains the inotify descriptor, marking the targets the
// events touch.
func consumeEvents(fd int, targets []*watchTarget) error {
	buffer := make([]byte, eventBufferBytes)
	for {
		n, err := unix.Read(fd, buffer)
		if err == unix.EINTR {
			continue
		}
		if err == unix.EAGAIN {
			return nil
		}
		if err != nil || n <= 0 {
			return fmt.Errorf("inotify read failed")
		}
		for offset := 0; offset+unix.SizeofInotifyEvent <= n; {
			wd := int(int32(binary.NativeEndian.Uint32(buffer[offset:])))
			mask := binary.NativeEndian.Uint32(buffer[offset+4:])
			nameLen := int(binary.NativeEndian.Uint32(buffer[offset+12:]))
			nameStart := offset + unix.SizeofInotifyEvent
			name, _, _ := bytes.Cut(buffer[nameStart:nameStart+nameLen], []byte{0})
			for _, t := range targets {
				if mask&unix.IN_Q_OVERFLOW != 0 {
					t.changed = true
				}
				if t.wd < 0 || wd != t.wd {
					continue
				}
				if mask&(unix.IN_DELETE_SELF|unix.IN_MOVE_SELF|unix.IN_UNMOUNT|unix.IN_IGNORED) != 0 {
					t.lost = true
				}
				if nameLen > 0 && string(name) == t.filename {
					t.changed = true
					if mask&(unix.IN_DELETE|unix.IN_MOVED_FROM) != 0 {
						t.removed = true
					}
				}
			}
			offset = nameStart + nameLen
		}
	}
}

// syncCommand is the omafire binary to run on a theme swap, or "" when
// omafire isn't set up for this user (its theme-set hook is what setup
// installs).
func syncCommand() string {
	if command := os.Getenv("OMAFIRE_SYNC_COMMAND"); command != "" {
		return command
	}
	home := os.Getenv("HOME")
	if home == "" {
		return ""
	}
	if _, err := os.Stat(home + "/.config/omarchy/hooks/theme-set.d/omafire"); err != nil {
		return ""
	}
	return "/usr/bin/omafire"
}

// startSyncer runs `omafire sync` once per request, one at a time; requests
// made while one runs collapse into one more run, so the last theme wins.
func startSyncer(command string) func() {
	requests := make(chan struct{}, 1)
	go func() {
		for range requests {
			cmd := exec.Command(command, "sync")
			cmd.Env = append(os.Environ(), "OMAFIRE_SKIP_VERSION_CHECK=1")
			// (nil: /dev/null. Our stdout is the browser's message channel.)
			cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
			_ = cmd.Run()
		}
	}()
	return func() {
		select {
		case requests <- struct{}{}:
		default:
		}
	}
}

func main() {
	statePath := os.Getenv("OMAFIRE_STATE_FILE")
	if statePath == "" {
		if home := os.Getenv("HOME"); home != "" {
			statePath = home + "/.local/state/omafire/theme.json"
		}
	}
	theme, ok := newTarget(statePath)
	if statePath == "" || !ok {
		fmt.Fprintln(os.Stderr, "omafire native host: invalid state path")
		os.Exit(1)
	}
	// targets[0] is the theme state file, then the wallpaper candidates,
	// then (when omafire is set up) Omarchy's current theme name.
	wallpapers := wallpaperTargets()
	targets := append([]*watchTarget{theme}, wallpapers...)
	isWallpaper := func(index int) bool { return index > 0 && index <= len(wallpapers) }
	var requestSync func()
	if command := syncCommand(); command != "" {
		namePath := os.Getenv("OMAFIRE_THEME_NAME_FILE")
		if namePath == "" && os.Getenv("HOME") != "" {
			namePath = os.Getenv("HOME") + "/.local/state/omarchy/current/theme.name"
		}
		if name, ok := newTarget(namePath); namePath != "" && ok {
			targets = append(targets, name)
			requestSync = startSyncer(command)
		}
	}

	signal.Ignore(syscall.SIGPIPE)
	inotify, err := unix.InotifyInit1(unix.IN_CLOEXEC | unix.IN_NONBLOCK)
	if err != nil {
		fmt.Fprintln(os.Stderr, "omafire native host: inotify initialization failed")
		os.Exit(1)
	}
	defer unix.Close(inotify)

	var lastMessage []byte
	lastWallpaperID, wallpaperSent, wallpaperPending := "", false, true
	for {
		themeWatchMissing, wallpaperWatched := false, false
		for index, t := range targets {
			added := false
			if t.wd < 0 {
				if wd, err := unix.InotifyAddWatch(inotify, t.directory, watchMask); err == nil {
					t.wd, added = wd, true
				}
			}
			if t.wd < 0 {
				themeWatchMissing = themeWatchMissing || index == 0
				continue
			}
			wallpaperWatched = wallpaperWatched || isWallpaper(index)
			if !added || !isWallpaper(index) && index > 0 {
				continue
			}
			if index == 0 && checkTheme(theme.path, &lastMessage) != nil {
				return
			}
			wallpaperPending = true
		}
		if wallpaperPending {
			wallpaperPending = false
			if checkWallpaper(wallpapers, &lastWallpaperID, &wallpaperSent) != nil {
				return
			}
		}

		fds := []unix.PollFd{{Fd: 0, Events: unix.POLLIN}, {Fd: int32(inotify), Events: unix.POLLIN}}
		// Retry while the theme directory, or every wallpaper directory, is
		// missing. An absent fallback directory alone does not keep the host
		// awake; it is retried whenever the host wakes anyway.
		timeout := -1
		if themeWatchMissing || len(wallpapers) > 0 && !wallpaperWatched {
			timeout = retryIntervalMS
		}
		if _, err := unix.Poll(fds, timeout); err == unix.EINTR {
			continue
		} else if err != nil {
			return
		}
		if fds[0].Revents&(unix.POLLHUP|unix.POLLERR|unix.POLLNVAL) != 0 {
			return
		}
		if fds[0].Revents&unix.POLLIN != 0 {
			var discard [4096]byte
			n, err := unix.Read(0, discard[:])
			for err == unix.EINTR {
				n, err = unix.Read(0, discard[:])
			}
			if err != nil || n <= 0 {
				return
			}
		}
		if fds[1].Revents&unix.POLLIN != 0 {
			if consumeEvents(inotify, targets) != nil {
				return
			}
			themeChanged := theme.changed
			if theme.removed {
				lastMessage = nil
			}
			for index, t := range targets {
				if isWallpaper(index) && (t.changed || t.lost) {
					wallpaperPending = true
				}
				if index > len(wallpapers) && t.changed && !t.removed {
					requestSync()
				}
				if t.lost {
					t.wd = -1
					if index == 0 {
						lastMessage = nil
					}
				}
				t.changed, t.removed, t.lost = false, false, false
			}
			if themeChanged {
				if checkTheme(theme.path, &lastMessage) != nil {
					return
				}
				wallpaperPending = true
			}
		}
		if fds[1].Revents&(unix.POLLERR|unix.POLLHUP|unix.POLLNVAL) != 0 {
			return
		}
	}
}
