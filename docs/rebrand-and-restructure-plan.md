# Rebrand & restructure: handoff plan

## Status (updated 2026-08-12): rebrand complete, restructuring still pending

The branding half of this plan has been executed: the project is now named
**Omarchy Chrome** (`pkgname=omarchy-chrome`), the base theme's CSS custom
properties moved from `--gnome-*` to `--omarchy-base-*` (228 tokens, clean
1:1 rename, verified with a real headless-Firefox load), the optional-feature
preference namespace moved from `gnomeTheme.*` to `omarchyTheme.*` (19 keys,
clean break — no published userbase existed yet to strand), the nested
install-folder convention is now `omarchy-chrome/` (with a fallback in
`generate-omarchy-radius.sh` for the old `firefox-gnome-theme/` name), and
`theme/gnome-theme.css` was renamed to `theme/base-theme.css`. A permanent
guardrail check was added to `scripts/check-omarchy.sh` that fails the build
if `--gnome-` or `gnomeTheme.` ever resurface in the tracked tree. See
Decisions 1–3 below, now marked resolved with the values actually chosen.

**Still not done: the monolithic-file split** (`omarchy-chrome.css` at 2,652
lines, `omarchy-content.css` at 811, `theme/parts/tabsbar.css` at 934). That
was explicitly out of scope for the 2026-08-12 branding pass and remains the
next real piece of this plan — see "Proposed target shape" below, which is
still accurate as a starting point.

---

This document originally picked up where `docs/omarchy-firefox-design-map.md`
intentionally stopped: that file's design rules used to say "Keep
Firefox-GNOME as the compatibility foundation" as a literal file/token-naming
statement. That rule's wording has been updated to name
`theme/base-theme.css` directly — the underlying relationship (audited
Firefox-GNOME/Adwaita foundation, narrow Omarchy overrides on top) is
unchanged and was never the part being retired, only the naming was.

## Why this is its own effort

Two 2026-08-12 review passes on this repo fixed concrete bugs but repeatedly
ran into the same root cause: **this project is still architecturally a fork
of `firefox-gnome-theme`, not yet its own thing.** Two symptoms that came up
today specifically because of that:

- `install-by-curl.sh` silently installed the *wrong theme* because it never
  stopped pointing at the upstream repo.
- The Arch Linux install section pointed at the upstream AUR package under
  the same false-cognate trap.

Both were removed, but the same trap is baked much deeper into the codebase —
in variable names, preference names, and a single file that now does the job
of what should be a dozen. Renaming a URL is a five-minute fix; the naming
convention underneath the entire theme layer is not, and every partial rename
that misses a spot creates exactly the kind of dead-CSS-variable bug this
session already found and fixed in `--gnome-content-padding` and
`--gnome-entry-box-shadow`. That risk is why this needs its own scoped plan
rather than being folded into a bug-fix pass.

The forward-looking motivation: Firefox 153+ is actively adding surface area
(tab groups shipped this session; more is coming) and this fork wants to keep
adding features like that without every addition getting bolted onto an
already-2,652-line file.

## Current-state inventory (measured 2026-08-12, this worktree)

### Branding — three separable layers, three different risk levels

| Layer | Footprint | Risk to rename |
| --- | --- | --- |
| **Cosmetic/identity**: README title (`# Firefox GNOME theme`), `**A GNOME theme for Firefox**` tagline, `icon.svg` alt text, Matrix room name, badges/links to `rafaelmardojai/firefox-gnome-theme`, `Maintainer:` line and AUR pkgname in `generate-pkgbuild.sh`, hardcoded `content: "Firefox GNOME theme v150";` footer string in `theme/gnome-theme.css:48` (also just stale — hardcodes "v150") | ~15 lines across README.md, theme/gnome-theme.css, scripts/generate-pkgbuild.sh, icon.svg | **Low.** Mechanical text edits, nothing references these strings programmatically except the pkgname (see Decision 1). |
| **CSS custom-property vocabulary**: `--gnome-*` tokens (e.g. `--gnome-button-radius`, `--gnome-card-background`) are the *primary* token vocabulary of the whole base theme layer — `omarchy-chrome.css` currently works by overriding them, not by the base layer using neutral names to begin with. | **228 unique `--gnome-*` tokens across 32 files** | **Medium.** Mechanical (mostly a rename), but exhaustiveness is the whole risk — a missed reference silently degrades to the CSS-invalid fallback instead of erroring, exactly like today's `--gnome-content-padding` bug. Needs a mechanical rename plus a new static check (see Guardrails) before it's safe to call done. |
| **Preference/feature-flag namespace**: every optional feature is gated by an `about:config` boolean under the `gnomeTheme.*` prefix. | **19 unique `gnomeTheme.*` keys across 8 files** (`configuration/user.js`, `README.md`, `theme/gnome-theme.css`, and 6 `theme/parts/*.css` files using `-moz-pref("gnomeTheme.X")`) | **High — this is the one with real user impact.** These are prefs real users already have set in their live `about:config`/`user.js`. A bare rename silently breaks every preference an existing user has already customized, with no error, no warning — the feature just stops being gate-able. This needs a compatibility decision before any renaming starts (see Decision 3). |
| **Structural framing**: `theme/gnome-theme.css` is the literal name of the base-layer import hub; `docs/omarchy-firefox-design-map.md`'s own design rules say "Keep Firefox-GNOME as the compatibility foundation." | 1 file name + 1 doc-level policy statement | **Low effort, but it's the one call that gates everything else** — see Decision 1. |

