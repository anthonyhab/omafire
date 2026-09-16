# Firefox native skin audit (FF155 baseline)

Method: extracted `/usr/lib/firefox/omni.ja`, enumerated every custom
property defined under `browser/skin/classic/browser/` and
`toolkit/skin/classic/global/`, and cross-referenced writes in the
maintained layers. Numbers below are from that pass; regenerate with
`scripts/audit-native-skin.sh check`.

## Headline numbers

- Native tokens defined by the skin: **1274**
- Written by maintained layers: **162**
- Visual tokens (color/background/border/radius/shadow/outline/fill/
  separator) we never touch: **706** — of which ~200 are raw palette ramps
  (`--color-blue-40` etc.) that are inputs, not surfaces, and should stay.

## The leverage point

`toolkit/skin/classic/global/design-system/tokens-shared.css` (~364 tokens)
is the Acorn design-system layer: it defines the *semantic* vocabulary —
the `--button-*` state matrix (hover/active/selected/disabled/destructive/
ghost/muted/toolbar), `--border-color-interactive*`, `--background-color-*`
status surfaces, `--icon-color-*`, `--card-*`, `--table-*`, `--panel-*`,
`--popup-*`, `--toolbarbutton-*`, `--toolbarseparator-color`,
`--toolbox-text-color(-inactive)` — that every `moz-*` shadow component
(moz-button, moz-card, moz-message-bar, moz-toggle, moz-checkbox…) reads.

We currently patch these components per-element or not at all. Repointing
the semantic token family at `--omarchy-*` in one `:root` block themes all
of them at once and is the single strongest foundation move available —
the same trick the radius bridge already proved with
`--urlbarview-border-radius`.

Do **not** repoint the `--color-<hue>-<step>` palette ramps; they are the
raw material Firefox mixes from, and shadow components that mix hues would
lose their gradients. Only semantic tokens.

## Surface coverage (selector level)

Covered today: findbar, identity/protections popups, unified-extensions
panel, downloads panel, edit-bookmark, Library/places, menupopups,
translations panel, PiP glyphs.

Content-document coverage (userContent): `omarchy-content.css` bridges the
`--in-content-*` family for about:preferences/addons/logins/processes/
config plus the built-in sidebar docs, and a second Acorn block maps the
raw `--text-color`/`--background-color-*`/`--button-*`/`--card-*`/
`--table-*`/`--border-radius-*` family onto generated palette vars for all
`about:` and `chrome://…/content/` documents (about:support,
about:protections, toolkit dialogs). Palette values come from
`omafox-content-palette.css` — the content-scope generated file that omits
`color-scheme` and tabbox rules so ordinary web pages are untouched.
Themed docs opt into the generated scheme via
`color-scheme: var(--omarchy-color-scheme)`. All bridge declarations need
`!important`: userContent is user-origin, so normal declarations lose to
the pages' own author rules.

Nova note: `browser.nova.enabled` + `browser.newtabpage.activity-stream
.nova.enabled` are on in the profile — Mozilla's staged redesign (new
about:preferences layout, Nova newtab, `view-nova.css` urlbar variant,
density picker). Verified themed end-to-end on 2026-09-16; the
`about:preferences` "Find in Settings" pill and Nova newtab tiles are the
first Nova components still on native geometry.

Nova token layer (purged 2026-09-16, FoxOne-informed): Nova remaps
`--color-accent-primary{,-hover,-active,-selected}` to its violet palette
and paints `--toolbox-background-color-gradient-leading`; both are pinned
in omarchy-tokens.css alongside the satellites
(`--background-color-information`, `--icon-color-*`,
`--button-background-color-primary-disabled`, `--text-color`,
`--tabpanel-background-color`). Two substitution traps matter under Nova:
`--button-*-menu-*` (FF154+ panel rows) and `--uei-button-*` (extensions
gear) alias ghost tokens AT :root and inherit pre-baked — they must be
re-declared at the consuming scope (panel element / the button itself),
which omarchy-bridge.css now does. `--arrowpanel-*` is retired under Nova;
the live popup tokens are `--panel-background-color` / `-text-color` /
`-border-color` / `-separator-color` on `:is(panel, menupopup)`, with
`#DateTimePickerPanel` and `.autoscroller` excluded.

Nova DOM additions observed in the wild: `#ai-window-toggle`,
`#smartwindow-group-tabs-button`, `#smartwindow-ask-button`,
`#taskbar-tabs-audio`, `#document-pip-return-to-opener-button` in the
navbar; `#taskbar-tabs-button`, `#split-view-button`, `#share-button`,
`#pageActionButton` in the urlbar page-action cluster (cluster now
collapse-until-hover in omarchy-urlbar.css).

