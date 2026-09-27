package main

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

// listProfiles parses the [ProfileN] sections of a profiles.ini, returning
// each Path made absolute against root when IsRelative, without duplicates.
func listProfiles(profilesFile, root string) []string {
	contents, ok := readFile(profilesFile)
	if !ok {
		return nil
	}
	var profiles []string
	seen := map[string]bool{}
	inProfile, path, relative := false, "", true
	flush := func() {
		if !inProfile || path == "" {
			return
		}
		full := path
		if relative {
			full = root + "/" + path
		}
		if !seen[full] {
			seen[full] = true
			profiles = append(profiles, full)
		}
	}
	for _, line := range lines(contents) {
		line = strings.TrimSuffix(line, "\r")
		if len(line) >= 2 && line[0] == '[' && line[len(line)-1] == ']' {
			flush()
			inProfile = strings.HasPrefix(line[1:], "Profile")
			path, relative = "", true
		} else if key, value, found := strings.Cut(line, "="); inProfile && found {
			switch cTrim(key) {
			case "Path":
				path = cTrim(value)
			case "IsRelative":
				relative = cTrim(value) != "0"
			}
		}
	}
	flush()
	return profiles
}

// cTrim trims C's isspace set, and only that.
func cTrim(s string) string {
	return strings.Trim(s, " \t\n\v\f\r")
}

// profile-sync-daemon keeps a synced profile in tmpfs: the profile path
// becomes a symlink into /run/user/<uid>/psd/, and its on-disk copy is
// renamed <profile>-backup (with -back-ovfs and -backup-crashrecovery-*
// siblings). Only the symlinked path is the live profile; the copies are
// psd's, and writing them would be overwritten or, worse, restored over the
// live profile after a crash.
func psdCopyName(profile string) bool {
	base := profile[strings.LastIndexByte(profile, '/')+1:]
	for _, suffix := range []string{"-backup", "-back-ovfs"} {
		if len(base) > len(suffix) && strings.HasSuffix(base, suffix) {
			return true
		}
	}
	return strings.Contains(base, "-backup-crashrecovery-")
}

func profileInPSD(profile string) bool {
	if !pathIsSymlink(profile) {
		return false
	}
	target, err := os.Readlink(profile)
	return err == nil && strings.Contains(target, "/psd/")
}

// Profiles written this run that profile-sync-daemon manages.
var psdProfiles = 0

// profileWritable says whether a profiles.ini entry may be written. A
// symlink whose target is gone is a profile-sync-daemon profile while psd is
// stopped or mid-restore: nothing is ever created through it.
func profileWritable(profile, browser string, report bool) bool {
	var reason string
	switch {
	case psdCopyName(profile):
		reason = fmt.Sprintf("Skipped %s profile-sync-daemon copy (listed in profiles.ini?): %s", browser, profile)
	case isDir(profile):
		return true
	case pathIsSymlink(profile):
		reason = fmt.Sprintf("Skipped offline %s profile (a symlink to nothing; is profile-sync-daemon stopped?): %s", browser, profile)
	default:
		reason = fmt.Sprintf("Skipped missing %s profile: %s", browser, profile)
	}
	if report {
		fmt.Fprintln(os.Stderr, reason)
	}
	return false
}

// profileRunning: Firefox keeps <profile>/lock, a symlink to
// "<host>:+<pid>", while it runs the profile.
func profileRunning(profile string) bool {
	target, err := os.Readlink(profile + "/lock")
	if err != nil {
		return false
	}
	plus := strings.LastIndexByte(target, '+')
	if plus < 0 {
		return false
	}
	pid, _ := leadingInt(target[plus+1:])
	if pid <= 0 {
		return false
	}
	err = unix.Kill(int(pid), 0)
	return err == nil || err == unix.EPERM
}

func noteWrittenProfile(profile, browser string) {
	if profileInPSD(profile) {
		psdProfiles++
	}
	if profileRunning(profile) {
		fmt.Printf("  %s is running with this profile; restart it to load the changes.\n", browser)
	}
}

// psdResync asks psd to write tmpfs back to disk now rather than at its next
// hourly resync, so a crash in between cannot lose a setup or remove.
func psdResync() {
	if psdProfiles == 0 || envOr("OMAFIRE_PSD_RESYNC", "1") == "0" {
		return
	}
	if status, _ := runCommand([]string{"systemctl", "--user", "start", "psd-resync.service"}, false); status == 0 {
		fmt.Println("Asked profile-sync-daemon to write the changes to disk.")
	} else {
		fmt.Println("profile-sync-daemon manages a changed profile; it writes it to disk at its next resync.")
	}
}

// leadingInt parses like strtol: leading space, a sign, then digits. digits
// is false (and the value 0) when there are none.
func leadingInt(s string) (value int64, digits bool) {
	s = strings.TrimLeft(s, " \t\n\v\f\r")
	negative := false
	if s != "" && (s[0] == '+' || s[0] == '-') {
		negative = s[0] == '-'
		s = s[1:]
	}
	var n int64
	for i := 0; i < len(s) && s[i] >= '0' && s[i] <= '9'; i++ {
		digits = true
		if n < (1<<62)/10 {
			n = n*10 + int64(s[i]-'0')
		}
	}
	if negative {
		n = -n
	}
	return n, digits
}
