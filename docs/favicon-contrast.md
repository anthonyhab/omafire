# Smart favicon contrast helper

`favicon-contrast.uc.js` is an optional Firefox chrome helper for favicons that
are hard to see against an Omarchy/Pywalfox tab background.

## How it works

- Reads the live Pywalfox/LWT tab background.
- Samples each favicon at 32 px using a canvas.
- Simulates every candidate treatment as the tab strip would paint it —
  composited luminance plus the local "ground" each pixel sits on (tab
  surface, halo ring, or backing plate).
- Scores legibility on two independent channels rather than pixel-to-
  background averages:
  - **Boundary** — silhouette edges measured as the treated color of the
    covered side against the ground the clear side fades into, plus the
    canvas rim for full-bleed icons and the ring a halo paints.
  - **Interior** — the icon's own content edges. A tile icon reads
    through its internal structure even when its rim blends into the
    surface, so interior contrast alone can keep an icon legible.
- Keeps `original` whenever either channel reads. Treatments must also
  preserve detail: `detailLoss` tracks interior edges a candidate erases,
  which keeps silhouette-only recolors honest on structured icons.
- Chooses the least destructive working candidate, in order:
  `huefix` (`invert(1) hue-rotate(180deg)` — flips lightness while keeping
  brand hue), `dim`/`lift` (brightness scaling), `halo-l`/`halo-d`
  (drop-shadow outline — icon untouched), `plate-l`/`plate-d` (rounded
  backing tile — icon untouched), then `invert`, `hue-rotate`, and
  monochrome `light`/`dark` as last resorts. Opaque tile icons try
  boundary-adding treatments before recolors; sparse glyphs the reverse.
- A halo or plate whose added surface blends into the tab is skipped — an
  invisible ring cannot create a boundary. When nothing is legible, the
  picker still prefers `original` unless a candidate is clearly better:
  a hopeless icon is left alone rather than recolored into a different
  kind of unreadable.
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

## Evaluating decisions against a real corpus

Two scripts form a repeatable lab over your actual favicon collection:

```sh
# Rasterize every icon in the profile's favicons.sqlite (PNG + SVG) into
# 32 px RGBA samples plus a manifest.
python3 scripts/favicon-dump.py \
  --profile ~/.mozilla/firefox/<profile> --out tests/favicon-corpus

# Score the corpus with the exact decision code from favicon-contrast.uc.js
# (vm-injected, worker-threaded) and emit an HTML report of what Firefox
# would render per icon per background.
node scripts/favicon-lab.mjs --json
```

Useful flags: `--bg #hex[,#hex]`, `--hosts a,b`, `--decisions a,b`,
`--limit N`, `--jobs N`, `--all` (include untouched icons). The report and
`scores.json` land under `tests/favicon-corpus/` and are not committed.

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
