# Smart favicon contrast helper

`favicon-contrast.uc.js` is an optional profile-local Firefox chrome script for
favicons that are hard to see against an Omarchy/Pywalfox theme.

## How it works

- Reads the live Pywalfox/LWT accent and tab-background colors.
- Samples each favicon at 32px using a canvas.
- Computes relative luminance and a practical average contrast threshold of
  `2.25`, rather than destroying branded icons for a strict text-oriented
  threshold.
- Leaves colorful/high-contrast icons unchanged.
- Chooses the least disruptive working candidate: original, `invert(1)`,
  `hue-rotate(180deg)`, dark monochrome, or light monochrome.
- Rechecks tabs on favicon, tab-selection, and theme changes without polling.

The source-pixel summary is SHA-256 keyed. Source and decision caches are
bounded LRU maps (`96` and `256` entries), are memory-only, and disappear when
Firefox restarts. Session-restored `data-favicon-contrast` attributes are
removed before reclassification. The helper does not replace Firefox's
favicon files or modify `favicons.sqlite`.

## Installation

Run this from the active profile's `chrome` directory:

```sh
sudo ./scripts/install-favicon-contrast.sh
```

For a checkout outside the profile, provide the profile explicitly:

```sh
sudo env PROFILE_DIR="$HOME/.mozilla/firefox/<profile>" \
  ./scripts/install-favicon-contrast.sh
```

The installer installs two application-level autoconfig files and copies the
profile script into `<profile>/chrome`. It preserves differing existing system
and profile files as `.pi-backup-<timestamp>` files. Restart Firefox after
installation. Firefox package updates may replace the application-level files;
rerun the installer if the helper stops loading.

## Security and compatibility

This uses Firefox autoconfig to execute trusted JavaScript in browser chrome.
The autoconfig sandbox is disabled for the loader, so do not install code you
do not trust. This is more fragile than ordinary `userChrome.css` and is
specific to the Firefox installation/profile combination.

If `gnomeTheme.symbolicTabIcons` is enabled, the helper's runtime stylesheet
overrides that favicon filter so it can preserve original colors when possible.
