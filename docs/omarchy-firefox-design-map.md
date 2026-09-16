# Omarchy Firefox design map

This is the working checklist for the Omarchy/Cascade Firefox overhaul. It
records what has been changed, what has been visually exercised, and what
still needs a focused pass so future work does not restart the same audit.

## Design rules

- Keep the audited Firefox-GNOME/Adwaita compatibility foundation
  (`theme/base-theme.css`) as the base layer; add narrow Omarchy overrides
  on top rather than editing it into a second, competing design system.
- Prefer flat surfaces, the shell's measured spacing scale, readable neutral
  foregrounds, monospace chrome typography, and sharp borders.
- Use foreground washes for chrome hover/selected/pressed fills. Use the live
  Hyprland active-border color for chrome focus rings and selected edges.
  Privileged content uses scheme-paired surfaces and contrast-corrected action
  hues instead of inheriting an unverified chrome accent.
- Source radius, border width, and active/inactive border colors from the
  generated Hyprland tokens.
- Style the real native content surface once; do not stack transparent shells,
  duplicate popup containers, or shadows.
- Treat Firefox content pages and extension-owned pages as separate surfaces;
  do not assume `userChrome.css` can style them.

## Current layers

1. `theme/base-theme.css` (audited Firefox-GNOME/Adwaita lineage) remains the
   base theme.
2. `userChrome.css` imports the generated radius tokens, the base theme,
   maintained `omarchy-chrome.css`, the privileged-content bridge, and the
   geometry-safe state cues. Ignored `customChrome.css` remains the final
   user-owned override. The GTK-token import (`generated-gtk-colors.css`)
   was retired on 2026-08-21: cold-start palette ownership moved to the
   built-in `firefox-compact-dark@mozilla.org` theme (see the evidence log),
   with `customChrome.css` as the no-lwtheme degradation net.
3. `userContent.css` imports `omarchy-content.css` for Firefox View and
   built-in sidebar documents without touching ordinary websites. It also
   imports the generated `omarchy-radius.css` so privileged content surfaces
   share the same Hyprland rounding as chrome; the import defines custom
   properties only and changes nothing on ordinary websites.
4. `scripts/generate-omarchy-radius.sh` generates optional live radius and
   border tokens from Hyprland, with legacy settings as fallback. It writes
   beside either the direct development entrypoint or the standard nested
   `omarchy-chrome/` entrypoint (falls back to the pre-rebrand
   `firefox-gnome-theme/` name for profiles set up before the rename).
5. `omarchy-chrome.css` bridges Pywalfox/LWT variables into semantic Omarchy
   surfaces, foregrounds, fields, panels, hover, selection, and borders.
6. The external `omarchy-firefox-test` harness runs a separate copy-on-write VM
   with a sanitized clone of the real Firefox profile; it is not shipped here.

## Ownership boundaries

- Maintained source includes the named Omarchy layers, the audited base theme,
  icon assets, and checks.
- `omarchy-radius.css` is generated profile state. `customChrome.css` and
  `customContent.css` are user-owned overrides. The `generated-gtk-colors.css`
  layer is retired (see the layer list above); `scripts/autothemer.sh` and its
  test remain only as unused tooling.
- There is no runtime installer script; the end goal is a static AUR package
  (`pkgname=omarchy-chrome`, a payload staged under `/usr/share/omarchy-chrome/`)
  plus the manual `omarchy-chrome` checkout/symlink and `@import` steps
  documented in `README.md`. A packaging hook must not write into a user's
  profile directory, so profile wiring stays a one-time, user-run step
  regardless of how the payload itself is distributed.
- The favicon helper is a separate privileged installation. Its installer
  replaces only exact current or SHA-256-enumerated legacy payloads.

## Completed and visually checked

The table is an accumulated design record. `Checked` entries can refer to the
historical VM runs listed below; only entries named by the newest run should be
treated as fresh evidence for the current worktree.