### Monolithic files

| File | Lines | What's in it today |
| --- | --- | --- |
| `omarchy-chrome.css` | **2,652** | Everything Omarchy-specific: Pywalfox→semantic token bridge, nav bar, URL bar, horizontal tabs, vertical-tab rail, tab groups (~450 lines added this session alone), menus/popups, dialogs, sidebar, focus/hover states — one flat file, no internal sectioning beyond comments. |
| `theme/parts/tabsbar.css` | 934 | The base theme's entire tab-bar implementation (horizontal + vertical + split view + groups + overflow) in one file. |
| `omarchy-content.css` | 811 | Every privileged content surface (Firefox View, built-in sidebars, about:addons/about:preferences, Reader Mode, PDF.js, about:newtab/privatebrowsing) bridged in one file. |
| `theme/parts/icons.css` | 589 | — |
| everything else under `theme/parts/` | 24–286 each | Already reasonably scoped by surface (urlbar.css, buttons.css, dialogs.css, sidebar.css, csd.css, etc.) — this is closer to the target shape than the three files above. |

33 CSS files total under `theme/`, but the three files above account for
**4,397 of ~8,355 total CSS lines (53%)** despite being 3 of ~40 files.
"Modularize" mostly means splitting those three, not restructuring
everything — most of `theme/parts/` is already close to the shape you want.

## Proposed target shape (draft — confirm before executing)

Not prescribing exact filenames yet since that's Decision 2 below, but the
direction: split `omarchy-chrome.css` by the same surface boundaries
`theme/parts/` already uses (a `theme/parts/tabsbar.css` exists — Omarchy's
tab-bar overrides belong beside it, e.g. `theme/omarchy/tabsbar.css`, not
buried inside one 2,652-line file), with a single import manifest file
(`omarchy-chrome.css` could *become* that manifest, the way
`theme/gnome-theme.css` already is one) rather than a file that both
manifests imports *and* contains thousands of lines of rules. Same idea for
`omarchy-content.css` split by privileged surface. `theme/parts/tabsbar.css`
itself (934 lines, base layer) is a second-order candidate once the Omarchy
layer is out of the way and its real remaining size is visible.

## Decisions (resolved 2026-08-12)

1. **New name — RESOLVED: `omarchy-chrome`.** Matches the CSS files that
   already used this name (`omarchy-chrome.css`, `omarchy-content.css`,
   `omarchy-features.css`, `omarchy-radius.css`). Now the AUR `pkgname`, the
   README title, and the nested install-folder convention.
2. **New CSS custom-property prefix — RESOLVED: `--omarchy-base-*`** for the
   former `--gnome-*` base-layer vocabulary, kept as a distinct sub-namespace
   from the override layer's existing `--omarchy-*` tokens (`--omarchy-radius-*`,
   `--omarchy-control-*`, etc.) rather than collapsing the two — preserves the
   existing two-layer override architecture (base sets defaults,
   `omarchy-chrome.css` overrides them) as a pure rename, no redesign.
3. **Preference-namespace migration — RESOLVED: rename outright, no alias.**
   `gnomeTheme.*` → `omarchyTheme.*`, clean break. Justified because this fork
   has never been published (no AUR package, no known external users), so
   "strands existing users' settings" was a theoretical risk, not a real one.
   Revisit this reasoning if the fork gets a real userbase before the next
   naming change.
4. **Design-map wording — RESOLVED.** `docs/omarchy-firefox-design-map.md`'s
   design rules and "Current layers"/"Ownership boundaries" sections now name
   `theme/base-theme.css` directly instead of "the GNOME base"; the
   underlying foundation-plus-overrides relationship is unchanged.

## Remaining work: the monolithic-file split

Not started. "Proposed target shape" above is still the working starting
point: split `omarchy-chrome.css` (2,652 lines) and `omarchy-content.css`
(811 lines) by surface, following the same boundaries `theme/parts/` already
uses, with `omarchy-chrome.css` becoming a pure import manifest rather than a
file that both manifests imports *and* contains thousands of lines of rules.
`theme/parts/tabsbar.css` (934 lines, base layer) is a second-order candidate
once the Omarchy layer split makes its real remaining size clearer.

This is a pure file-move-plus-import-manifest-update — no renaming needed
(that part is done), which makes it the lowest-risk remaining structural
change and the most direct route to the actual stated goal: making it easier
to keep adding Firefox 153+ features without bolting them onto one huge file.
Each split should land as its own reviewable change with a `visual-test` VM
pass before/after (per this repo's existing workflow), not as one combined
diff.

The permanent guardrail added to `scripts/check-omarchy.sh` (fails the build
if `--gnome-` or `gnomeTheme.` resurface anywhere in the tracked tree, with
an explicit allowlist for this doc and the check script itself) will keep
working unchanged through the file split, since it scans by content, not by
file path.

## Explicitly out of scope for this document

- Zen-Browser-style visual/feature additions — that's a separate roadmap
  layered on top of this restructuring, not part of it.
- Filling in the real repo URL / AUR maintainer identity in
  `scripts/generate-pkgbuild.sh` and `.github/workflows/release.yml` — both
  now use `omarchy-chrome` naming but still have `TODO_SET_*` placeholders
  where a real GitHub URL and maintainer contact are needed; filling those in
  requires you to actually publish the repo somewhere first.
