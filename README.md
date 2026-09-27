# Omarchy Chrome

A Firefox userChrome theme for [Omarchy](https://omarchy.org/): flat, square
chrome in the shell's monospace, one quiet visual language shared by the
chrome and Firefox's own pages, and the page flush against a single top toolbar with vertical tabs below.
Optional modes add Zen-style touches: a hidden toolbar with a centred
launcher, glass chrome, a floating content card, or a single-sidebar
layout. Colors follow the current Omarchy theme live through
[Omafox](https://github.com/cover/omafox).

Requires **Firefox 156 or newer with Nova** (`browser.nova.enabled`, the
default from Firefox 157). Tested on Firefox 156; later versions install but
are untested until the test matrix passes on them. Older layouts are not
supported.

## Install

The usual path is Omafox: `omafox setup` installs this theme into every
Firefox profile and keeps its palette and window rounding in sync with
Omarchy. See the Omafox README.

To run from a checkout instead, clone this repository as the profile's
`chrome/` directory and run `omafox setup` once; it recognises the checkout
and writes only the generated files beside it.

Then set these in `about:config`:

| Preference | Value | |
|---|---|---|
| `toolkit.legacyUserProfileCustomizations.stylesheets` | `true` | load userChrome (omafox sets it) |
| `browser.nova.enabled` | `true` | Nova design (Firefox 156 only) |
| `sidebar.revamp` | `true` | the sidebar the layout is built on |
| `sidebar.verticalTabs` | `true` | vertical tabs |

Optional, all applied live without a restart:

| Preference | Value | Effect |
|---|---|---|
| `omarchy.layout` | `"sidebar"` | Zen's single sidebar: toolbar and urlbar at the top of the tab column, floating page, centred launcher. Unset (or `"top"`) is the default top toolbar. |
| `omarchy.zen-mode` + `omarchy.zen-mode-active` | `true` + `true` | Top layout: hide the toolbar. Ctrl+L opens a centred launcher with the navigation row docked above it. |
| `omarchy.launcher` | `"center"` | Launcher shape (sidebar layout and zen mode). Unset (or `"drop"`) is a quake console: with horizontal tabs it slides full width down from the window's top edge, with vertical tabs it slides out of the tab column over the page, leaving the tabs in view. `"center"` floats it as a card. |
| `omarchy.compact` | `true` | Sidebar layout with the sidebar expanded: hide the column until the pointer reaches the edge. The collapsed icon rail stays visible. |
| `omarchy.chrome-gap` | `true` | Float the page as a card with a gap, Hyprland rounding and a hairline shadow. |
| `omarchy.translucency` | `true` | Glass chrome (frosted with a Hyprland blur rule for Firefox). |
| `omarchy.transparency` | `"0.50"`–`"1.00"` | Glass opacity in 0.01 steps (default 0.85). |
| `omarchy.tab-numbers` | `true` | Show the Alt+1…8 digit on the first eight tabs: on pinned tiles, rail tiles and split pairs, a legend notched into the tile's left edge, btop-style; beside an expanded row, in the gutter to its left. Tabs hidden in collapsed groups are skipped, as Firefox skips them. |
| `omarchy.extension-glyphs` | `false` | Keep extensions' own icons. By default known extensions get monochrome glyphs that tint with the toolbar (needs `svg.context-properties.content.enabled`, which omafox sets). |

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
src/launcher.css        urlbar launcher: quake drop or centred card (sidebar layout, zen mode)
src/motion.css          sidebar expand/collapse and resize motion
src/layouts/sidebar.css omarchy.layout = "sidebar"
src/modes/zen.css       omarchy.zen-mode
src/modes/compact.css   omarchy.compact
src/modes/gap.css       omarchy.chrome-gap
src/modes/translucency.css  omarchy.translucency
src/modes/tab-numbers.css   omarchy.tab-numbers
src/tokens-content.css  the same tokens for about: pages, from the content palette
src/content.css         new tab and about: pages
```

The default layout is the top toolbar, which is Firefox's own flow with
vertical tabs; `frame.css` and the surface files style it. Every other
layout or mode is one file gated on its pref, so adding one never changes
the others. Modes change tokens where they can (`gap.css` is three token
overrides) rather than restyling elements.

Generated by Omafox and gitignored: `omafox-palette.css` (the `--omarchy-*`
palette plus a cold-start stand-in for the lightweight theme),
`omafox-content-palette.css`, and `omarchy-radius.css` (Hyprland's
rounding, border width, and active/inactive border colors).

## Rules

These keep a small theme small. `node scripts/lint.mjs` checks the first two.

1. **Every declaration is `!important`**, except `--oc-*` token definitions.
   userChrome is a user-origin sheet; without `!important` Firefox's own
   rules win, silently.
2. **Only the token files pick colors** (`src/tokens.css`, and
   `src/tokens-content.css` for about: pages). Components read `--oc-*` tokens.
   Tokens read Firefox's lightweight-theme variables first (set live by the
   Omafox extension) and fall back to the generated `--omarchy-*` palette,
   which only reloads on restart. That is why a theme switch repaints without
   a restart.
3. **Steer Firefox through its own variables where it has them**
   (`--tab-pinned-*`, `--toolbar-shift-translate`, `--urlbar-width`, …)
   rather than restyling the element they drive. Firefox keeps those
   working across releases; selectors against internals break.
4. **Gate layouts and modes on prefs.** Each lives under its own
   `@media -moz-pref(...)` (string prefs compare by value:
   `-moz-pref("omarchy.layout", "sidebar")`). Popups, kiosk windows and
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
- Zen mode parks the nav-bar with `position: fixed` rather than hiding it,
  so Ctrl+L can still focus the urlbar inside it. The toolbox is a flex
  item with `z-index: 0` (a stacking context) and `overflow: clip`; zen
  mode lifts and unclips it or the row paints under the page.

## Design language

Every surface, chrome or Firefox's own pages, marks each state one way.
Values live in `src/tokens.css` (and `src/tokens-content.css` for about:
pages, which lint keeps in step).

| Role | Treatment |
|---|---|
| Box | A thing's own edge is a 1px hairline (`--oc-line`), stronger when selected (`--oc-line-strong`). |
| Interaction | Fill: hover (`--oc-hover`), pressed (`--oc-active`), selected (`--oc-selected`). Nothing else paints a fill. |
| Active / current | Hairline and glow in one hue: light falling off from one edge, the hairline lit in the same colour from that edge (`--oc-glow-*`). No extra bar. The active tab, the selected settings section. |
| Focus | A 1px ring in the accent (`--oc-focus`), on a field's own hairline. Never a glow. |
| Field | A quiet box: 5% fill on the hairline at rest, 10% and the strong hairline on hover. |
| Text | Labels 80%, secondary glyphs and metadata 62%, active or hovered full. |
| Destructive | The palette's red, as a tinted tile on hover only. |
| Identity | Firefox's container colour, as a short tick, never a full edge. |
| Type | The shell's monospace everywhere; 13px labels, 12px chrome controls; weight 400 except headings. |

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

Released under the [Unlicense](LICENSE). Layout ideas owe a lot to
[Zen Browser](https://zen-browser.app/) and
[parfait](https://github.com/reizumii/parfait).
