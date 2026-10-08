package main

// get, set, reset and watch: ~/.config/omafire/config.json.

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"git.hab.rip/habibe/omafire/config"
	"golang.org/x/sys/unix"
)

var configFile string

func initConfigPath(home string) {
	configFile = envOr("OMAFIRE_CONFIG", envOr("XDG_CONFIG_HOME", home+"/.config")+"/omafire/config.json")
}

// loadConfig reads the file; a missing one is empty. A file that is not
// JSON fails: set would otherwise overwrite what the user was editing.
func loadConfig() (config.File, bool) {
	data, ok := readFile(configFile)
	if !ok {
		if pathExists(configFile) {
			fail("could not read %s", configFile)
		}
		return config.File{}, false
	}
	file, warnings, err := config.Decode([]byte(data))
	if err != nil {
		fail("%s: %v", configFile, err)
	}
	for _, w := range warnings {
		fmt.Fprintf(os.Stderr, "%s: %s: %s\n", programName, configFile, w)
	}
	return file, true
}

// configStatus is the Settings line of `omafire status`.
func configStatus() string {
	data, ok := readFile(configFile)
	if !ok {
		return "defaults, no file"
	}
	file, _, err := config.Decode([]byte(data))
	if err != nil {
		return "unreadable: " + err.Error()
	}
	return fmt.Sprintf("%d set", len(file))
}

func lookupSetting(key string) config.Setting {
	s, ok := config.Lookup(key)
	if !ok {
		var keys []string
		for _, s := range config.Settings {
			keys = append(keys, s.Key)
		}
		fail("unknown setting: %s (settings: %s)", key, strings.Join(keys, ", "))
	}
	return s
}

func cmdGet(args []string) {
	asJSON := len(args) > 0 && args[0] == "--json"
	if asJSON {
		args = args[1:]
	}
	if len(args) > 1 || (asJSON && len(args) > 0) {
		fail("usage: omafire get [--json | <setting>]")
	}
	file, _ := loadConfig()
	values := file.Effective()
	switch {
	case asJSON:
		os.Stdout.Write(config.EncodeEffective(values))
	case len(args) == 1:
		fmt.Println(config.Format(values[lookupSetting(args[0]).Key]))
	default:
		for _, s := range config.Settings {
			fmt.Printf("%s=%s\n", s.Key, config.Format(values[s.Key]))
		}
	}
}

func saveConfig(file config.File) {
	mkdirP700(filepath.Dir(configFile))
	atomicWrite(configFile, string(file.Encode()), 0o644, false)
}

// set <setting> <value>...: validated, all or nothing. --if-missing writes
// only when there is no file yet: Firefox seeds it from a profile's prefs.
func cmdSet(args []string) {
	ifMissing := len(args) > 0 && args[0] == "--if-missing"
	if ifMissing {
		args = args[1:]
	}
	if len(args) == 0 || len(args)%2 != 0 {
		fail("usage: omafire set [--if-missing] <setting> <value> [<setting> <value>]...")
	}
	updates := config.File{}
	for i := 0; i < len(args); i += 2 {
		v, err := lookupSetting(args[i]).Parse(args[i+1])
		if err != nil {
			fail("%v", err)
		}
		updates[args[i]] = v
	}
	acquireLock()
	file, exists := loadConfig()
	if ifMissing && exists {
		return
	}
	for key, v := range updates {
		file[key] = v
	}
	saveConfig(file)
}

// reset <setting>...: back to the default by leaving the file.
func cmdReset(args []string) {
	if len(args) == 0 {
		fail("usage: omafire reset <setting>...")
	}
	for _, key := range args {
		lookupSetting(key)
	}
	acquireLock()
	file, exists := loadConfig()
	if !exists {
		return
	}
	for _, key := range args {
		delete(file, key)
	}
	saveConfig(file)
}

