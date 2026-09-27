# Omafire

**The Firefox theme and toolkit for [Omarchy](https://omarchy.org/).**
Omafire themes Firefox from your current Omarchy theme and keeps it in step
live: a Nova userChrome theme with a Zen-style sidebar layout, a settings
panel and keybindings inside Firefox, and a setup that is safe with
profile-sync-daemon and never loses your own profile files.

Omafire grew out of [omafox](https://github.com/cover/omafox) (MIT) and
carried its name until 0.3.0. Its native messaging protocol is still
omafox's, so upstream's `@omafox` extension works with it in Zen.

## Features

- Automatically updates supported browsers whenever you change your Omarchy
  theme.
- Themes tabs, toolbars, menus, sidebars, and the new tab page from the full
  Omarchy palette.
- Maps the extension theme into Zen's workspace and toolbar interface through
  a small, managed profile stylesheet.
- Supports both dark and light themes, including custom themes with partial
  palettes.
- Restores your current theme when the browser starts.
- Provides a small extension popup for sync status, manual reapplication, and
  clearing the applied theme.
- Runs entirely on your computer, with no account, network service, telemetry,
  or persistent daemon.

## Requirements

- Omarchy 4 (Quattro) or newer.
- Firefox 156 or newer, or a current native Zen Browser installation
  (Zen 1.22+, Gecko 156).

The packaged Firefox theme is built for Firefox's Nova design
(`browser.nova.enabled`, the default from Firefox 157) and the revamped
sidebar (`sidebar.revamp`). Its layout is chosen in [Settings](#settings).

Flatpak installations of Zen are not currently supported because their
sandbox cannot use the host native-messaging manifest the package installs.

## Installation

Omafire is an Arch package, `omafire`. Forgejo CI builds each release from
its tag and attaches the package to the [release
page](https://git.hab.rip/habibe/omafire/releases).

1. Install the package from the latest release:

   ```bash
   sudo pacman -U omafire-<version>-1-x86_64.pkg.tar.zst
   ```

   It replaces the `omafox` and `omarchy-firefox` packages. An older,
   unpackaged Omarchy Firefox loader (`/usr/lib/firefox/mozilla.cfg` and
   friends) is removed if it is byte for byte a known version, and
   reported otherwise.

2. Enable it for your user, then restart Firefox:

   ```bash
   omafire setup
   ```

   Coming from omafox, the same command moves your profiles, settings,
   backups and theme hook to omafire's names. Until you run it, `omafox`
   still works: it forwards to `omafire`.

For Firefox that is all: the package carries the Mozilla-signed Omafire
extension, and the first browser window of each set-up profile installs it.
Do not also install upstream's `@omafox` from AMO in Firefox. Zen Browser
still needs [upstream's omafox
extension](https://addons.mozilla.org/en-US/firefox/addon/omafox/) from AMO.

To build it yourself instead: `makepkg -si` with this repository's
`PKGBUILD` (it builds the Forgejo tag), or `make && sudo make install` for
the working tree.

Setup registers the Omarchy theme-change hook and immediately sends your
current palette to every connected browser. If Zen has been launched at least
once, setup also detects the profiles in `~/.config/zen/profiles.ini`,
installs the Omafire CSS bridge into each existing profile, and enables the two
Zen preferences it needs. Firefox profiles in `~/.mozilla/firefox/profiles.ini`
receive the packaged `omafire` theme payload, managed
`userChrome.css`/`userContent.css` imports, the palette-synced first-paint
stylesheet, a geometry stylesheet matching Hyprland's window rounding and borders, and the
required `user.js` preferences. A profile whose `chrome/` is itself a checkout of `theme/` gets only the
generated stylesheets. Restart each browser once
after setup. Run setup once for each desktop user who wants to use Omafire, and
rerun it after creating a new browser profile.

## Usage

After setup, use Omarchy as usual. Changing the theme automatically updates
Firefox and Zen:

```bash
omarchy theme set catppuccin
```

Click the Omafire button in either browser to see the active Omarchy theme,
palette mode, last sync time, and connection status. The popup can also
reapply the stored theme or clear it from that browser. In Zen, clearing the
theme disables the scoped CSS bridge and reveals Zen's normal workspace
theme again.

The command-line helper provides a few additional controls:

```bash
omafire status    # Show the current theme and integration state
omafire sync      # Queue the current palette for connected browsers
omafire payload   # Print the current normalized theme message
omafire setup     # Reconfigure the integration for this user
omafire remove    # Remove this user's hook and saved theme state
omafire get/set   # Read and change settings (see Settings)
omafire version   # Show the installed version
```

## Settings

Omafire's settings live in one file, `~/.config/omafire/config.json`, shared
by every Firefox profile omafire manages. It holds only what you changed;
everything else is its default. Change it with the CLI, by hand, or from
Firefox (the Omafire panel in the app menu, the keybindings, or
`about:config`): every running Firefox follows the file within a moment, and
a change made in Firefox is written back to it.

```bash
omafire get                  # every setting, key=value
omafire get opacity          # one value
omafire set glass on opacity 0.8
omafire reset opacity        # back to the default
omafire watch                # a JSON line now and after every change
```

| Setting | Values | Default |
|---|---|---|
| `toolbar` | `top`, `sidebar` | `top` |
| `tabs` | `horizontal`, `vertical` | `horizontal` |
| `side` | `left`, `right` (vertical tabs) | `left` |
| `launcher` | `drop`, `center` (sidebar layout and zen mode) | `drop` |
| `density` | `normal`, `compact` | `normal` |
| `zen-mode` | `true`, `false` (top toolbar) | `false` |
| `compact-sidebar` | `true`, `false` (sidebar layout) | `false` |
| `floating-page` | `true`, `false` | `false` |
| `glass` | `true`, `false` | `false` |
| `opacity` | `0.5` to `1` | `0.85` |
| `tab-numbers` | `true`, `false` | `false` |
| `extension-glyphs` | `true`, `false` | `true` |

The first Firefox to start without a file creates it from that profile's
settings. A value the file gets wrong is reported and its default used; a
file that is not JSON is left alone, and Firefox keeps its current settings
until it parses again. Keybindings (`omafire.keys.*`) and the extension's
site-coloured tab are not in the file yet.

### In the Omarchy bar

`omafire setup` adds an Omafire icon to the right of the Omarchy bar (a
plugin the package installs to `/usr/share/omafire/shell/omafire`, linked
into `~/.config/omarchy/plugins/omafire`). Its panel holds every setting
above and the state of each Firefox and Zen profile, with a Repair button
(`omafire setup`) when one needs it; the icon turns red until then.
Right-click toggles glass. Keyboard: j/k move, h/l change, Enter toggles,
r repairs.

Setup enables it once. Disable it with `omarchy plugin disable omafire` and
later setups leave it off; `omafire remove` takes it out.

## How it works

Omafire is made up of a few small parts:

- An Omarchy theme-change hook reads the current `colors.toml` palette and
  writes a normalized theme message to `~/.local/state/omafire/theme.json`.
- The native messaging host watches that file with Linux `inotify` and sends
  updates to connected browser extensions. It sleeps between changes, so no
  persistent polling or background service is needed.
- The same host also watches the current Omarchy wallpaper
  (`~/.local/state/omarchy/current/background`, falling back to
  `~/.config/omarchy/current/background`) and streams it to the extension for
  the new-tab page. JPEG, PNG, and WebP images up to 32 MiB are sent as
  `{"protocol":"omafox","version":1,"action":"wallpaper","id":…,"mime":…,"size":…,"index":…,"count":…,"data":…}`
  messages: `count` consecutive base64 chunks of 512 KiB raw bytes each, so
  every message stays under the browser's 1 MB native-messaging limit. The
  `id` changes whenever the linked file or its content changes, and an
  unchanged wallpaper is not resent. When no usable wallpaper exists, the host
  sends a single message with an empty `id` and `"count":0`.
- The extension validates the message, maps the Omarchy colors to standard
  Firefox theme properties, and saves the result in the browser's local
  extension storage.
- For Zen profiles, `omafire setup` installs
  `chrome/omafire.css`, adds a managed import to `chrome/userChrome.css`, and
  adds the required preferences to a managed block in `user.js`. Existing
  profile customizations outside those marked blocks are preserved. Setup
  refuses to overwrite an unrelated `chrome/omafire.css` file.
- For Firefox profiles, `omafire setup` installs the packaged theme payload to
  `chrome/omafire/`, adds managed imports to `chrome/userChrome.css`
  and `chrome/userContent.css`, and adds the required preferences to a
  managed block in `user.js`. On every `omafire sync` it also regenerates
  `chrome/omafire-palette.css`, a `:root:not([lwtheme])` fallback holding the
  *current* palette, `chrome/omafire-radius.css` from Hyprland's
  rounding, border width, and border colors (left alone when `hyprctl` is
  unavailable), plus
  the mode-matched `layout.css.prefers-color-scheme.content-override` and
  `browser.display` canvas prefs — so the first painted frame, restored
  pages, and pages with native dark-mode CSS all start on the real palette
  instead of an approximation. The fallback self-disables the moment the
  extension's theme lands. Setup refuses to overwrite an unrelated
  `chrome/omafire/` directory.

The flow is:

```text
Omarchy theme change
        ↓
Theme hook (omafire sync) → local state file → native messaging host → browser extension
        ↓                                                          ↓
  generated palette CSS →                     Firefox theme properties
  Firefox profile first paint                          ↓
                                       Firefox UI or Zen CSS bridge
```

When a supported browser starts, the extension restores its saved theme and
the native host sends the latest Omarchy palette again. Everything stays
local to the machine; there is no web service or always-running daemon.

## Firefox chrome scripts

The package installs a chrome script loader beside Firefox
(`/usr/lib/firefox/omafire.cfg`, enabled by
`defaults/pref/omafire-prefs.js`) and its scripts in
`/usr/lib/firefox/omafire/`. It runs only in profiles `omafire setup` marked
(`omafire.managed` in the managed `user.js` block), and only the package's
own root-owned files: nothing is loaded from the profile.

- **Settings panel.** *Omafire* in the app menu (or Ctrl+Alt+O):
  toolbar and tab layout, sidebar side, launcher, density, zen mode,
  compact sidebar, floating page, glass and its opacity, tab numbers and
  extension glyphs. Layout changes apply without a restart.
- **Keybindings.** Ctrl+Alt+H hides the chrome (zen mode; compact in the
  sidebar layout), Ctrl+Alt+S switches the toolbar, Ctrl+Alt+G toggles
  glass. Rebind with `omafire.keys.<zen|layout|glass|settings>` in
  `about:config` (a chord like `Ctrl+Alt+J`; empty to unbind). A chord
  Firefox already uses is left to Firefox.
- **Live palette.** A theme change reaches the tab-group colours, window
  rounding and Firefox's own pages (settings, add-ons) without a restart.
- **Extension.** Installs or updates the bundled signed extension. Remove
  it in `about:addons` and it stays removed until a newer version ships.

Turn them all off with `omafire.scripts` = false, or some with
`omafire.scripts.disabled` (e.g. `keys, live-palette`). `config` in that list
stops the profile following `config.json`.

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
- **Running browsers** are fine: omafire never touches `prefs.js`, and it
  names any profile that needs a restart.

## Troubleshooting

If a browser does not update after a theme change:

1. Confirm that the `omafire` package is installed and, in Zen,
   the Omafire extension.
2. Run `omafire status` and check that the theme state, native host, and native
   manifest are present. For Zen, also check that each profile says
   `configured`. A `conflict` status means the profile already contains an
   unrelated `chrome/omafire.css`; rename or remove that file before setup.
3. Run `omafire setup`, followed by `omafire sync`.
4. Restart Zen if its bridge was newly installed or updated.
5. Open the Omafire popup to check its connection status or reapply the theme.

You can report reproducible problems on [GitHub
Issues](https://github.com/cover/omafox/issues).

## Privacy

Omafire makes no network requests and does not collect or transmit data. It
only reads your local Omarchy palette and passes it to supported browsers
through native messaging. Zen and Firefox support additionally write the
managed local profile files described above. See the [privacy statement](PRIVACY.md) for
details.

## Uninstallation

Remove the per-user integration before uninstalling the package:

```bash
omafire remove
sudo pacman -Rns omafire
```

Then remove the Omafire extension from Firefox's `about:addons` page. Omafire
can be removed from Zen on the same page. Restart Zen after removal. The
command deletes the Omafire stylesheet and its managed `userChrome.css` and
`user.js` blocks without removing other profile customizations.

Zen copies `user.js` values into `prefs.js` when it starts, so the preferences
`toolkit.legacyUserProfileCustomizations.stylesheets` and
`zen.theme.disable-lightweight` may remain as user-set values after removal.
Use Reset for those entries in `about:config` if you want to return them to
Zen's defaults.

## Releases

Omafire is pre-1.0 and versions itself on 0.x (upstream omafox's 1.x tags
are unrelated). `VERSION` is the one version source: make links it into the
CLI, and the PKGBUILD's `pkgver` must match it (`tests/run.sh` checks).

A release is a `v$(cat VERSION)` tag pushed to Forgejo (`git push forgejo
v0.1.0`, never `--tags`). Forgejo CI re-runs the full gate on the tagged
commit, builds the package with makepkg, and publishes a Forgejo release
with the package, PKGBUILD and checksums. Local `makepkg` builds are for
development only.

The CLI and the native host are Go (`cmd/omafire`,
`cmd/omafire-native-host`; standard library plus `golang.org/x/sys`), built
by `make`. The theme lives in `theme/` (its own README covers its code and
design language). The Firefox payload the package installs is built from it on
every `make` (`scripts/build-payload.sh`, into `build/firefox/chrome/`), so
the theme, CLI, chrome scripts and extension of a release all come from
one commit. Its entrypoints carry a stamp naming the version and commit.

The Firefox extension ships signed in the package
(`packaging/extension/omafire.xpi`). To change it: bump `extension/manifest.json`,
run `extension/sign.sh` (AMO, unlisted), commit the new
`extension/.amo-upload-uuid` receipt, and copy the signed XPI from
`extension/dist/` over the packaged one. `scripts/check-xpi.sh` fails the
gate if the packaged XPI is unsigned or differs from `extension/`.

## Acknowledgements

Omafire was inspired by [omazed](https://github.com/APS6/omazed), which provides
live Omarchy theme switching for the Zed editor.

Omafire is released under the [MIT License](LICENSE).
