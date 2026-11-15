# Support

What Omafire supports, what it does not, and how to recover without reading
source.

## What is supported

| | |
|---|---|
| **Firefox** | 159 or newer, with Nova (`browser.nova.enabled`; setup turns it on in the profiles it manages). 159 is the oldest release the layout matrix (`tools/fxlab matrix run`) passes on; it passes on 159.0.1 and 160.0. 156 to 158 may work but are unverified. Later versions are allowed and untested until the matrix passes on them; there is no maximum-version check, so a new Firefox is never blocked, only unverified. |
| **Zen Browser** | Not supported: omafire leaves Zen profiles alone. |
| **Omarchy** | 4 (Quattro) or newer, with Hyprland. Omafire reads the current theme's `colors.toml`. |
| **Packaging** | The Arch package `omafire` (from a release, or `makepkg` on the repository's `PKGBUILD`). Not tested: other distributions, Snap or Flatpak Firefox. |

### Layouts and options

The layout matrix measures 17 cells, all with vertical tabs: both `density`
values (0 and 1) x top or sidebar toolbar x sidebar on the left or right x
expanded or collapsed to the icon rail, plus the compact sidebar. The line
toolbar and horizontal tabs are not in the matrix. Beyond those cells, these
options are exercised on their own (launcher at 900 x 700 and at 125% text
scale in each layout, split view, fullscreen, glass), not in every
combination with each other:

- **Toolbar:** top (horizontal or vertical tabs), sidebar (vertical tabs) or
  line (horizontal tabs). The CLI and the panel keep that pairing; a profile
  set by hand to `omafire.layout` = line with vertical tabs gets the top
  layout's docked row, and sidebar with horizontal tabs Firefox's own
  toolbars.
- **Launcher:** drop, or centred.
- **Sidebar side:** left or right.
- **Zen** (the sidebar layout with the sidebar hidden until reached for).
- **Floating page** (a gap around the page) or flush.
- **Glass** with any opacity, and **split view**, in floating and flush modes.

Intentional limits, not defects:

- **Compact hides the expanded sidebar only.** The collapsed icon rail stays
  visible.
- **Fullscreen** (F11 and a page's video fullscreen) hides the chrome; Omafire
  restores its margins and active-pane cue when you leave it.
- **Small windows.** The launcher keeps its field and results inside a
  900 x 700 window and at 125% text scale; smaller than that is untested.

### Without a blurring compositor

Glass makes the browser translucent over the desktop. On Hyprland, with
`decoration:blur:enabled`, what shows through is blurred. Without compositor
blur you get translucency only: Omafire measures the current theme against
its wallpapers and raises the window's opacity to a floor where text would be
hard to read (`omafire sync` does this on every theme change), so glass stays
legible, but sharper. Glass is off by default.

### What setup checks

`omafire setup` refuses, and changes nothing, when Omarchy's palette cannot be
read (`Quattro palette not found`, `no colour omafire can read`, `Omarchy is
not installed`). `omafire status` shows each profile as `configured`,
`outdated`, `incomplete`, `not configured`, `conflict` (an unrelated
`chrome/omafire` directory) or `theme checkout`. It does not check the Firefox
version or whether Nova is on: on a Firefox older than 159 the chrome theme may
not apply, and the browser keeps its own look. If the theme does
not appear, check the version in `about:support` first.

## Troubleshooting

If a browser does not update after a theme change:

1. Confirm that the `omafire` package is installed.
2. Run `omafire status` and check that the theme state is present and that
   each Firefox profile says `configured`.
3. Run `omafire setup`, followed by `omafire sync`, and restart Firefox.

If that does not fix it, see [Getting help](#getting-help).


## Recovery

A run of `setup`, `sync` or `remove` that stops part way, because it was
killed, the machine lost power or a write failed, leaves every file either as
it was or fully written, never half-written. Your own files and preferences are
not touched. Each case below says what you see and what to do.

- **A run stopped part way.** `omafire status` shows a profile as
  `incomplete`, `outdated` or `not configured`. Run the same command again.
  It finishes the job, leaves finished profiles as they are, and ends in the
  same state as a run that was never interrupted. Hidden `.omafire.<digits>`
  files or `.omafire.new.*` directories may be left in the profile, its
  `chrome/` or `~/.local/state/omafire/`. They are copies, never loaded, and
  safe to delete while no omafire command is running.
- **`refusing to modify unmanaged Firefox payload: <profile>/chrome/omafire`,
  status `conflict`.** That directory is not the packaged theme. If it is
  yours, rename it. If it holds only a few of omafire's own files, a `remove`
  or upgrade by omafire 0.6.7 or older was interrupted while deleting it:
  delete the directory. Then run the command again. Until then setup and
  remove refuse to change any profile.
- **`malformed Omafire markers in Firefox profile file: <path>`.** The
  `BEGIN`/`END OMAFIRE FIREFOX BRIDGE` lines in that file are not one ordered
  pair. Nothing was changed. Delete the stray marker lines, or the whole
  block between them, and run setup again. Until you do, every theme
  change's sync also stops at that profile: profiles after it keep the old
  palette.
- **`refusing to replace symlinked …`, `… is not a regular file` or
  `could not read … larger than 4 MB`.** omafire will not write through a
  symlink, or rewrite a file it cannot read whole. Nothing was changed.
  Replace the link with the file itself, or move the file aside, then run
  setup again.
- **`could not create temp file`, `could not stage` or `could not replace`
  for a profile.** That profile's directory cannot be written (permissions,
  a full disk). Profiles listed before it were configured. Fix the directory
  and run setup again.
- **`Quattro palette not found`, `could not read Quattro palette`,
  `no colour omafire can read` or `Omarchy is not installed`.** Nothing was
  changed (profiles and browsers keep the last palette). Set a theme with
  `omarchy theme set <name>` and run the command again. A `colors.toml` with
  some colours is fine: the missing ones fall back. Check with
  `omafire payload`.
- **Undo a run.** `omafire restore [<set>]` (the newest set by default;
  names are in `~/.local/state/omafire/backups/`) puts back each file that
  setup or remove changed, but only if the file still holds what that run
  left. A file you edited since is listed as kept and not touched. What
  restore replaces is itself backed up, so it can be undone too. Sets
  from earlier releases have no record of what the run wrote: use the next item.
- **Undo one file by hand.** setup and remove copy each of your files to
  `~/.local/state/omafire/backups/<time>-<command>-<pid>/<path>` before
  changing it. Copying it back also discards anything you changed in that
  file since that run, so compare the two first
  (`diff <backup> <file>`).
- **Go back to an earlier release.** Pacman keeps the packages it installed
  (`ls /var/cache/pacman/pkg/omafire-*`), so the previous one is usually
  already on disk. Install its package with
  `sudo pacman -U /var/cache/pacman/pkg/omafire-<version>-x86_64.pkg.tar.zst`,
  then run `omafire setup`. Your own lines in `user.js`,
  `userChrome.css`, `userContent.css` and `customChrome.css` are kept, edits
  made since included. Only the managed blocks and the `omafire/` theme
  change.


## Profile safety

`setup`, `sync` and `remove` only write profiles that `profiles.ini` lists,
and only inside their own marked blocks and the `omafire/` payload.

- **profile-sync-daemon.** A psd profile is written through its symlink
  into tmpfs, never into psd's `-backup`, `-back-ovfs` or
  `-backup-crashrecovery-*` copies. A symlink with nothing behind it (psd
  stopped or mid-restore) is skipped, never written through. After a setup
  or remove, omafire asks psd to resync, so the change reaches disk at once.
- **Backups.** Before setup or remove changes a file that holds your own
  content (`user.js`, `userChrome.css`, `userContent.css`), it copies it to
  `~/.local/state/omafire/backups/<time>-<command>-<pid>/<path>`; the newest
  ten sets are kept. To undo, copy the file back.
- **Atomic writes.** Every file is written to a temporary file, flushed,
  and renamed into place. The theme payload is staged beside the old one
  and swapped in one step.
- **One run at a time.** A lock in `~/.local/state/omafire/` serializes the
  theme hook's syncs with setup and remove.
- **Running browsers** are fine: setup and sync never touch `prefs.js`, and
  they name any profile that needs a restart. `omafire remove` edits
  `prefs.js` only while the profile is closed (see Uninstallation).
- **One bad profile does not stop the others.** `omafire sync` skips a
  profile it refuses (malformed Omafire markers, a symlinked file), names it on
  stderr, updates the rest and `theme.json`, and exits 1 at the
  end. Fix the profile and sync again.


## Getting help

Open an issue on this repository's tracker. Include the output of
`omafire status` and `omafire version`, your Firefox version (`about:support`),
the layout and settings (`omafire get`), and what you expected. Omafire does
not collect logs or report anything by itself, so what you paste is all that
is known. Remove anything you do not want public before posting.
