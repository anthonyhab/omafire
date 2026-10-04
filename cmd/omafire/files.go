package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// Files larger than this are never read, so never taken for empty ones.
const maxFileBytes = 4 << 20

// Backup sets kept under the state directory (setup and remove only).
const maxBackupSets = 10

func isRegularFile(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.Mode().IsRegular()
}

func isDir(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.IsDir()
}

// pathExists is true for anything at path, a dangling symlink included.
func pathExists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func pathIsSymlink(path string) bool {
	st, err := os.Lstat(path)
	return err == nil && st.Mode()&os.ModeSymlink != 0
}

// readFile reads a small regular file, never through a symlink.
func readFile(path string) (string, bool) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return "", false
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Size() > maxFileBytes {
		return "", false
	}
	data := make([]byte, st.Size())
	if _, err := io.ReadFull(f, data); err != nil {
		return "", false
	}
	return string(data), true
}

// lines splits text the way the managed-block code walks it: a final
// newline ends the last line rather than starting an empty one.
func lines(text string) []string {
	if text == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(text, "\n"), "\n")
}

func firstLine(text string) string {
	line, _, _ := strings.Cut(text, "\n")
	return line
}

// atomicWrite replaces path through a same-directory temp file and a rename.
// preserveMode keeps an existing file's permissions (managed user files);
// otherwise mode is applied exactly (owned payload and state files).
func atomicWrite(path, data string, mode os.FileMode, preserveMode bool) {
	// Skip the write when the target already holds this content: theme hooks
	// fire often enough that identical rewrites would only add inotify noise
	// and profile-sync churn.
	if existing, ok := readFile(path); ok && existing == data {
		return
	}
	// A user's own file is copied aside before its first change in a setup
	// or remove run.
	if preserveMode {
		backupUserFile(path)
	}

	f, err := os.CreateTemp(filepath.Dir(path), ".omafire.*")
	if err != nil {
		fail("could not create temp file for %s", path)
	}
	tmp := f.Name()
	abandon := func(format string) {
		f.Close()
		os.Remove(tmp)
		fail(format, path)
	}
	if preserveMode {
		if st, err := os.Stat(path); err == nil {
			mode = st.Mode().Perm()
		}
	}
	if f.Chmod(mode) != nil {
		abandon("could not set mode on temp file for %s")
	}
	if _, err := f.WriteString(data); err != nil {
		abandon("could not write temp file for %s")
	}
	// On disk (a profile outside profile-sync-daemon), a crash between the
	// rename and writeback could leave an empty file where the old one was:
	// flush the data before the rename, and the rename after it.
	if err := f.Sync(); err != nil && !errors.Is(err, unix.EINVAL) {
		abandon("could not flush temp file for %s")
	}
	f.Close()
	if os.Rename(tmp, path) != nil {
		os.Remove(tmp)
		fail("could not replace %s", path)
	}
	fsyncParent(path)
}

func fsyncParent(path string) {
	fd, err := unix.Open(filepath.Dir(path), unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return
	}
	unix.Fsync(fd) // best effort: some filesystems refuse directory fsync
	unix.Close(fd)
}

// mkdirP700 is `install -d -m 700`: every missing component is created 0700.
func mkdirP700(path string) {
	mk := func(dir string) {
		if err := unix.Mkdir(dir, 0o700); err != nil && err != unix.EEXIST {
			fail("could not create directory: %s", path)
		}
	}
	for i := 1; i < len(path); i++ {
		if path[i] == '/' {
			mk(path[:i])
		}
	}
	mk(path)
}

// removeTree is rm -r that never follows a symlink: links inside are
// unlinked, and a link given as dir is left alone.
func removeTree(dir string) {
	st, err := os.Lstat(dir)
	if err != nil || !st.IsDir() {
		return
	}
	entries, err := readOwnDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		child := dir + "/" + entry.Name()
		if entry.IsDir() {
			removeTree(child)
		} else {
			unix.Unlink(child)
		}
	}
	unix.Rmdir(dir)
}

// readOwnDir lists a directory omafire made. One left unreadable (mode
// 0311, say: searchable, so its files still open) gets back the 0700 that
// mkdirP700 gives every directory it makes, and is read again. An error
// that remains is returned, never an empty listing that a removal would
// take for an empty directory.
func readOwnDir(dir string) ([]os.DirEntry, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrPermission) && os.Chmod(dir, 0o700) == nil {
		entries, err = os.ReadDir(dir)
	}
	return entries, err
}

