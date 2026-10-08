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

It does not read browsing history, bookmarks, cookies, passwords, page
contents or any other browser data. The new-tab page lists your most visited
sites from Firefox's own top sites; that list stays in the browser and
is not stored or sent anywhere by Omafire.

## What Omafire writes, and where

- In each browser profile Omafire manages: a packaged theme directory,
  generated stylesheets, and small, clearly marked blocks in `user.js`,
  `userChrome.css` and `userContent.css`. Before changing a file that holds
  your own content it copies it to `~/.local/state/omafire/backups/`.
- Your settings, in `~/.config/omafire/config.json`, and the current theme
  state, in `~/.local/state/omafire/`.
- The Omarchy shell plugin link in `~/.config/omarchy/plugins/omafire`.
- In each managed profile's prefs: the new tab's options and its last
  shortcut list, and, if you pick one, a copy of the new tab's image.

All of it stays on your device, and `omafire remove` takes it out.

## Data in the browser

Omafire's chrome scripts run inside Firefox, from files the package
installs. They read the palette and wallpaper files on your machine and use
them only to theme the browser and Omafire's new-tab page. To colour a tab's
glow (the `site-colors` setting) they read the icon Firefox already shows for
that tab; the colour is computed in the browser and kept in memory. A
private window's new tab shows no history.

## Network

Omafire's own code opens no network connection. Installing a release from the
release page is a download you make yourself.

Omafire does not include Cinder or any other add-on that talks to a service;
such an add-on has its own statement.