| Area | State | Notes |
| --- | --- | --- |
| Chrome surfaces and text | Done (base states) | Flat Pywal-derived surfaces, shell-aligned monospace typography, and readable neutral foregrounds; navigation controls use a spaced icon rail. |
| URL bar layout | Done (base/focus states) | Flexible input, explicit control rhythm, identity/search spacing, and native breakout outline replaced by Hyprland border tokens. |
| URL autocomplete | Done | Readable URLs/actions, flat panel, dynamic border, no shadow. |
| Horizontal tabs | Done | Selected tab is an accent line/subtle surface rather than a full bright card; regular cells stay 200px, Split View owns two 100px grid children, and overflow keeps fixed bidirectional controls. |
| Collapsed vertical tabs | Patched, unverified | Icon rail, hidden close overlay, compact selected/hover states. Rail geometry was rewritten to a fixed 32px cell/2px gap/3px inline-offset ladder (`--tab-collapsed-width` now 39px, replacing the ~46px width the `20260804T233321Z-1533055` and `20260805T161657Z-454309` evidence runs were captured against); needs a fresh VM pass rather than carrying forward the prior "Done" status. |
| Tab groups | Patched, unverified | Palette mapping from Pywalfox's live primary/attention colours to Firefox's nine named group colours, a flattened editor swatch picker, drag-target cue, and container-identity color reuse. No VM screenshot pass yet. |
| Vertical-tab onboarding | Patched | Palette tokens are supplied to Firefox's shadow-component inheritance path. |
| Main menus/popups | Done (representative states) | Native content parts receive the border; shells stay transparent; shadows removed. |
| Firefox View | Done (base states) | Scheme-paired surfaces and foregrounds, a contrast-corrected action accent, square geometry, flatter cards, thin scrollbars, and no light/dark Theme API misclassification. |
| Customize Sidebar | Done (base states) | Built-in sidebar shadow components now receive dark Omarchy/GNOME tokens, monospace typography, square cards, readable disabled states, and the live Hyprland focus color. |
| Quiet state cues | Done (base implementation) | Horizontal attention marker, tab count in the existing overflow cell, and thin in-UI scrollbars without hiding security-relevant status text. |
| Focus, hover, selected, and pressed states | Done (representative states) | Native XUL, HTML, and `moz-*` shadow controls share a single 1px Hyprland focus edge and the shell's 8%/18%/22% foreground-wash ladder; modern inputs no longer stack their UA outline over the field border. |
| URL bar/tab/toolbar context menus | Checked | Flat, dark, readable, rounded according to generated geometry. |
| Built-in sidebars | Done (base states) | Customize, bookmarks/Places trees, history, synced tabs, and contextual passwords share the dark Omarchy palette, fields, cards, typography, selected rows, and square geometry. |
| Find bar | Checked | Dark field, readable controls, dynamic border color. |
| Library/downloads window | Patched and checked | `places.xhtml` had white/gray surfaces; it now has a dark Omarchy fallback and styled tree rows/search. |
| Pywalfox integration | Checked | Real extension and matching native host work in the Firefox VM. |
| Hyprland geometry | Done | Rounding and active/inactive border width/color/gradient generation is live; compositor-owned window controls are removed from Firefox chrome. |
| Startup layer count | Done | One named maintained stylesheet replaces the overloaded generated/user file; optional generated and user override imports have single owners. |
| Firefox VM foundation | Done | Persistent `omarchy-firefox-test` base includes Firefox 153.0.1. |
| Real-profile test sync | Done | Toolbar state, vertical-tab state, extensions, and non-sensitive profile settings are copied without browsing data or credentials. |

## Interaction audit matrix

`Checked` means a representative interaction has a screenshot. `Audited`
means the surface was inspected but still needs a focused styling pass.