// watch prints the effective settings as one JSON line now and after every
// change that alters them. A file that does not parse is reported and
// skipped until it does. A sync's new palette prints a "palette" line: sync
// writes theme.json last, after the profiles' palette files. When stdin is a
// pipe (Firefox), its end ends the watch, so a crashed browser does not
// leave one behind.
func cmdWatch(args []string) {
	if len(args) > 0 {
		fail("command 'watch' does not accept arguments")
	}
	dir, name := filepath.Dir(configFile), filepath.Base(configFile)
	mkdirP700(dir)
	fd, err := unix.InotifyInit1(unix.IN_CLOEXEC)
	if err != nil {
		fail("could not start inotify")
	}
	const mask = unix.IN_CLOSE_WRITE | unix.IN_MOVED_TO | unix.IN_MOVED_FROM |
		unix.IN_CREATE | unix.IN_DELETE | unix.IN_DELETE_SELF | unix.IN_MOVE_SELF
	wd := -1
	addWatch := func() {
		if wd >= 0 {
			unix.InotifyRmWatch(fd, uint32(wd))
		}
		mkdirP700(dir)
		w, err := unix.InotifyAddWatch(fd, dir, mask)
		if err != nil {
			fail("could not watch %s", dir)
		}
		wd = w
	}
	addWatch()
	// The state directory is sync's to create and remove's to delete: watch
	// it while it exists, and look for it again every few seconds while not.
	stateWD := -1
	addStateWatch := func() {
		if w, err := unix.InotifyAddWatch(fd, stateDir, unix.IN_CLOSE_WRITE|unix.IN_MOVED_TO); err == nil {
			stateWD = w
		}
	}
	addStateWatch()
	stateName := filepath.Base(stateFile)

	var last string
	lastWarnings := ""
	emit := func() {
		var file config.File
		data, ok := readFile(configFile)
		if ok {
			f, warnings, err := config.Decode([]byte(data))
			if err != nil {
				if msg := err.Error(); msg != lastWarnings {
					fmt.Fprintf(os.Stderr, "%s: %s: %v; keeping the last settings\n", programName, configFile, err)
					lastWarnings = msg
				}
				return
			}
			if joined := strings.Join(warnings, "\n"); joined != lastWarnings {
				for _, w := range warnings {
					fmt.Fprintf(os.Stderr, "%s: %s: %s\n", programName, configFile, w)
				}
				lastWarnings = joined
			}
			file = f
		}
		line := string(config.EncodeEffective(file.Effective()))
		if line == last {
			return
		}
		last = line
		if _, err := os.Stdout.WriteString(line); err != nil {
			os.Exit(0) // the reader is gone
		}
	}
	emit()

	fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
	var st unix.Stat_t
	if unix.Fstat(0, &st) == nil && st.Mode&unix.S_IFMT == unix.S_IFIFO {
		fds = append(fds, unix.PollFd{Fd: 0, Events: unix.POLLIN})
	}
	buf := make([]byte, 64*1024)
	for {
		timeout := -1
		if stateWD < 0 {
			timeout = 3000
			addStateWatch()
		}
		if _, err := unix.Poll(fds, timeout); err != nil {
			if errors.Is(err, unix.EINTR) {
				continue
			}
			fail("poll: %v", err)
		}
		if len(fds) > 1 && fds[1].Revents != 0 {
			if n, _ := unix.Read(0, buf); n <= 0 {
				return
			}
		}
		if fds[0].Revents == 0 {
			continue
		}
		n, err := unix.Read(fd, buf)
		if err != nil {
			continue
		}
		relevant, gone, palette := false, false, false
		for off := 0; off+unix.SizeofInotifyEvent <= n; {
			evWD := int(int32(binary.NativeEndian.Uint32(buf[off:])))
			evMask := binary.NativeEndian.Uint32(buf[off+4:])
			nameLen := int(binary.NativeEndian.Uint32(buf[off+12:]))
			nameStart := off + unix.SizeofInotifyEvent
			evName, _, _ := bytes.Cut(buf[nameStart:nameStart+nameLen], []byte{0})
			off = nameStart + nameLen
			if evMask&unix.IN_Q_OVERFLOW != 0 {
				relevant = true
			}
			if evWD == stateWD {
				if evMask&unix.IN_IGNORED != 0 {
					stateWD = -1
				} else if string(evName) == stateName {
					palette = true
				}
				continue
			}
			if evWD != wd {
				continue
			}
			if evMask&(unix.IN_DELETE_SELF|unix.IN_MOVE_SELF|unix.IN_UNMOUNT|unix.IN_IGNORED) != 0 {
				gone = true
			}
			if string(evName) == name {
				relevant = true
			}
		}
		if gone {
			addWatch()
			relevant = true
		}
		if relevant {
			emit()
		}
		if palette {
			if _, err := os.Stdout.WriteString("palette\n"); err != nil {
				os.Exit(0)
			}
		}
	}
}
