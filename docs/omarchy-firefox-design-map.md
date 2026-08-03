# Omarchy Firefox design map

This is the working checklist for the Omarchy/Cascade Firefox overhaul. It
records what has been changed, what has been visually exercised, and what
still needs a focused pass so future work does not restart the same audit.

## Design rules

- Keep Firefox-GNOME as the compatibility foundation; add narrow overrides.
- Prefer flat surfaces, compact spacing, readable neutral foregrounds, and
  sharp borders.
- Use Pywal's accent for focus, selection, and hierarchy—not as the entire
  foreground palette.
- Source radius, border width, and active/inactive border colors from the
  generated Hyprland tokens.
- Style the real native content surface once; do not stack transparent shells,
  duplicate popup containers, or shadows.
- Treat Firefox content pages and extension-owned pages as separate surfaces;
  do not assume `userChrome.css` can style them.

## Current layers

1. Firefox-GNOME remains the base theme.
2. `userChrome.css` imports `omarchy-radius.css`, the GNOME theme, and the
   inline Omarchy layer in `customChrome.css`.
3. `firefox-radius-gen.sh` generates live radius and border tokens from
   Hyprland, with legacy settings as fallback.
4. `customChrome.css` bridges Pywalfox/LWT variables into semantic Omarchy
   surfaces, foregrounds, fields, panels, hover, selection, and borders.
5. `omarchy-firefox-test` runs a separate copy-on-write VM with a sanitized
   clone of the real Firefox profile.

## Completed and visually checked

| Area | State | Notes |
| --- | --- | --- |
| Chrome surfaces and text | Done (base states) | Flat Pywal-derived surfaces and readable neutral foregrounds. |
| URL bar layout | Done (base/focus states) | Flexible input, explicit control rhythm, identity/search spacing, and native breakout outline replaced by Hyprland border tokens. |
| URL autocomplete | Done | Readable URLs/actions, flat panel, dynamic border, no shadow. |
| Horizontal tabs | Done | Selected tab is an accent line/subtle surface rather than a full bright card. |
| Collapsed vertical tabs | Done | Icon rail, hidden close overlay, compact selected/hover states. |
| Vertical-tab onboarding | Patched | Palette tokens are supplied to Firefox's shadow-component inheritance path. |
| Main menus/popups | Done (representative states) | Native content parts receive the border; shells stay transparent; shadows removed. |
| URL bar/tab/toolbar context menus | Checked | Flat, dark, readable, rounded according to generated geometry. |
| Bookmarks/history sidebars | Checked (representative states) | Surface, tree rows, inputs, and selected rows use the Omarchy palette. |
| Find bar | Checked | Dark field, readable controls, dynamic border color. |
| Library/downloads window | Patched and checked | `places.xhtml` had white/gray surfaces; it now has a dark Omarchy fallback and styled tree rows/search. |
| Pywalfox integration | Checked | Real extension and matching native host work in the Firefox VM. |
| Hyprland geometry | Done | Rounding and active/inactive border width/color/gradient generation is live. |
| Startup layer count | Done | The Omarchy layer is inline; no extra stylesheet import was retained. |
| Firefox VM foundation | Done | Persistent `omarchy-firefox-test` base includes Firefox 153. |
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
| Tab context menu and tab overflow menu | Checked | Exercise multi-tab overflow. |
| Horizontal/vertical tab switching and resizing | Partial | Check expanded, collapsed, hover-expand, and drag-to-pin. |
| Toolbar context menu and Customize Toolbar | Checked | Exercise drag/reorder/reset and overflow. |
| Main application menu and submenus | Checked | Exercise Bookmarks, History, More Tools, Help, and disabled states. |
| Unified extensions menu | Pending | Check overflow, extension rows, and keyboard navigation. |
| Extension popups | Partial | uBlock and Dark Reader checked; extension-owned styling is a boundary. |
| Firefox View | Audited | Decide whether its rounded cards should be flattened via content CSS. |
| Bookmarks/history/synced-tabs/password sidebars | Partial | Bookmarks and History checked; exercise the remaining panels. |
| Downloads panel and real download states | Audited | Test in-progress, completed, failed, blocked, and context-menu states. |
| Library: history, bookmarks, downloads, search, tree selection | Checked | Exercise context menus and import/export dialogs. |
| Add-ons manager | Audited | Dark/readable, but cards remain more rounded than the Omarchy target. |
| Settings/preferences | Audited | Dark/readable; decide whether content cards need a separate content layer. |
| Site identity, permissions, tracking protection, notification prompts | Pending | Use a local test page and capture every popup state. |
| Bookmark star and edit-bookmark panel | Pending | Check fields, validation, folder tree, and completion buttons. |
| Find bar | Checked | Check no-match, match count, toggles, and close behavior. |
| Private window and private new-tab page | Pending | Check header, tabs, page background, and privacy prompts. |
| New-tab/home page and customization menu | Pending | Check Pywal content variables and card/shadow behavior. |
| Reader mode and PDF viewer | Pending | Check toolbar, sidebars, menus, and content backgrounds. |
| Print preview, save page, file chooser, certificate dialogs | Pending | Native dialogs may be outside userChrome scope; classify separately. |
| DevTools, Picture-in-Picture, fullscreen, find-in-page | Pending | Check separate windows, overlays, and focus/inactive borders. |
| Window inactive state and multi-window layout | Partial | Active/inactive border tokens are implemented; capture both states. |
| Dynamic Hyprland radius/border changes | Checked synthetically | Repeat with a nonzero live Hyprland border when needed. |

## Repeatable test workflow

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

Both runs passed the Omarchy harness shell check with no missing types, type
errors, binding loops, unknown properties, shell crashes, or IPC failures.