| Surface / interaction group | Status | Next action |
| --- | --- | --- |
| Initial browser window / inactive chrome | Checked | Recheck after any palette change. |
| URL bar focus, typing, search mode, identity state, autocomplete | Checked | Exercise permissions and page-action variants. |
| URL bar selection/edit context menu | Checked | None currently. |
| New tab, close tab, reload, duplicate, pin/unpin | Partial | Run as a keyboard/mouse group. |
| Tab context menu, Split View, and tab overflow | Checked | A 17-tab run covered both scroll directions, the overflow count, and two-column Split View; exercise the overflow popup entirely by keyboard. |
| Horizontal/vertical tab switching and resizing | Partial | Horizontal overflow and sidebar pointer resizing are checked; recheck expanded, collapsed, hover-expand, keyboard splitter focus, and drag-to-pin together. |
| Toolbar context menu and Customize Toolbar | Checked | Exercise drag/reorder/reset and overflow. |
| Main application menu and submenus | Checked | Exercise Bookmarks, History, More Tools, Help, and disabled states. |
| Unified extensions menu | Pending | Check overflow, extension rows, and keyboard navigation. |
| Extension popups | Partial | uBlock and Dark Reader checked; extension-owned styling is a boundary. |
| Firefox View | Checked | Base page, open/recent/device cards, neutral text, action links, search, paired dark/light states, and Customize Sidebar checked together. |
| Bookmarks/history/synced-tabs/password sidebars | Checked | Modern and legacy Places documents, synced/empty states, contextual passwords, Customize Sidebar, and the vertical-tab transition were exercised. |
| Downloads panel and real download states | Audited | Test in-progress, completed, failed, blocked, and context-menu states. |
| Library: history, bookmarks, downloads, search, tree selection | Checked | Exercise context menus and import/export dialogs. |
| Add-ons manager | Patched, unverified | `omarchy-content.css` now bridges the same `--in-content-*`/`--card-*`/`--button-*` acorn-design-system tokens already proven for the sidebar to `about:addons`, and flattens `moz-card`/`addon-card` radius. Needs a VM screenshot pass. |
| Settings/preferences | Patched, unverified | Same token bridge extended to `about:preferences`; previously had zero dedicated coverage at all. Needs a VM screenshot pass. |
| Site identity, permissions, tracking protection, notification prompts | Pending | Use a local test page and capture every popup state. |
| Bookmark star and edit-bookmark panel | Pending | Check fields, validation, folder tree, and completion buttons. |
| Find bar | Checked | Check no-match, match count, toggles, and close behavior. |
| Private window and private new-tab page | Patched, unverified | Card corners flattened, monospace body font added. Colors still come from the Pywalfox extension's live LWT theme, not this stylesheet. Needs a VM screenshot pass. |
| New-tab/home page and customization menu | Patched, unverified | Search box, top-site tiles, and cards flattened (radius/shadow/border) on top of the existing Pywalfox-driven background bridge. Needs a VM screenshot pass; Activity Stream class names can drift between Firefox versions. |
| Reader mode and PDF viewer | Patched, unverified | Reader Mode's own light/sepia/dark/contrast content theme is left alone deliberately (a reading-comfort choice, not branding); only its "auto" scheme and toolbar chrome are bridged. PDF.js viewer is bridged through its own supported `--main-color`/`--body-bg-color`/`--toolbar-bg-color` design tokens rather than layout selectors. Both need a VM screenshot pass; lower confidence than the acorn-token bridges since these surfaces weren't inspected live. |
| Print preview, save page, file chooser, certificate dialogs | Pending | OS-native pickers stay outside userChrome scope. Tab-embedded prompts (`.dialogBox` inside `.dialogOverlay` — extension permission/removal, HTTP auth) were unstyled and fell back to the hosted page's light color-scheme with a bright chrome foreground, producing unreadable text; `theme/parts/dialogs.css` now scopes `color-scheme` to the overlay and paints `.dialogBox` with the same dark tokens as `window[role="dialog"]`. Source-level fix only; needs a VM screenshot pass to confirm. |
| DevTools, Picture-in-Picture, fullscreen, find-in-page | Pending (deliberate) | DevTools ships its own complete theme system (`--theme-*` tokens, user-selectable Light/Dark/Firefox Automatic) independent of userChrome/userContent; the PiP player is a minimal video-only surface with little styling surface and real risk if controls become unreadable. Both were left untouched rather than guessed at without live verification — narrow overrides only, per this file's own design rule. Unified extensions menu confirmed already covered (generic panel tokens plus dedicated button/icon/margin rules in `theme/parts/buttons.css`, `buttons-fixes.css`, `icons.css`); its Pending status is about interaction testing, not missing styles. |
| Window inactive state and multi-window layout | Partial | Active/inactive border tokens are implemented and Firefox CSD close/minimize/maximize controls are hidden; capture both states. |
| Dynamic Hyprland radius/border changes | Checked synthetically | Repeat with a nonzero live Hyprland border when needed. |

