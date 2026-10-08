package main

import (
	"strings"

	"golang.org/x/sys/unix"
)

const (
	ffBridgeMarker = "/* OMAFIRE FIREFOX BRIDGE MANAGED FILE */"
	ffCSSBegin     = "/* BEGIN OMAFIRE FIREFOX BRIDGE */"
	ffCSSEnd       = "/* END OMAFIRE FIREFOX BRIDGE */"
	ffPrefsBegin   = "// BEGIN OMAFIRE FIREFOX BRIDGE"
	ffPrefsEnd     = "// END OMAFIRE FIREFOX BRIDGE"
	ffRadiusMarker = "/* OMAFIRE GENERATED GEOMETRY — written by omafire sync; do not edit. */"
)

// The markers' names as omafox (<= 0.2.0), recognised so an upgrade
// replaces them in place and remove still finds them. Never written.
var legacyMarkers = map[string]string{
	ffBridgeMarker: "/* OMAFOX FIREFOX BRIDGE MANAGED FILE */",
	ffCSSBegin:     "/* BEGIN OMAFOX FIREFOX BRIDGE */",
	ffCSSEnd:       "/* END OMAFOX FIREFOX BRIDGE */",
	ffPrefsBegin:   "// BEGIN OMAFOX FIREFOX BRIDGE",
	ffPrefsEnd:     "// END OMAFOX FIREFOX BRIDGE",
	ffRadiusMarker: "/* OMAFOX GENERATED GEOMETRY — written by omafox sync; do not edit. */",
}

// markerIs: a line is a marker when it is the marker or its omafox name.
func markerIs(line, marker string) bool {
	legacy, ok := legacyMarkers[marker]
	return line == marker || ok && line == legacy
}

// validateManagedBlock refuses a file whose markers are not one ordered
// begin/end pair (or none), and anything that is not a readable regular file.
func validateManagedBlock(path, begin, end, what string) {
	if pathIsSymlink(path) {
		fail("refusing to replace symlinked %s: %s", what, path)
	}
	if pathExists(path) && !isRegularFile(path) {
		fail("%s path is not a regular file: %s", what, path)
	}
	contents, ok := readFile(path)
	if !ok {
		// An existing file that can't be read (over maxFileBytes, or an I/O
		// or permission error) must not be taken for an empty one: the
		// managed block would be written over the user's content.
		if pathExists(path) {
			fail("could not read %s (unreadable, or larger than %d MB); refusing to rewrite it: %s",
				what, maxFileBytes>>20, path)
		}
		return
	}
	begins, ends, beginLine, endLine := 0, 0, 0, 0
	for i, line := range lines(contents) {
		if markerIs(line, begin) {
			begins++
			beginLine = i
		}
		if markerIs(line, end) {
			ends++
			endLine = i
		}
	}
	if begins != ends || begins > 1 || begins == 1 && beginLine >= endLine {
		fail("malformed Omafire markers in %s: %s", what, path)
	}
}

// spliceManagedBlock rewrites contents with the managed block (begin..end
// inclusive) replaced by block; every kept line ends in a newline.
func spliceManagedBlock(contents, begin, end, block string) string {
	var out strings.Builder
	managed := false
	for _, line := range lines(contents) {
		switch {
		case markerIs(line, begin):
			managed = true
			out.WriteString(block)
		case markerIs(line, end):
			managed = false
		case !managed:
			out.WriteString(line)
			out.WriteByte('\n')
		}
	}
	return out.String()
}

func managedBlockPresent(path, begin, end string) bool {
	contents, ok := readFile(path)
	if !ok {
		return false
	}
	foundBegin, foundEnd := false, false
	for _, line := range lines(contents) {
		foundBegin = foundBegin || markerIs(line, begin)
		foundEnd = foundEnd || markerIs(line, end)
	}
	return foundBegin && foundEnd
}

func managedMarkerPresent(path, begin, end string) bool {
	contents, ok := readFile(path)
	if !ok {
		return false
	}
	for _, line := range lines(contents) {
		if markerIs(line, begin) || markerIs(line, end) {
			return true
		}
	}
	return false
}

func firstLineIs(path, marker string) bool {
	contents, ok := readFile(path)
	return ok && markerIs(firstLine(contents), marker)
}

// installManagedBlock splices block into path, replacing any existing
// managed block. userChrome.css gets the block prepended (as upstream did);
// user.js gets it appended so user prefs keep their order.
func installManagedBlock(path, begin, end, block string, prepend bool, what string) {
	validateManagedBlock(path, begin, end, what)
	contents, _ := readFile(path)
	rest := spliceManagedBlock(contents, begin, end, "")
	if prepend {
		atomicWrite(path, block+rest, 0o600, true)
	} else {
		atomicWrite(path, rest+block, 0o600, true)
	}
}

// replaceManagedBlockInPlace rewrites an existing managed block where it
// stands, so a tracked file keeps its import order. No-op when absent.
func replaceManagedBlockInPlace(path, begin, end, block, what string) {
	if !pathExists(path) {
		return
	}
	validateManagedBlock(path, begin, end, what)
	if !managedBlockPresent(path, begin, end) {
		return
	}
	if contents, ok := readFile(path); ok {
		atomicWrite(path, spliceManagedBlock(contents, begin, end, block), 0o600, true)
	}
}

// removeManagedBlock strips the managed block, deleting the file when
// nothing else remains.
func removeManagedBlock(path, begin, end, what string) {
	if !pathExists(path) {
		return
	}
	validateManagedBlock(path, begin, end, what)
	if !managedBlockPresent(path, begin, end) {
		return
	}
	contents, _ := readFile(path)
	if rest := spliceManagedBlock(contents, begin, end, ""); rest != "" {
		atomicWrite(path, rest, 0o600, true)
	} else {
		// Nothing but our block: the file is ours, nothing to back up.
		unix.Unlink(path)
		fsyncParent(path)
	}
}
