package main

// The Omarchy shell plugin (DEC-30): the package installs it to
// /usr/share/omafire/shell/omafire; setup links it into the user's plugin
// directory, where the shell finds third-party plugins, and enables it
// once. A user who disables it keeps it disabled across setups; a copy or
// link of their own at that path is never touched.

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"golang.org/x/sys/unix"
)

const shellPluginID = "omafire"

var (
	shellPluginSource string
	shellPluginLink   string
)

func initShellPluginPaths(home string) {
	shellPluginSource = envOr("OMAFIRE_SHELL_PLUGIN_SOURCE", "/usr/share/omafire/shell/"+shellPluginID)
	shellPluginLink = home + "/.config/omarchy/plugins/" + shellPluginID
}

// shellPluginLinked: the link exists and is ours.
func shellPluginLinked() bool {
	target, err := os.Readlink(shellPluginLink)
	return err == nil && target == shellPluginSource
}

// runQuiet runs a command with its output discarded: the shell's own
// messages mean nothing to someone running setup.
func runQuiet(argv []string) int {
	cmd := exec.Command(argv[0], argv[1:]...)
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &exit):
		return exit.ExitCode()
	}
	return 127
}

// omarchyShellCommand runs `omarchy-shell` from PATH or the Omarchy tree.
func omarchyShellCommand(args ...string) int {
	for _, dir := range []string{"", os.Getenv("OMARCHY_PATH"), "/usr/share/omarchy"} {
		bin := "omarchy-shell"
		if dir != "" {
			bin = dir + "/bin/omarchy-shell"
			if unix.Access(bin, unix.X_OK) != nil {
				continue
			}
		}
		if status := runQuiet(append([]string{bin}, args...)); status != 127 {
			return status
		}
	}
	return 127
}

func setupShellPlugin() {
	if !isDir(shellPluginSource) || !isDir(filepath.Dir(filepath.Dir(shellPluginLink))) {
		return // no packaged plugin, or no Omarchy config to add it to
	}
	switch {
	case shellPluginLinked():
		fmt.Printf("Omarchy shell plugin: %s\n", shellPluginLink)
		return
	case pathExists(shellPluginLink) || pathIsSymlink(shellPluginLink):
		fmt.Printf("Left your own %s alone; the packaged plugin is %s\n", shellPluginLink, shellPluginSource)
		return
	}
	mkdirP700(filepath.Dir(shellPluginLink))
	if err := os.Symlink(shellPluginSource, shellPluginLink); err != nil {
		fmt.Fprintf(os.Stderr, "%s: could not link the shell plugin: %v\n", programName, err)
		return
	}
	fmt.Printf("Linked the Omarchy shell plugin: %s\n", shellPluginLink)

	// The shell rescans on its own, but maybe not before we ask.
	enable := []string{"omarchy", "plugin", "enable", shellPluginID}
	status := runQuiet(enable)
	if status != 0 {
		omarchyShellCommand("shell", "rescanPlugins")
		status = runQuiet(enable)
	}
	if status == 0 {
		fmt.Println("Enabled it in the bar (Omafire, right side).")
	} else {
		fmt.Println("Could not reach the shell to enable it; run: omarchy plugin enable omafire")
	}
}

func removeShellPlugin() {
	if !shellPluginLinked() {
		return
	}
	runQuiet([]string{"omarchy", "plugin", "disable", shellPluginID})
	unix.Unlink(shellPluginLink)
	fmt.Printf("Removed the Omarchy shell plugin: %s\n", shellPluginLink)
}