## CSSHacks review disposition

Reviewed [`MrOtherGuy/firefox-csshacks`](https://github.com/MrOtherGuy/firefox-csshacks)
at commit `8d4814857f39c522e1e1d0bd704a168336ca1d3a` as an idea library,
not a stylesheet dependency. The existing Firefox-153 grid already implements
most compact/sharp layout ideas more precisely, so importing Proton, sharp-tab,
one-line, autohide, vertical-tab, or toolbar-reordering modules would create a
second geometry owner.

`omarchy-features.css` contains palette/geometry rewrites informed by
`chrome/dual_color_tab_attention_indicator.css` and
`chrome/tab_count_in_alltabs_button.css`; that file is marked MPL-2.0 and its
notice is recorded in `THIRD_PARTY.md`. The thin-scrollbar rule is local.
Security-relevant link targets remain visible in every fullscreen mode.

Deferred: a compact extensions panel that preserves permission/status messages,
semantic insecure-connection cues, and loading progress treatments after their
native states receive dedicated interaction tests. Rejected: status inside the
URL bar (upstream warns of long-session slowdown), draggable URL bars, one-line
or autohide toolbars, hover-only controls, browser-owned window controls, and
wholesale alternate tab/toolbar layouts.

## External VM test workflow

The following commands belong to the user-local `omarchy-firefox-test` harness,
not this repository. The retained evidence paths are therefore historical
local evidence rather than branch CI artifacts.

```bash
omarchy-firefox-test up --host-shell --headless
omarchy-firefox-test profile-sync
# Run one interaction group and capture screenshots.
omarchy-firefox-test check --json
omarchy-firefox-test down
```

The real-profile sync excludes cookies, history, saved passwords, session
restore data, extension storage, and account identifiers. It copies extension
packages and toolbar/profile layout state. The default test palette is stored
at `~/.config/omarchy-firefox-test/colors.json`; set
`OMARCHY_FIREFOX_TEST_WAL_COLORS` to use another Pywal colors file.

Evidence is retained under `~/.local/state/omarchy-firefox-test/runs/`.

## Current evidence

- `20260803T160512Z-328312`: first real-profile migration and broad chrome audit.
- `20260803T173218Z-444672`: persistent Firefox base/profile-sync smoke test.
- `20260804T163239Z-497197`: shell-rhythm pass covering normal chrome, native
  hover/focus states, horizontal overflow in both directions, and expanded/
  collapsed vertical tabs (`vibe-final*.png`, `keyboard-focus-*.png`). The
  final harness check passed over 8,977 scoped journal lines.
- `20260804T172142Z-554307`: pixel-alignment pass covering the full 36px URL
  field, single-layer Firefox View hover, exact 200px tab paint/content boxes,
  pinned/regular tab leading edges, one new-tab action in overflow, fixed
  all-tabs geometry, autocomplete below the horizontal tab row, and expanded/
  collapsed vertical safety (`micro-final*.png`, `micro-verified*.png`). The
  final harness check passed over 12,718 scoped journal lines.
- `20260804T225404Z-1248885`: privileged-content consistency and CSSHacks cue
  pass. `firefox-view-with-dark-sidebar-final.png` proves neutral Firefox View
  text/action semantics and the dark square Customize Sidebar together;
  `sidebar-label-proof.png` proves readable unchecked/checked/disabled control
  states; `vertical-layout-proof.png` proves the native vertical transition;
  `sidebar-bookmarks-complete-proof.png`, `sidebar-history-final.png`,
  `sidebar-synced-final.png`, and `sidebar-passwords-dark-proof.png` cover all
  enabled built-in sidebar families; `overflow-tab-count.png` proves the 15-tab
  overflow counter. A WebDriver BiDi system-access probe also measured Firefox
  View as dark with a neutral
  `rgb(247, 245, 248)` foreground on `rgb(23, 24, 32)`. The final harness
  check passed over 8,639 scoped journal lines.
- `20260804T233321Z-1533055`: first spacing-consistency follow-up. The saved
  bookmark star now uses the live Pywal toolbar accent instead of Firefox's
  stock yellow, and the vertical-mode navbar controls are shifted by the
  native rail calculation so the sidebar button is pixel-centered over the
  collapsed tab column. `spacing-star-final-2.png` and
  `vertical-rail-alignment-hover.png` provide the visual proof; a BiDi geometry
  probe measured the sidebar button at `x=7, width=32` over a 46px rail and the
  final harness check passed over 4,999 scoped journal lines. Superseded: the
  `#nav-bar-customization-target` centering rule this run proved was later
  removed from `omarchy-chrome.css` (a fixed collapsed-rail width no longer
  matches the 46px this formula was tuned against, and the recalculation was
  causing the whole navbar to snap sideways mid-animation whenever `expanded`
  toggled) — see the "Collapsed vertical tabs" row above; this evidence is
  historical only and does not describe the current worktree.
- `20260804T235750Z-1858466`: high-zoom sidebar repair prompted by populated
  Passwords and synced-device screenshots. Firefox-GNOME's broad entry rule
  had overridden Megalist's nested readonly fields, producing overflowing
  labels, boxed values, and a duplicate nonfunctional reveal glyph. The bridge
  now restores Megalist's field geometry, leaves only its reauthentication-aware
  reveal action, uses one search focus border, lowers sidebar type to 14px with
  a 1.3 line-height, reduces card-border contrast, and wraps long device names.
  `passwords-populated-150-final-clean.png`,
  `passwords-populated-100-final.png`, and
  `synced-device-card-150-final-2.png` prove populated 100%/150% states. The
  dummy credentials and device card existed only in the disposable VM. The
  final harness check passed over 4,769 scoped journal lines.
- `20260805T044353Z-3807011`: interaction-state audit prompted by the doubled
  Synced Tabs search focus ring. Firefox 153's modern `moz-input-search` no
  longer exposes the compatibility layer's old adjacent-link selector, so the
  real shadow input now owns a single inset 1px Hyprland edge. The same pass
  centralizes native button/menu state tokens and content-page hover, selected,
  and pressed washes. `focused-synced-tabs-final-11.png`,
  `focused-findbar.png`, `focused-urlbar-final-8.png`,
  `active-menu-hover-final-2.png`, and `active-menu-pressed-final.png` cover
  representative modern input, native input, URL bar, and panel states. Pixel
  probes measured exact one-pixel orange perimeters on both search and URL
  fields; hover and pressed menu fills measured as distinct shell washes. The
  final harness check passed over 11,043 scoped journal lines.
- `20260805T161657Z-454309`: current-worktree Firefox 153.0.1 regression pass.
  `horizontal-overflow-direct-fixed.png` and `horizontal-overflow-scrolled.png`
  prove fixed 32x40 scroll cells, visible 18px arrows, a dimmed rather than
  collapsed boundary action, and stable tabs in both directions;
  `scroll-controls-final.json` records the same computed geometry.
  `split-view-current.png` and `split-geometry.json` prove a 200px wrapper with
  two non-overflowing 100px children. `sidebar-resized-current.png` proves the
  native splitter remains draggable. `rtl-synthetic-current.png` exercises the
  chrome's mirrored geometry with a synthetic root direction, while
  `firefox-view-dark-current.png` and `firefox-view-light-synthetic.png`
  exercise both Theme API states with paired surfaces and foregrounds. Finally,
  a user-owned copy of the Firefox application tree loaded the app-owned
  AutoConfig helper; `favicon-runtime-tabs.png` and `favicon-runtime.json`
  record a black favicon choosing `invert`, a white favicon remaining
  `original`, and bounded caches. The helper was then disabled and purged from
  the disposable copy. The final harness check passed over 19,350 scoped
  journal lines.

All runs passed the Omarchy harness shell check with no missing types, type
errors, binding loops, unknown properties, shell crashes, or IPC failures.

- `2026-08-07` (source-level, no VM run yet): fixed the tab-embedded prompt
  readability bug (extension removal/permission confirmation rendering
  near-white text on a near-white card) by giving `.dialogOverlay` its own
  `color-scheme` and painting `.dialogBox` with the same dark tokens as
  `window[role="dialog"]` in `theme/parts/dialogs.css`. Then extended coverage
  to five previously-uncovered or partially-covered surfaces: `about:addons`
  and `about:preferences` (new acorn-design-system token bridge in
  `omarchy-content.css`, reusing the pattern already proven for the sidebar),
  Reader Mode's "auto" scheme and toolbar chrome, the built-in PDF.js viewer
  (via its own `--main-color`/`--body-bg-color` design tokens), and geometry
  flattening for `about:newtab`/`about:home`/`about:privatebrowsing` cards.
  DevTools and the Picture-in-Picture player were deliberately left untouched
  (own theme system / high risk-to-benefit ratio). Also removed dead
  `/* DEBUG probe */` comment scaffolding from `userContent.css`. No live
  Firefox rendering was verified in this pass — the working session only had
  Chrome browser automation tools available, not Firefox. Every "Patched,
  unverified" row above needs a `visual-test` VM screenshot pass, and the
  lower-confidence selectors (Activity Stream class names, PDF.js/Reader Mode
  toolbar internals) should be spot-checked first since Firefox can rename
  those between releases.
- `2026-08-21` (startup flashbang fix): the cold-start white flash was
  `extensions.activeThemeID` pointing at `omarchy-boot-theme@bb.hab.rip`, a
  static theme XPI that release Firefox never installed — unsigned sideloads
  dropped into the profile `extensions/` dir are silently refused, so the ID
  dangled and every launch fell back to the default LIGHT theme until
  Pywalfox's runtime `theme.update()` landed. Proven in the
  `omarchy-firefox-test` VM with per-frame whiteness captures: control run
  spiked to 94% white for a frame; staging the XPI changed nothing (it never
  registered in `extensions.json`); switching to the built-in signed
  `firefox-compact-dark@mozilla.org` — applied from Firefox's own startup
  data ahead of any extension — produced zero white frames across 80
  consecutive startup captures with dark chrome from the first painted
  frame. Shipped: profile `user.js` now pins compact-dark as the cold-start
  theme (pywalfox re-tints live moments later; dark->dark handoff), the
  page-base prefs were darkened (`browser.display.background_color`
  `#eee`->`#000000` plus explicit white foreground), the `customChrome.css`
  no-lwtheme fallbacks were retuned to the live palette, and the
  never-generated `generated-gtk-colors.css` import was retired. The
  `firefox-boot-theme-gen.sh` hook remains in place but its output only
  loads on signing-exempt builds (Nightly/Dev/ESR); do not wire it into
  theme pipelines for release Firefox.
- `2026-09` (Firefox 155 urlbar/rail repair): Firefox 155 replaced the XUL
  urlbar with `html:moz-urlbar` + `moz-button`/`moz-input-box` custom
  elements. Retired selectors: `#urlbar-searchmode-switcher` (now
  `.searchmode-switcher`, flattened via `--button-*` tokens on the host),
  `#urlbar-go-button` (now `html:img.urlbar-go-button`, sized with
  `border-box` + `object-fit: contain`), `.urlbar-textbox-container` (now
  `.urlbar-input-container`), `.urlbar-icon-wrapper`, and `#sidebar-main`
  (now the `sidebar-main` element). New tokens wired: FF155's
  `--toolbar-field-background-color-focus`, `--toolbar-field-border-color*`,
  `--urlbar-box-*`, and `--urlbar-margin-inline` (zeroed — it fed a one-sided
  breakout-extend drift). Field paint model: `.urlbar-background` (absolute,
  inset:0) carries field color + the 1px frame; `.urlbar-input-container` and
  input layers stay transparent so they cannot cover the frame; focus swaps
  the border for an inset accent shadow at the same geometry, so nothing
  moves. Collapsed rail: tabs fill the rail (`width: 100%`,
  `transform: none` — the old 3px `translateX` left icons off-center), and
  the 32px `.tab-background`/`.tab-content` cells center via
  `margin-inline: auto`/`justify-self: center`; `#tabs-newtab-button` (the
  live one — `#vertical-tabs-newtab-button` is a hidden twin) joins the same
  centered 32px cell and gets the shared hover ring. Interaction cues are now
  tokenized as `--omarchy-ring{,-hover,-focus,-inactive,-kbd}` = inset
  `0 0 0 1px` shadows; borders and outline-offset tricks that could shift
  layout on state change were removed or pre-reserved (e.g. the selected
  tab's `border-inline-start: 1px` is always allocated, only its color
  changes). Follow-up fixes: the focused urlbar's `margin: -1px` (a native
  compensation for a border that no longer grows) shifted the whole input
  cluster 1px — pinned to 0. The rail's newtab button needs both ids covered
  (`#tabs-newtab-button` and `#vertical-tabs-newtab-button` trade visibility
  depending on state). `#nav-bar` gained `padding-inline: 3px` so its first
  button centers at x=23 — the same column as the rail's cells. Collapsed
  `#tabbrowser-tabs` gets `padding-block-start` and the group label collapses
  to a 22x4 group-colour bar; both needed a `#main-window` prefix to beat
  native `!important` resets.
