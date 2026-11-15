# Omafire theme

A Firefox userChrome theme for [Omarchy](https://omarchy.org/): flat, square
chrome in the shell's monospace, one quiet visual language shared by the
chrome and Firefox's own pages, and the page flush against a single top
toolbar and a column of vertical tabs.
Optional modes add Zen-style touches: a single-sidebar layout that can
disappear entirely, a centred launcher, glass chrome or a floating content
card. Colors follow the current Omarchy theme live through
[Omafire](https://github.com/cover/omafox).

Requires **Firefox 159 or newer with Nova** (`browser.nova.enabled`, which
omafire setup turns on). The test matrix passes on 159.0.1 and 160.0; later
versions install but are untested until the matrix passes on them. Older layouts are not
supported.

## Install

The usual path is Omafire: `omafire setup` installs this theme into every
Firefox profile and keeps its palette and window rounding in sync with
Omarchy. See the Omafire README.

To run from a checkout instead (for development), point the profile's
`chrome/` directory at this `theme/` directory of an omafire checkout
(a symlink) and run `omafire setup` once; it recognises the checkout and
writes only the generated files beside it.

Then set these in `about:config`:

| Preference | Value | |
|---|---|---|
| `toolkit.legacyUserProfileCustomizations.stylesheets` | `true` | load userChrome (omafire sets it) |
| `browser.nova.enabled` | `true` | Nova design (omafire sets it) |
| `sidebar.revamp` | `true` | the sidebar the layout is built on |
| `sidebar.verticalTabs` | `true` | vertical tabs |

Optional, all applied live without a restart:

| Preference | Value | Effect |
|---|---|---|
| `omafire.layout` | `"sidebar"` | Zen's single sidebar: toolbar and urlbar at the top of the tab column, floating page, centred launcher. `"line"` (horizontal tabs): one bar-tall row of navigation, a fixed-width field, the tabs and the actions. Unset (or `"top"`) is the default top toolbar. |
| `omafire.launcher` | `"center"` | Launcher shape (sidebar layout). Unset (or `"drop"`) is a quake console: with horizontal tabs it slides full width down from the window's top edge, with vertical tabs it slides out of the tab column over the page, leaving the tabs in view. `"center"` floats it as a card. |
| `omafire.compact` | `true` | Zen: in the sidebar layout, hide the column until the pointer reaches the edge or Ctrl+L opens the field. With the sidebar collapsed the icon rail stays visible. |
| `omafire.chrome-gap` | `true` | Float the page as a card with a gap, Hyprland rounding and a hairline shadow. |
| `omafire.translucency` | `true` | Glass chrome (frosted with a Hyprland blur rule for Firefox). |
| `omafire.transparency` | `"0.50"`–`"1.00"` | Glass opacity in 0.01 steps (default 0.85); glass pages share it. Never below the theme's glass floor (`--omafire-glass-floor`): the lowest opacity at which text still reads over the theme's wallpapers, measured by `omafire sync`. |
| `omafire.glass-pages` | `true` | With glass chrome: pages on the glass too. Cinder paints each page's base translucent and its grey structure in steps over it; the page card drops its canvas. Needs Cinder. |
| `omafire.tab-numbers` | `true` | Show the Alt+1…8 digit on the first eight tabs: on pinned tiles, rail tiles and split pairs, a legend notched into the tile's left edge, btop-style; beside an expanded row, in the gutter to its left. Tabs hidden in collapsed groups are skipped, as Firefox skips them. |
| `omafire.extension-glyphs` | `false` | Keep extensions' own icons. By default known extensions get monochrome glyphs that tint with the toolbar (needs `svg.context-properties.content.enabled`, which omafire sets). |

Personal tweaks go in `customChrome.css` / `customContent.css` beside the
entrypoints. They load last and are never shipped.

## Layout of the code

```
userChrome.css          entrypoint: generated inputs, tokens, surfaces, layouts, modes
userContent.css         entrypoint for Firefox-owned pages (never websites)
src/tokens.css          the only file that picks colors and geometry
src/type.css            monospace chrome typography
src/frame.css           window surface, content area, split view, window controls
src/toolbar.css         navigation toolbar row and buttons
src/urlbar.css          address field and results
src/sidebar.css         sidebar rail, tools, and panel
src/tabs.css            vertical tabs, pinned tiles, tab groups
src/popups.css          menus, panels, notification bars, findbar
src/icons.css           extension id → glyph (src/icons/extensions/*.svg)
src/launcher.css        urlbar launcher: quake drop or centred card (sidebar layout)
src/motion.css          sidebar expand/collapse and resize motion
src/layouts/sidebar.css omafire.layout = "sidebar"
src/layouts/docked.css  vertical tabs in the top layout: the docked bar row
src/layouts/line.css    omafire.layout = "line": tabs in the navigation row
src/modes/compact.css   omafire.compact
src/modes/gap.css       omafire.chrome-gap
src/modes/translucency.css  omafire.translucency
src/modes/tab-numbers.css   omafire.tab-numbers
src/tokens-content.css  the same tokens for about: pages, from the content palette
src/content.css         new tab and about: pages; variables for Cinder on web pages
```

The default layout is the top toolbar, which is Firefox's own flow with
vertical tabs; `frame.css` and the surface files style it. Every other
layout or mode is one file gated on its pref, so adding one never changes
the others. Modes change tokens where they can (`gap.css` is three token
overrides) rather than restyling elements.

Generated by Omafire and gitignored: `omafire-palette.css` (the `--omarchy-*`
palette and Firefox's theme variables, in place of a lightweight theme),
`omafire-content-palette.css`, and `omafire-radius.css` (Hyprland's
rounding, border width, and active/inactive border colors).

## Rules

These keep a small theme small. `node scripts/lint.mjs` checks the first two,
and that every Firefox variable rule 3 sets exists in the installed Firefox.

1. **Every declaration is `!important`**, except `--oc-*` token definitions.
   userChrome is a user-origin sheet; without `!important` Firefox's own
   rules win, silently.
2. **Only the token files pick colors** (`src/tokens.css`, and
   `src/tokens-content.css` for about: pages). Components read `--oc-*` tokens.
   Tokens read Firefox's theme variables first and fall back to the
   `--omarchy-*` palette; `omafire-palette.css` sets both, and
   `live-palette.uc.js` replaces them on a theme switch, which repaints
   without a restart.
3. **Steer Firefox through its own variables where it has them**
   (`--tab-pinned-*`, `--toolbar-shift-translate`, `--urlbar-width`, …)
   rather than restyling the element they drive. Firefox keeps those
   working across releases; selectors against internals break.
4. **Gate layouts and modes on prefs.** Each lives under its own
   `@media -moz-pref(...)` (string prefs compare by value:
   `-moz-pref("omafire.layout", "sidebar")`). Popups, kiosk windows and
   customize mode keep the stock layout.

Notes on the non-obvious parts:

- The sidebar layout makes `body` a CSS grid; `#browser` is `display: contents` so
  the toolbox, sidebar and tabbox are placed directly. XUL `[collapsed]`
  does not collapse a grid item, hence `#browser > [collapsed]` is hidden
  explicitly.
- The address bar is a top-layer popover while open. It escapes every
  ancestor, including transforms, so the launcher is positioned against the
  viewport, and compact mode moves it with `--toolbar-shift-translate`
  instead of the toolbox's `translate`.
- With vertical tabs in the top layout the nav-bar is docked (DEC-104):
  `position: fixed`, one bar tall over the page, anchored to the tabbox.
  The toolbox is a flex item with `z-index: 0` (a stacking context) and
  `overflow: clip`; the docked layout lifts and unclips it or the row
  paints under the page, and the page gives up the row's height with a
  margin, never a transform (a transformed ancestor would contain the
  toolbar popups).
- Rows, the rail and the docked row are the Omarchy bar's size
  (`--oc-bar` from `--omarchy-bar-size`, which `omafire sync` writes into
  `omafire-radius.css`): bar ÷ GTK text scale, so it lands on the bar's
  own device pixels at any monitor scale. Density no longer sizes rows.

## Design language

Every surface, chrome or Firefox's own pages, marks each state one way.
Values live in `src/tokens.css` (and `src/tokens-content.css` for about:
pages, which lint keeps in step).

| Role | Chrome | Pages (Cinder's kit, `--k-*`) |
|---|---|---|
| Box | A thing's own edge is a 1px hairline (`--oc-line`, 11%), stronger when selected (`--oc-line-strong`, 22%). | Controls (buttons, chips, fields) keep an edge in `--k-line`/`-line-2`; content surfaces don't, until hovered. Author borders are removed: forced colours would paint them full text. |
| Surface | One material ladder, named by total opacity over the desktop, each layer painting only the step from what is under it: window (the glass alpha), B (`--oc-panel`: frame + 5% text at max(alpha, 0.8)) for every panel and console, frosting the page where it hangs over it. | Stacked: page (the window's alpha; around a main container, the thinner backdrop, alpha − 0.22) → main container (`@main`, `--k-main`: B) → region (`--k-region`: a grid, a list, a description; 30% canvas on glass) → card (`--k-card`, 45%). Off glass, the container is clear and region and card 3% and 5% of the text. Alpha over the window's blur only: no `backdrop-filter`. Menus and flyouts `--k-raised` (= panel) on a `--k-line-2` edge. |
| Interaction | Fill: hover (`--oc-hover`, 8%), pressed (`--oc-active`, 18%), selected (`--oc-selected`, 9%). Nothing else paints a fill. | The same fills (`--k-hover`, `--k-press`, `--k-sel`). A hovered card lifts one fill (`--k-card-hover`) and brings its hairline in (`--k-line-2`). |
| Active / current | Hairline and glow in one hue: light falling off from one edge, the hairline lit in the same colour from that edge and fading out before the far side, so it never closes into a box (`--oc-glow-*`, DEC-104). No extra bar. The active tab, the selected settings section. | The same (`--k-glow` from the lit edge, a 1px `--k-accent` edge there): the current guide entry, the selected chip. |
| Focus | A 1px ring in the accent (`--oc-focus`), on a field's own hairline. Never a glow. | The same (`--k-accent`); a focused card's edge turns accent. |
| Field | A quiet box: 5% fill at rest, no outline (DEC-104); 10% and the strong hairline on hover. | The same (`--k-field`, `--k-field-hover`). |
| Text | Labels 80%, secondary glyphs and metadata 62%, active or hovered full. | Titles full (`--k-ink`), labels 80% (`--k-ink-2`), detail at the quietest mix that keeps 4.5:1 on the theme (`--k-ink-3`: 58–86%), since page text is read, not glanced at. The accent only for links in running text. |
| Destructive | The palette's red, as a tinted tile on hover only. | — |
| Identity | Firefox's container colour, as a short tick, never a full edge. | — |
| Type | The shell's monospace everywhere; 13px labels, 12px chrome controls; weight 400 except headings. | The site's font for titles and running text; the monospace (`--k-mono`, 12px) for detail, controls and counts; section labels as 11px mono capitals. |
| Shape | Square. | Square: every radius and shadow removed. |
| Motion | `--oc-fast` 120ms on `--oc-ease`. | The same (`--k-fast`, `--k-ease`). |

The kit's values are the chrome's, computed per palette by Cinder
(`cinder-dark-mode/extension/content.js`, `kitCss`); change one side and
the other in the same breath. A site drawn in the kit is a sheet in
`cinder-dark-mode/extension/sites/`.

**One signal per state.** Before adding an accent, count the signals
already on that element: one colour family per state, and nothing brighter
than body text except the page itself. An active tab once carried a focus
bar, a glow, a strong box and a bold digit at once; that is the failure
this rule exists for.

## Development

`tools/fxlab` in the Omarchy Firefox bundle drives an isolated Firefox
against a theme tree (`FXLAB_THEME=<dir> tools/fxlab up`). Check anything
touching colors at cold start, from the first painted frames, not only in a
settled window.

Released under the [MIT License](../LICENSE) with the rest of this repository
(until 2026-09-27 the theme was public domain under the Unlicense). Layout ideas owe a lot to
[Zen Browser](https://zen-browser.app/) and
[parfait](https://github.com/reizumii/parfait).