// ------------------------------------------------------------- run safety

// The lock descriptor stays open, and the lock held, until exit.
var lockFD = -1

// acquireLock allows one omafire at a time per user: the theme hook's sync
// can fire while a setup or remove is rewriting the same profile files.
func acquireLock() {
	mkdirP700(stateDir)
	lock := stateDir + "/lock"
	fd, err := unix.Open(lock, unix.O_RDWR|unix.O_CREAT|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
	if err != nil {
		fail("could not open lock file: %s", lock)
	}
	for {
		err := unix.Flock(fd, unix.LOCK_EX)
		if err == nil {
			break
		}
		if err != unix.EINTR {
			fail("could not lock %s", lock)
		}
	}
	lockFD = fd
}

// Backups: setup and remove copy each user-owned file (user.js,
// userChrome.css, userContent.css) to
// <state>/backups/<time>-<command>-<pid>/<absolute path> before its first
// change, so a bad run can be undone by copying the file back. The state
// directory is outside the profile, so profile-sync-daemon's tmpfs never
// holds the only copy. The newest maxBackupSets sets are kept.
var (
	backupCommand string
	backupDir     string
	backedUp      = map[string]bool{}
)

func pruneBackups(root string) {
	entries, _ := os.ReadDir(root) // sorted by name, oldest first
	var sets []string
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			sets = append(sets, entry.Name())
		}
	}
	for i := 0; i+maxBackupSets < len(sets); i++ {
		removeTree(root + "/" + sets[i])
	}
}

func backupUserFile(path string) {
	if backupCommand == "" || !strings.HasPrefix(path, "/") || !isRegularFile(path) || backedUp[path] {
		return
	}
	data, ok := readFile(path)
	if !ok {
		fail("could not read %s to back it up; nothing was changed", path)
	}
	if backupDir == "" {
		root := stateDir + "/backups"
		stamp := time.Now().Format("20060102-150405")
		backupDir = fmt.Sprintf("%s/%s-%s-%d", root, stamp, backupCommand, os.Getpid())
		mkdirP700(backupDir)
		pruneBackups(root)
	}
	dest := backupDir + path
	mkdirP700(filepath.Dir(dest))
	atomicWrite(dest, data, 0o600, false)
	backedUp[path] = true
}

// runCommand runs argv with our stdin and stderr, returning its exit status
// (nonzero when it cannot run) and, when capture is set, its stdout.
func runCommand(argv []string, capture bool) (int, string) {
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Stdin = os.Stdin
	cmd.Stderr = os.Stderr
	var out bytes.Buffer
	if capture {
		cmd.Stdout = &out
	} else {
		cmd.Stdout = os.Stdout
	}
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return 0, out.String()
	case errors.As(err, &exit):
		return exit.ExitCode(), out.String()
	default:
		return 127, ""
	}
}

// leftoverTempAge keeps the sweep off a write that is still in flight (runs
// are serialised by the lock, but a hand-run omafire is not our only writer).
const leftoverTempAge = time.Minute

var leftoverTemp = regexp.MustCompile(`^\.omafire\.([0-9]+|(new|old)\.[0-9]+)$`)

// sweepTemps removes what an interrupted run left in dir: atomicWrite's
// .omafire.<digits> temp files (full copies of user.js, a stylesheet or
// theme.json) and .omafire.new/old.<digits> payload stages that died before
// their ownership marker was written. Names are the ones omafire generates.
func sweepTemps(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !leftoverTemp.MatchString(e.Name()) {
			continue
		}
		path := dir + "/" + e.Name()
		info, err := os.Lstat(path)
		if err != nil || time.Since(info.ModTime()) < leftoverTempAge {
			continue
		}
		if e.IsDir() {
			os.RemoveAll(path)
		} else {
			os.Remove(path)
		}
	}
}

// sweepLeftoverTemps covers every directory omafire writes into.
func sweepLeftoverTemps() {
	sweepTemps(stateDir)
	for _, list := range []struct{ file, root string }{{ffProfilesFile, ffRoot}, {zenProfilesFile, zenRoot}} {
		if !isRegularFile(list.file) {
			continue
		}
		for _, profile := range listProfiles(list.file, list.root) {
			if profileWritable(profile, "", false) {
				sweepTemps(profile)
				sweepTemps(profile + "/chrome")
			}
		}
	}
}