- `2026-09-16` (radius bridge + exact live palette): the Ctrl+L rounded
  corner was Firefox's own design tokens — nothing set
  `--urlbarview-border-radius`, so the focused urlbar fell back to
  `calc(var(--button-border-radius) + 2px)` = 10px and `.search-one-offs`
  hardcoded `0 0 8px 8px`. `omarchy-chrome.css` now re-derives every
  `--omarchy-base-*-radius` from generated `--omarchy-radius-container`/
  `--omarchy-radius-input` and repoints the whole Firefox token family
  (`--border-radius-*`, `--button-*`, `--toolbarbutton-*`, `--tab-*`,
  `--menuitem-*`, `--input-text-*`, `--card-*`, `--panel-*`,
  `--arrowpanel-*`, `--urlbar*`) at them; `--border-radius-circle` stays a
  pill. Every visible `border-radius: 0` on buttons/fields/tabs/rows was
  tokenized; inner transparent wrappers and edge-attached panels
  (`.browserContainer`, sidebar, infobars) stay structurally flat.
  `userContent.css` now imports the generated radius tokens so privileged
  content surfaces (newtab tiles, private-browsing card, addon cards,
  Megalist sidebar, video control bar) follow the same Hyprland rounding.
  Palette side: `customChrome.css`'s stale hand-tuned fallback
  (`#1d1d1d`/`#252525`) was deleted — generated `omafox-palette.css` owns
  first paint exactly. The maintained `--toolbar-field-*` pins moved under
  `:root:not([lwtheme])` because under a live theme Firefox writes the
  omafox palette straight into `--toolbar-field-background-color`,
  `--panel-background-color`, `--toolbarseparator-color`,
  `--toolbar-field-border-color`, `--lwt-text-color`, and
  `--lwt-tab-line-color`; a new `:root[lwtheme]` block re-derives
  `--omarchy-{fg,muted,field,panel,border,accent}` from those instead of
  the old color-mix approximations, so the applied theme and the generated
  first-paint palette are the same values. The stale Rosé-Pine-hardcoded
  places.xhtml block was removed — Library windows have no `[lwtheme]`, so
  the generated palette already covers them.
