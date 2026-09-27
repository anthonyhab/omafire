# Omafox

Omafox keeps Firefox and Zen Browser in sync with your current
[Omarchy](https://omarchy.org/) theme.

> **This fork** ports the command-line tool from bash to C (one small binary,
> no shell startup on every theme change), adds a managed **Firefox
> `chrome/` bridge** that installs a full userChrome theme payload, and
> regenerates a palette-accurate first-paint stylesheet
> (`chrome/omafox-palette.css`) on every sync so Firefox's cold-start frame
> already matches the live theme — closing the window where a light default
> theme or an approximate fallback could flash before the extension applies.
> The native messaging host, wire protocol, and signed `@omafox` WebExtension
> remain wire-compatible with upstream; the WebExtension half is forked as
> **Omarchy FF Sync** (`omarchy-ff-sync@bb.hab.rip`).

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

The packaged Firefox theme (Omarchy Chrome) is built for Firefox's Nova
design and a single vertical-tab sidebar. Omafox does not change your layout
preferences; set these in `about:config` once:

| Preference | Value | Why |
|---|---|---|
| `browser.nova.enabled` | `true` | Nova design (default from Firefox 157) |
| `sidebar.revamp` | `true` | The sidebar the layout is built on |
| `sidebar.verticalTabs` | `true` | Tabs, toolbar, and urlbar share one sidebar column |
| `omarchy.compact` | `true` (optional) | Hide the sidebar until the pointer reaches the window edge |

Without vertical tabs the theme still colors Firefox but keeps the stock
horizontal layout.

Flatpak installations of Zen are not currently supported because their
sandbox cannot use the host native-messaging manifest installed by the AUR
package.

## Installation

Omafox has two parts: the Gecko extension applies the theme, and the AUR
package connects the browser to Omarchy. The same signed extension works in
Firefox and Zen Browser. Install both:

1. Install the [Omafox extension for
   Firefox or Zen Browser](https://addons.mozilla.org/en-US/firefox/addon/omafox/)
2. Install the [Omafox AUR package](https://aur.archlinux.org/packages/omafox):

   ```bash
   yay -S omafox
   ```

3. Enable theme syncing for your user:

   ```bash
   omafox setup
   ```

Setup registers the Omarchy theme-change hook and immediately sends your
current palette to every connected browser. If Zen has been launched at least
once, setup also detects the profiles in `~/.config/zen/profiles.ini`,
installs the Omafox CSS bridge into each existing profile, and enables the two
Zen preferences it needs. Firefox profiles in `~/.mozilla/firefox/profiles.ini`
receive the packaged `omarchy-firefox` theme payload, managed
`userChrome.css`/`userContent.css` imports, the palette-synced first-paint
stylesheet, a geometry stylesheet matching Hyprland's window rounding and borders, and the
required `user.js` preferences. A profile whose `chrome/` is itself an Omarchy
Chrome checkout gets only the generated stylesheets. Restart each browser once
after setup. Run setup once for each desktop user who wants to use Omafox, and
rerun it after creating a new browser profile.

## Usage

After setup, use Omarchy as usual. Changing the theme automatically updates
Firefox and Zen:

```bash
omarchy theme set catppuccin
```

Click the Omafox button in either browser to see the active Omarchy theme,
palette mode, last sync time, and connection status. The popup can also
reapply the stored theme or clear it from that browser. In Zen, clearing the
theme disables the scoped CSS bridge and reveals Zen's normal workspace
theme again.

The command-line helper provides a few additional controls:

```bash
omafox status    # Show the current theme and integration state
omafox sync      # Queue the current palette for connected browsers
omafox payload   # Print the current normalized theme message
omafox setup     # Reconfigure the integration for this user
omafox remove    # Remove this user's hook and saved theme state
omafox version   # Show the installed version
```

## How it works

Omafox is made up of a few small parts:

- An Omarchy theme-change hook reads the current `colors.toml` palette and
  writes a normalized theme message to `~/.local/state/omafox/theme.json`.
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
- For Zen profiles, `omafox setup` installs
  `chrome/omafox.css`, adds a managed import to `chrome/userChrome.css`, and
  adds the required preferences to a managed block in `user.js`. Existing
  profile customizations outside those marked blocks are preserved. Setup
  refuses to overwrite an unrelated `chrome/omafox.css` file.
- For Firefox profiles, `omafox setup` installs the packaged theme payload to
  `chrome/omarchy-firefox/`, adds managed imports to `chrome/userChrome.css`
  and `chrome/userContent.css`, and adds the required preferences to a
  managed block in `user.js`. On every `omafox sync` it also regenerates
  `chrome/omafox-palette.css`, a `:root:not([lwtheme])` fallback holding the
  *current* palette, `chrome/omarchy-radius.css` from Hyprland's
  rounding, border width, and border colors (left alone when `hyprctl` is
  unavailable), plus
  the mode-matched `layout.css.prefers-color-scheme.content-override` and
  `browser.display` canvas prefs — so the first painted frame, restored
  pages, and pages with native dark-mode CSS all start on the real palette
  instead of an approximation. The fallback self-disables the moment the
  extension's theme lands. Setup refuses to overwrite an unrelated
  `chrome/omarchy-firefox/` directory.

The flow is:

```text
Omarchy theme change
        ↓
Theme hook (C binary) → local state file → native messaging host → browser extension
        ↓                                                          ↓
  generated palette CSS →                     Firefox theme properties
  Firefox profile first paint                          ↓
                                       Firefox UI or Zen CSS bridge
```

When a supported browser starts, the extension restores its saved theme and
the native host sends the latest Omarchy palette again. Everything stays
local to the machine; there is no web service or always-running daemon.

## Profile safety

`setup`, `sync` and `remove` only write profiles that `profiles.ini` lists,
and only inside their own marked blocks and the `omarchy-firefox/` payload.

- **profile-sync-daemon.** A psd profile is written through its symlink
  into tmpfs, never into psd's `-backup`, `-back-ovfs` or
  `-backup-crashrecovery-*` copies. A symlink with nothing behind it (psd
  stopped or mid-restore) is skipped, never written through. After a setup
  or remove, omafox asks psd to resync, so the change reaches disk at once.
- **Backups.** Before setup or remove changes a file that holds your own
  content (`user.js`, `userChrome.css`, `userContent.css`), it copies it to
  `~/.local/state/omafox/backups/<time>-<command>-<pid>/<path>`; the newest
  ten sets are kept. To undo, copy the file back.
- **Atomic writes.** Every file is written to a temporary file, flushed,
  and renamed into place. The theme payload is staged beside the old one
  and swapped in one step.
- **One run at a time.** A lock in `~/.local/state/omafox/` serializes the
  theme hook's syncs with setup and remove.
- **Running browsers** are fine: omafox never touches `prefs.js`, and it
  names any profile that needs a restart.

## Troubleshooting

If a browser does not update after a theme change:

1. Confirm that both the Omafox extension and AUR package are installed.
2. Run `omafox status` and check that the theme state, native host, and native
   manifest are present. For Zen, also check that each profile says
   `configured`. A `conflict` status means the profile already contains an
   unrelated `chrome/omafox.css`; rename or remove that file before setup.
3. Run `omafox setup`, followed by `omafox sync`.
4. Restart Zen if its bridge was newly installed or updated.
5. Open the Omafox popup to check its connection status or reapply the theme.

You can report reproducible problems on [GitHub
Issues](https://github.com/cover/omafox/issues).

## Privacy

Omafox makes no network requests and does not collect or transmit data. It
only reads your local Omarchy palette and passes it to supported browsers
through native messaging. Zen and Firefox support additionally write the
managed local profile files described above. See the [privacy statement](PRIVACY.md) for
details.

## Uninstallation

Remove the per-user integration before uninstalling the package:

```bash
omafox remove
sudo pacman -Rns omafox
```

Then remove the Omafox extension from Firefox's `about:addons` page. Omafox
can be removed from Zen on the same page. Restart Zen after removal. The
command deletes the Omafox stylesheet and its managed `userChrome.css` and
`user.js` blocks without removing other profile customizations.

Zen copies `user.js` values into `prefs.js` when it starts, so the preferences
`toolkit.legacyUserProfileCustomizations.stylesheets` and
`zen.theme.disable-lightweight` may remain as user-set values after removal.
Use Reset for those entries in `about:config` if you want to return them to
Zen's defaults.

## Releases (this fork)

This fork is pre-1.0 and versions itself on 0.x, separately from upstream's
1.x tags. `VERSION` is the one version source: make compiles it into the
CLI, and the PKGBUILD's `pkgver` must match it (`tests/run.sh` checks).

A release is a `v$(cat VERSION)` tag pushed to Forgejo (`git push forgejo
v0.1.0`, never `--tags`). Forgejo CI re-runs the full gate on the tagged
commit, builds the package with makepkg, and publishes a Forgejo release
with the package, PKGBUILD and checksums. Local `makepkg` builds are for
development only.

The Firefox payload (`packaging/firefox/chrome/`) is generated from a
committed Omarchy Chrome revision with `make payload THEME_REV=<sha>`. CI
checks that the stamped revision is on the theme's `main` and regenerates
to exactly the committed files (`scripts/check-payload.sh`).

## Acknowledgements

Omafox was inspired by [omazed](https://github.com/APS6/omazed), which provides
live Omarchy theme switching for the Zed editor.

Omafox is released under the [MIT License](LICENSE).
