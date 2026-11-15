# How Omafire works

Notes for people reading or changing Omafire. For installing and using it, see the [README](../README.md); for what is supported and how to recover, see [SUPPORT.md](SUPPORT.md).

## Parts

Omafire is made up of a few small parts:

- An Omarchy theme-change hook runs `omafire sync`, which reads the current
  `colors.toml` palette and writes it into each Firefox profile `omafire
  setup` manages: `chrome/omafire-palette.css` (the palette as
  `--omarchy-*`, and Firefox's own theme variables with readable text and
  fills picked from it), the content palette for Firefox's own pages,
  `chrome/omafire-radius.css` from Hyprland's rounding, border width and
  border colours (left alone when `hyprctl` is unavailable), and the
  palette prefs in the managed `user.js` block (the page canvas, link and
  selection colours, and `layout.css.prefers-color-scheme.content-override`),
  so the first painted frame and pages with native dark-mode CSS start on the
  real palette. It writes `~/.local/state/omafire/theme.json` last.
- Setup also installs the packaged theme to `chrome/omafire/` and adds
  managed imports to `chrome/userChrome.css` and `chrome/userContent.css`.
  It refuses to overwrite an unrelated `chrome/omafire/` directory.
- In each running Firefox, the settings module (`config.sys.mjs`) keeps
  `omafire watch` as a child process. It reports a changed `config.json`,
  a new `theme.json` (a sync) and a new Omarchy wallpaper
  (`~/.local/state/omarchy/current/background`), each on inotify, so it
  sleeps between changes. The chrome scripts then reread the palette files
  and repaint without a restart.

The flow is:

```text
Omarchy theme change
        ↓
Theme hook (omafire sync) → profile palette files → theme.json
                                                        ↓
                          omafire watch (in each running Firefox)
                                                        ↓
                          live-palette.uc.js rereads the files → Firefox UI
```

Everything stays local to the machine; there is no web service or
always-running daemon.


## Firefox chrome scripts

The package installs a chrome script loader beside Firefox
(`/usr/lib/firefox/omafire.cfg`, enabled by
`defaults/pref/omafire-prefs.js`) and its scripts in
`/usr/lib/firefox/omafire/`. It runs only in profiles `omafire setup` marked
(`omafire.managed` in the managed `user.js` block), and only the package's
own root-owned files: nothing is loaded from the profile.

- **Settings panel.** *Omafire* in the app menu (or Ctrl+Alt+O):
  toolbar and tab layout, sidebar side, launcher, density, zen, floating
  page, glass and its opacity, tab numbers (and showing them only while a
  key is held), the new tab, site colours, extension glyphs and the four
  shortcuts. Layout changes apply without a restart.
- **Keybindings.** Ctrl+Alt+H toggles zen (the sidebar layout with
  the sidebar hidden), Ctrl+Alt+S moves the toolbar on (top, sidebar,
  line), Ctrl+Alt+G toggles glass, Ctrl+Alt+O opens the settings panel. Rebind with `omafire.keys.<zen|layout|glass|settings>` in
  `about:config` (a chord like `Ctrl+Alt+J`; empty to unbind). A chord
  Firefox already uses is left to Firefox. Holding Alt shows the menu bar
  over the head band until Alt is released.
- **Live palette.** A theme change reaches the whole chrome, window
  rounding and Firefox's own pages (settings, add-ons) without a restart.
- **New tab.** `chrome://omafire/content/newtab.html` (`chrome/newtab/`):
  clock (bold, thin or one line), shortcuts from Firefox's top sites (pin
  with +, hide with ×, digits open them), widgets (recently closed, history,
  a bookmarks folder; Hacker News, a subreddit, an RSS feed and the weather if
  you add them), each tile lighting from within in its icon's colour as you
  hover, over the Omarchy wallpaper or a picked
  image, with its own options on `,`. The `new-tab` setting turns it off.
- **Site colours.** With `site-colors` on, the active tab glows in the
  colour of its site's icon.
- **Old add-on.** Removes the WebExtension releases before 0.7 installed,
  after the new tab has copied its settings.
- **Compact sidebar.** Keeps the hidden column out while a menu it opened
  (a tab's or the toolbar's context menu, the new-tab container menu,
  Back's history) is open, or while the keyboard is on a sidebar tool.
  Without it those menus open over a column that has already hidden.
- **Light sites.** A site set to Light in Cinder's panel gets the light
  colour scheme from its first paint, frames included
  (`site-scheme.sys.mjs`). It reads two keys of Cinder's extension storage,
  `modes` (site to Light, Dark or Off) and `enabled`, when Cinder starts and
  whenever Cinder writes them; nothing else of Cinder's.
- **Pseudo-state** (off unless `omafire.pseudo-state` is true). Lets
  Cinder's inspector lock `:hover`, `:focus` and the like on a page's own
  elements, through a window actor any http(s) page can message. A page
  could use the reply to tell that omafire is installed, so it stays off
  outside profiles that audit pages.

Turn them all off with `omafire.scripts` = false, or some with
`omafire.scripts.disabled` (e.g. `keys, live-palette`). `config` in that list
stops the profile following `config.json`.


## Releases

Omafire is pre-1.0 and versions itself on 0.x (upstream omafox's 1.x tags
are unrelated). `VERSION` is the one version source: make links it into the
CLI, and the PKGBUILD's `pkgver` must match it (`tests/run.sh` checks).

A release is a `v$(cat VERSION)` tag pushed to Forgejo (`git push forgejo
"v$(cat VERSION)"`, never `--tags`). Forgejo CI re-runs the full gate on the tagged
commit, builds the package with makepkg, and publishes a Forgejo release
with the package, PKGBUILD and checksums. Local `makepkg` builds are for
development only.

The CLI is Go (`cmd/omafire`; standard library plus `golang.org/x/sys` and `golang.org/x/image`),
built by `make`. The theme lives in `theme/` (its own [README](../theme/README.md) covers its code and
design language). The Firefox payload the package installs is built from it on
every `make` (`scripts/build-payload.sh`, into `build/firefox/chrome/`), so
the theme, CLI and chrome scripts of a release all come from one commit.
Its entrypoints carry a stamp naming the version and commit.
