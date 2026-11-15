# Privacy

Omafire does not collect, transmit, sell, or share personal or technical data.
It has no account, telemetry, analytics, crash reporting or update check, and
nothing in it sends data to any server.

## What Omafire reads

- **Your Omarchy theme:** the current theme's name, `colors.toml` palette and
  wallpapers, from your local filesystem. The wallpaper is also measured once
  per theme change to keep glass legible, and shown on Omafire's new-tab page.
- **Hyprland's window rounding and border settings**, with `hyprctl`, to match
  the browser's corners.
- **Firefox's `profiles.ini`, and the files setup manages in each
  profile** (`user.js`, `userChrome.css`, `userContent.css`, and `prefs.js` on
  removal, to clear the preferences Omafire set).
- **Cinder's per-site choices**, if the Cinder add-on is installed: the
  `modes` (each site you set to Light, Dark or Off) and `enabled` keys of its
  storage, read inside the browser so a site you set to Light also gets the
  light colour scheme. Nothing else of Cinder's is read, and the choices go
  nowhere.

Apart from those, it does not read browsing history, bookmarks, cookies, passwords, page
contents or any other browser data. The new-tab page lists your most visited
sites from Firefox's own top sites, and its widgets can show recently closed
tabs, history and a bookmarks folder; none of it is sent anywhere. The
shortcut list it last showed is kept in the profile (below) so the next new
tab paints at once.

## What Omafire writes, and where

- In each browser profile Omafire manages: a packaged theme directory,
  generated stylesheets, and small, clearly marked blocks in `user.js`,
  `userChrome.css` and `userContent.css`. Before changing a file that holds
  your own content it copies it to `~/.local/state/omafire/backups/`.
- Your settings, in `~/.config/omafire/config.json`, and the current theme
  state, in `~/.local/state/omafire/`.
- The Omarchy shell plugin link in `~/.config/omarchy/plugins/omafire`.
- In each managed profile: the new tab's options (custom shortcuts
  included) and the shortcut list it last showed, as `omafire.newtab.*`
  prefs; the feed widgets' last answers (`omafire-newtab-cache.json`); a
  copy of the new tab's image, if you pick one (`omafire-newtab-image`); and
  the shortcuts Firefox already uses that the keys gave way to
  (`omafire-keys.json`).

All of it stays on your device, and `omafire remove` takes it out except
for three things, so a reinstall picks up where you left off:

- your settings file, `~/.config/omafire/config.json`;
- the backups in `~/.local/state/omafire/backups/`, which are how a remove
  is undone;
- your switches for the scripts (`omafire.scripts`,
  `omafire.scripts.disabled`, `omafire.pseudo-state`), which do nothing in a
  profile Omafire no longer manages.

Delete the first two by hand to leave nothing behind. Firefox's "Clear
history" doesn't clear the new tab's last shortcut list; the next new tab
replaces it with Firefox's current top sites.

## Data in the browser

Omafire's chrome scripts run inside Firefox, from files the package
installs. They read the palette and wallpaper files on your machine and use
them only to theme the browser and Omafire's new-tab page. To colour a tab's
glow (the `site-colors` setting) they read the icon Firefox already shows for
that tab; the colour is computed in the browser and kept in memory. A
private window's new tab shows no history.

Web pages can't detect Omafire through it. The one hook a page can
message, the pseudo-state actor Cinder's inspector uses to lock a page's
hover and focus states, is off unless you set `omafire.pseudo-state` to true
in `about:config`.

## Network

Omafire's own code opens no network connection, with two exceptions you make
yourself. A feed widget on the new tab fetches from the site it names, and
only while it is in your widget list: Hacker News from `hn.algolia.com`, a
subreddit from `www.reddit.com`, an RSS feed from the address you give, and
the weather from `geocoding-api.open-meteo.com` (the place you type) and
`api.open-meteo.com`. None is there by default. The last answer is kept in the profile so the
page paints at once. And searching for a brand icon in the shortcut editor
fetches Simple Icons' list and the marks it shows from jsDelivr
(cdn.jsdelivr.net), only while you search; the mark you pick is stored in your
settings, so tiles never fetch it. Installing a release from the release page is a
download you make yourself.

Omafire does not include Cinder or any other add-on that talks to a service;
such an add-on has its own statement.
