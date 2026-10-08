package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// restore: put back the files a setup or remove run changed, but
// only those still holding what that run wrote, so an edit made since is never
// overwritten. A run records, next to its backups, the content hash of every
// file it backed up as it stood when the run ended (wroteFile); restore
// compares the file now against it.

const wroteFile = ".wrote"

func contentSum(path string) string {
	data, ok := readFile(path)
	if !ok {
		return "-" // absent
	}
	sum := sha256.Sum256([]byte(data))
	return hex.EncodeToString(sum[:])
}

// recordWrote lists, per backed-up file, what the run left in it.
func recordWrote() {
	if backupDir == "" {
		return
	}
	var out strings.Builder
	paths := make([]string, 0, len(backedUp))
	for path := range backedUp {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		fmt.Fprintf(&out, "%s %s\n", contentSum(path), path)
	}
	atomicWrite(backupDir+"/"+wroteFile, out.String(), 0o600, false)
}

// newestBackupSet is the last set by name (names start with their timestamp).
func newestBackupSet(root string) string {
	entries, _ := os.ReadDir(root)
	for i := len(entries) - 1; i >= 0; i-- {
		if entries[i].IsDir() && !strings.HasPrefix(entries[i].Name(), ".") {
			return entries[i].Name()
		}
	}
	return ""
}

type restoreResult struct{ restored, kept, same []string }

// restoreSet restores one set's files that still equal what its run wrote.
func restoreSet(dir string) (restoreResult, error) {
	var res restoreResult
	wrote, ok := readFile(dir + "/" + wroteFile)
	if !ok {
		return res, fmt.Errorf("this set predates `restore` (no %s record): copy files back by hand from %s", wroteFile, dir)
	}
	sums := map[string]string{}
	for _, line := range lines(wrote) {
		if sum, path, found := strings.Cut(line, " "); found {
			sums[path] = sum
		}
	}
	var files []string
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() && p != dir+"/"+wroteFile {
			files = append(files, strings.TrimPrefix(p, dir))
		}
		return nil
	})
	sort.Strings(files)
	for _, path := range files {
		want, recorded := sums[path]
		old, _ := readFile(dir + path)
		switch {
		case !recorded || contentSum(path) != want:
			res.kept = append(res.kept, path)
		case old == mustRead(path):
			res.same = append(res.same, path)
		default:
			atomicWrite(path, old, 0o600, true)
			res.restored = append(res.restored, path)
		}
	}
	return res, nil
}

func mustRead(path string) string {
	data, _ := readFile(path)
	return data
}

func cmdRestore(args []string) {
	if len(args) > 1 {
		fail("restore takes at most one backup set")
	}
	root := stateDir + "/backups"
	set := newestBackupSet(root)
	if len(args) == 1 {
		set = filepath.Base(args[0])
	}
	if set == "" || !isDir(root+"/"+set) {
		fail("no backup set to restore (looked in %s)", root)
	}
	backupCommand = "restore" // what it replaces is backed up too, so a restore can be undone
	res, err := restoreSet(root + "/" + set)
	if err != nil {
		fail("%v", err)
	}
	for _, p := range res.restored {
		fmt.Printf("Restored %s\n", p)
	}
	for _, p := range res.same {
		fmt.Printf("Already as before: %s\n", p)
	}
	for _, p := range res.kept {
		fmt.Printf("Kept %s: it changed since that run (diff it against %s/%s%s, copy by hand if you want it back)\n", p, root, set, p)
	}
	if backupDir != "" {
		recordWrote()
		fmt.Printf("Backed up what it replaced to %s\n", backupDir)
	}
	if len(res.restored) > 0 {
		psdResync()
	}
	fmt.Printf("%d restored, %d already as before, %d kept (changed since)\n", len(res.restored), len(res.same), len(res.kept))
}
