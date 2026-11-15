# Omafire

**The Firefox theme and toolkit for [Omarchy](https://omarchy.org/).**
Omafire themes Firefox from your current Omarchy theme and keeps it in step
live: a Nova userChrome theme with a Zen-style sidebar layout, a settings
panel and keybindings inside Firefox, and a setup that is safe with
profile-sync-daemon and never loses your own profile files.

![Top toolbar with vertical tabs](docs/img/top.png)

| Sidebar layout | The settings panel |
|---|---|
| ![Toolbar in the sidebar](docs/img/sidebar.png) | ![Omafire settings panel in Firefox's app menu](docs/img/settings.png) |

Omafire grew out of [omafox](https://github.com/cover/omafox) (MIT) and
carried its name until 0.3.0.

## Features

- **Follows Omarchy.** Change your Omarchy theme and Firefox follows within a
  moment, tabs, toolbars, menus, sidebars, the new-tab page and Firefox's own
  pages, dark or light, including themes with partial palettes. The first
  painted frame of a restart already uses the current palette.
- **Layouts.** Toolbar on top, in a Zen-style sidebar or in one line with
  the tabs; horizontal or vertical tabs, sidebar on either side, a drop or
  centred launcher, zen (the sidebar disappears until you reach for it), a
  floating page and split view.
  Rows, tabs and the rail are the Omarchy bar's size, so the chrome scales with
  it.
- **Glass.** Optional translucent chrome over the desktop, blurred where your
  compositor blurs, with a readability floor measured against your wallpapers.
- **Settings everywhere.** One file, `~/.config/omafire/config.json`, driven
  from the CLI, an Omafire panel in Firefox's menu, keybindings and an icon in
  the Omarchy bar. All of them stay in step.
- **Safe.** Works with profile-sync-daemon, backs up your own files before
  touching them, writes atomically, and removes cleanly.
- **Local.** No account, telemetry or background service, and no network
  request unless you add a feed widget to the new tab or search for a
  shortcut icon ([Privacy](#privacy)).

## Requirements

- Omarchy 4 (Quattro) or newer, on Hyprland: the window rounding, borders
  and glass blur are read from it. The bar icon needs the Omarchy shell's
  plugins (`omarchy plugin`).
- Firefox 159 or newer (the oldest release the layout matrix passes on),
  with Nova, which setup turns on in the profiles it manages. On an older
  Firefox the theme may not apply. Zen Browser is not supported.

What is tested, what is not, and the limits are in [docs/SUPPORT.md](docs/SUPPORT.md).

## Installation

Omafire is an Arch package, `omafire`, built from this repository's
`PKGBUILD` ([github.com/anthonyhab/omafire](https://github.com/anthonyhab/omafire)).

1. Build and install the latest release:

   ```bash
   git clone https://github.com/anthonyhab/omafire.git
   cd omafire
   makepkg -si
   ```

   It replaces the `omarchy-firefox` package, and pacman offers to remove
   `omafox` if that is installed (the two conflict). An older,
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

For Firefox that is all: no add-on is needed. If you used upstream omafox,
remove its `@omafox` add-on in `about:addons`; Omafire removes its own older
add-on by itself.

`makepkg` builds the release tag the `PKGBUILD` names (`v` + `VERSION`),
not your checkout; for the working tree use `make && sudo make install`.

Setup registers the Omarchy theme-change hook and applies your current
palette. For each profile in Firefox's `profiles.ini` (`~/.mozilla/firefox`
where that exists, else `~/.config/mozilla/firefox`, where Firefox 147 and
later create new profiles) it installs the theme, small marked blocks in
`user.js`, `userChrome.css` and `userContent.css`, and the stylesheets that
keep the first paint on your palette. Restart Firefox once after setup. Run
setup once for each desktop user, and rerun it after creating a new browser
profile. How each
file is written, and what is left alone, is in
[docs/SUPPORT.md](docs/SUPPORT.md#profile-safety).

## Usage

After setup, use Omarchy as usual. Changing the theme updates Firefox:

```bash
omarchy theme set catppuccin
```

Open the Omafire panel from Firefox's app menu (or Ctrl+Alt+O) to change the
layout and look, or click the Omafire icon in the Omarchy bar to see the
theme and each profile's state. The command-line helper:

```bash
omafire status    # Show the current theme and integration state
omafire sync      # Apply the current palette to Firefox
omafire payload   # Print the theme state sync records (theme.json)
omafire setup     # Set up or repair the integration for this user
omafire remove    # Take Omafire out of this user's profiles, hook and bar
omafire restore   # Put back files a setup or remove changed
omafire get/set   # Read and change settings (also reset, watch; see Settings)
omafire version   # Show the installed version
```

Keybindings: Ctrl+Alt+H toggles zen (the sidebar layout with the sidebar
hidden), Ctrl+Alt+S moves the toolbar on (top, sidebar, line), Ctrl+Alt+G
toggles glass, Ctrl+Alt+O opens the settings panel. They can be rebound; see [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md#firefox-chrome-scripts).
Holding Alt shows the menu bar until you let go.

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
| `toolbar` | `top`, `sidebar` (vertical tabs), `line` (one row with horizontal tabs) | `top` |
| `tabs` | `horizontal`, `vertical` | `horizontal` |
| `side` | `left`, `right` (vertical tabs) | `left` |
| `launcher` | `drop`, `center` (sidebar layout) | `drop` |
| `density` | `normal`, `compact` | `normal` |
| `compact-sidebar` | `true`, `false` (zen, in the sidebar layout) | `false` |
| `floating-page` | `true`, `false` | `false` |
| `glass` | `true`, `false` | `false` |
| `opacity` | `0.5` to `1` | `0.85` |
| `glass-pages` | `true`, `false` (with `glass` and Cinder) | `false` |
| `tab-numbers` | `true`, `false` | `false` |
| `tab-numbers-hold` | `true`, `false` (with `tab-numbers`) | `false` |
| `new-tab` | `true`, `false` | `true` |
| `site-colors` | `true`, `false` | `false` |
| `extension-glyphs` | `true`, `false` | `true` |
| `key-zen` | a shortcut such as `Ctrl+Alt+H`, or empty for none | `Ctrl+Alt+H` |
| `key-layout` | a shortcut, or empty | `Ctrl+Alt+S` |
| `key-glass` | a shortcut, or empty | `Ctrl+Alt+G` |
| `key-settings` | a shortcut, or empty | `Ctrl+Alt+O` |

The sidebar toolbar holds vertical tabs and the line toolbar horizontal
ones, so the two settings move together: `omafire set toolbar sidebar` also
makes the tabs vertical, `toolbar line` horizontal, and changing `tabs`
afterwards puts the toolbar back on top. The top toolbar takes either.

The first Firefox to start without a file creates it from that profile's
settings. A value the file gets wrong is reported and its default used; a
file that is not JSON is left alone, and Firefox keeps its current settings
until it parses again.

### In the Omarchy bar

`omafire setup` adds an Omafire icon to the right of the Omarchy bar (a
plugin the package installs to `/usr/share/omafire/shell/omafire`, linked
into `~/.config/omarchy/plugins/omafire`). Its panel holds every setting
above and the state of each Firefox profile, with a Repair button
(`omafire setup`) when one needs it; the icon turns red until then.
Right-click toggles glass. Keyboard: j/k move, h/l change, Enter toggles,
r repairs.

Setup enables it once. Disable it with `omarchy plugin disable omafire` and
later setups leave it off; `omafire remove` takes it out.

## Troubleshooting

If a browser does not update after a theme change, run `omafire status`, then
`omafire setup` and `omafire sync`, and restart the browser. The full list of
messages, what each one means and what to do is in
[docs/SUPPORT.md](docs/SUPPORT.md#troubleshooting) and
[Recovery](docs/SUPPORT.md#recovery); to ask for help, see
[Getting help](docs/SUPPORT.md#getting-help).

## Uninstallation

Remove the per-user integration before uninstalling the package:

```bash
omafire remove
sudo pacman -Rns omafire
```

`omafire remove` also deletes the preferences that mark a Firefox profile as
Omafire's from `prefs.js` (`omafire.managed`, every other `omafire.*` pref but
the script switches, the forced page colours, the accent colours), and the
new tab's picked image and caches from the profile: Firefox copies `user.js`
values into `prefs.js`, and the loader keeps running while `omafire.managed`
is set.
It only edits `prefs.js` while Firefox is closed, because a running Firefox
rewrites the file on exit; if Firefox is running it says so, and you run
`omafire remove` again after closing it. Feature toggles from the block
(Nova, Wayland, drag delay) stay.

A theme checkout used as `chrome/` keeps its own files: remove deletes only the
generated `omafire-*.css` beside them. If `remove` reports Firefox running, the
forced colours stay until you close it and run `omafire remove` again.

## Privacy

Omafire collects and transmits no data. It reads your local Omarchy palette
and wallpaper and writes the managed local profile files described above. It
opens a network connection only for what you add yourself: a feed widget on
the new tab (Hacker News, a subreddit, an RSS feed, the weather) and the
brand-icon search in the shortcut editor. See the [privacy statement](PRIVACY.md).

## More

- [docs/SUPPORT.md](docs/SUPPORT.md): what is supported, troubleshooting,
  recovery, profile safety.
- [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md): the parts, the chrome scripts,
  releases.
- [theme/README.md](theme/README.md): the theme's code and design language.

## Acknowledgements

Omafire was inspired by [omazed](https://github.com/APS6/omazed), which provides
live Omarchy theme switching for the Zed editor.

Omafire is released under the [MIT License](LICENSE).
