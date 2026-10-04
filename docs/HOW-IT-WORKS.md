# How Omafire works

Notes for people reading or changing Omafire. For installing and using it, see the [README](../README.md); for what is supported and how to recover, see [SUPPORT.md](SUPPORT.md).

## Parts

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
- **Compact sidebar.** Keeps the hidden column out while a menu it opened
  (a tab's or the toolbar's context menu, the new-tab container menu,
  Back's history) is open, or while the keyboard is on a sidebar tool.
  Without it those menus open over a column that has already hidden.

Turn them all off with `omafire.scripts` = false, or some with
`omafire.scripts.disabled` (e.g. `keys, live-palette`). `config` in that list
stops the profile following `config.json`.


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
by `make`. The theme lives in `theme/` (its own [README](../theme/README.md) covers its code and
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