Not covered / partial:

| Surface | Native file | What's unthemed |
| --- | --- | --- |
| Ctrl+Tab panel | `tabbrowser/ctrlTab.css` | whole panel (no rules at all) |
| Hamburger panel lists | `customizableui/panelUI*.css` | `--panel-banner-item-*` banners, `--panel-list-*`, profiler header |
| Trust/identity panel | `controlcenter/panel.css` | `--trustpanel-*` cards, warning borders |
| Extensions panel | `addons/unified-extensions.css` | `--uei-button-*` states, attention dot |
| Smart-window buttons | `toolbarbuttons.css`, `smartwindowGroupTabs.css` | `--smartwindow-ask-btn-*`, `--swgt-*` (both toolbaritems live in browser.xhtml) |
| Smartbar | `smartbar.css` | `--smartbar-*` (18 tokens; new urlbar variant — watch) |
| Tab chrome | `tabbrowser/tab.tokens.css`, `tabs.css` | `--tab-attention-dot-color`, `--tab-outline-color`, `--tab-selected-outline-color`, `--tab-loading-fill`, `--tab-dragover-outline-color`, `--arrowscrollbox-scrollicon-*`, `--audio-overlay-extra-background`, `--tab-vertical-scrollbar-color` |
| Urlbar breakout | `urlbar-searchbar.css` | `--urlbar-background-border*`, `--urlbar-input-container-*` breakout borders/shadows, `--cfr-*` callouts |
| Urlbar view rows | `urlbar/urlbarview.tokens.css`, `view-nova.css` | `--urlbarview-*` result buttons/separators, `--urlbarView-tail150-*` SERP overlay, market/status colors |
| WebRTC indicator | `webRTC-indicator.css` | whole sharing indicator (17 tokens) |
| Reader Mode | `global/aboutReader.css`, `narrate.css` | toolbar/popup/tooltip tokens, narrate highlight |
| Datetime pickers | `global/datetimeinputpickers.css` | whole widget (26 tokens) |
| PiP player | `pictureinpicture/player.css`, `media/pipToggle.css` | player bg/controls, toggle outline |
| Error pages | `global/aboutNetError.css`, `blockedSite.css` | `--message-bar-*`, `--warning-color` |
| In-content warnings | `global/in-content/common-shared.css` | `--input-*-warning`, `--message-bar-*-warning` |
| Dialogs | `migration/`, `pageInfo.css`, `sharePanel.css`, `sanitizeDialog_v2.css`, `setDesktopBackground.css` | whole windows (no lwtheme; rely on generated palette) |
| Private-browsing page | `privatebrowsing/aboutPrivateBrowsing.css` | `--content-search-handoff-ui-*` search box + banner |
| Misc | `popup.css`, `menu.css`, `global-shared.css`, `findbar.css` | `--panel-box-shadow`, `--menuitem-icon-fill`, `--autoscroll-background-image`, `--toolbar-color-scheme`, `--findbar-border-top-width` |
| Container editor | `usercontext/container-editor.css` | `--visual-picker-item-*` |

## Structural notes for version churn

- Firefox 155 renamed selectors we previously styled by id:
  `#sidebar-main` → `sidebar-main` (custom element),
  `#urlbar-searchmode-switcher` → `.searchmode-switcher` (moz-button),
  `#urlbar-go-button` → `.urlbar-go-button` (html:img). Each rename
  silently dead-ended our rules — exactly the failure mode the selector
  canary in `audit-native-skin.sh` exists to catch on upgrades.
- `--toolbar-color-scheme` / `--tab-selected-color-scheme` are live
  color-scheme control tokens worth owning alongside `color-scheme`.
- Dialog surfaces (`pageInfo`, `sanitize`, `migration`, `sharePanel`) get
  no `[lwtheme]`; they ride the generated `:not([lwtheme])` palette like
  the Library window already does.

## Plan

1. Bridge the `tokens-shared`/`tokens-platform` semantic family to
   `--omarchy-*` in `omarchy-chrome.css` (chrome) and `omarchy-content.css`
   (in-content), mirroring the existing radius bridge.
2. Sweep the uncovered surfaces above in priority order: urlbar view rows
   and breakout chrome, hamburger panel lists, trust panel, tab chrome
   states, then the standalone dialogs.
3. Keep `scripts/audit-native-skin.sh check` in CI/static checks: it
   regenerates the token inventory from the installed omni.ja and diffs
   against `tests/native-skin-baseline.txt`, flagging new visual tokens
   (new skin surface to theme) and vanished selectors (possibly dead
   rules) on every Firefox bump.
