# Smart favicon contrast helper

`favicon-contrast.uc.js` is an optional Firefox chrome helper for favicons that
are hard to see against an Omarchy/Pywalfox tab background.

## How it works

- Reads the live Pywalfox/LWT tab background.
- Samples each favicon at 32 px using a canvas.
- Composites translucent pixels in sRGB, computes relative luminance, and uses
  a practical average contrast target of `2.25` plus a poor-pixel limit.
- Leaves legible icons and any pre-existing favicon filter unchanged.
- Chooses the least disruptive working candidate: `invert(1)`,
  `hue-rotate(180deg)`, dark monochrome, or light monochrome.
- Rechecks tabs on favicon, tab-selection, and theme changes without polling.

The source-pixel summary is SHA-256 keyed. Source and decision caches are
bounded LRU maps (`96` and `256` entries), are memory-only, and disappear when
Firefox restarts. An image-attribute change invalidates a reused source URL
before reclassification. Session-restored `data-favicon-contrast` attributes
are removed at startup. The helper does not replace Firefox favicon files or
modify `favicons.sqlite`.

## Installation

Run the installer **without** `sudo`; it requests privileges only for Firefox's
application directory and writes the opt-in marker as the profile owner:

```sh
./scripts/install-favicon-contrast.sh --dry-run
./scripts/install-favicon-contrast.sh
```

A checkout in the active profile's `chrome` directory is discovered
automatically. Otherwise provide the profile explicitly:

```sh
FIREFOX_PROFILE_DIR="$HOME/.mozilla/firefox/<profile>" \
  ./scripts/install-favicon-contrast.sh
```

Wrapper and nonstandard Firefox installations may also need an explicit
application directory:

```sh
./scripts/install-favicon-contrast.sh \
  --profile "$HOME/.mozilla/firefox/<profile>" \
  --firefox-dir /opt/firefox
```

The installer creates a non-executable per-profile marker at
`<profile>/chrome/.omarchy-favicon-contrast-enabled`. Executable helper code is
copied to the application-owned
`<firefox>/omarchy/favicon-contrast.uc.js`; the global autoconfig loader never
executes profile-writable JavaScript.

Existing unknown `autoconfig.js`, `mozilla.cfg`, symlinks, or non-regular files
are a hard conflict and are never overwritten. Only exact SHA-256-matched
legacy payloads can be upgraded transactionally; a recognized header with any
local addition is rejected. Firefox package updates may
replace the application-level files, so rerun the installer if the helper
stops loading.

## Uninstalling

Disable only the selected profile while leaving the shared loader available to
other profiles:

```sh
./scripts/install-favicon-contrast.sh --uninstall
```

After disabling every opted-in profile, remove global files as well:

```sh
./scripts/install-favicon-contrast.sh --uninstall --purge --dry-run
./scripts/install-favicon-contrast.sh --uninstall --purge
```

Purge removes files only when they exactly match this checkout. It refuses to
delete modified configuration. Restart Firefox after either operation.

## Security and compatibility

This uses unsupported Firefox autoconfig to execute trusted JavaScript in
browser chrome. The autoconfig sandbox is disabled because the loader needs
browser-window globals. The loader is therefore intentionally narrow: a
profile can opt in with a data-only marker but cannot choose the executable
path, which is fixed under Firefox's application directory.

Review both `configuration/mozilla.cfg` and `favicon-contrast.uc.js` before
installing. Do not use this loader alongside organizational autoconfig without
a deliberate manual merge. It is more fragile than `userChrome.css`, is
specific to one Firefox installation, and currently targets Firefox 153.
