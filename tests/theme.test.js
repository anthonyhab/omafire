"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  ACTION,
  COLOR_KEYS,
  PALETTE_KEYS,
  PROTOCOL,
  parseThemeMessage,
  toFirefoxTheme
} = require("../extension/theme.js");

const palette = {
  mode: "dark",
  accent: "#509475",
  selection: "#32473B",
  muted: "#53685B",
  background: "#111c18",
  dark_background: "#0c1512",
  darker_background: "#090f0d",
  lighter_background: "#23372B",
  foreground: "#C1C497",
  dark_foreground: "#81B8A8",
  light_foreground: "#D6D5BC",
  bright_foreground: "#F7E8B2",
  red: "#FF5345",
  yellow: "#459451",
  orange: "#a2734b",
  green: "#549e6a",
  cyan: "#2DD5B7",
  blue: "#509475",
  magenta: "#D2689C",
  brown: "#513925",
  bright_red: "#db9f9c",
  bright_yellow: "#E5C736",
  bright_green: "#63b07a",
  bright_cyan: "#8CD3CB",
  bright_blue: "#ACD4CF",
  bright_magenta: "#75bbb3"
};

const message = {
  protocol: PROTOCOL,
  version: 1,
  action: ACTION,
  theme: "osaka-jade",
  palette
};
const record = parseThemeMessage(message);

function relativeLuminance(color) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

assert.equal(PALETTE_KEYS.length, 26);
assert.equal(COLOR_KEYS.length, 25);
assert.equal(record.themeName, "osaka-jade");
assert.deepEqual(record.palette, palette);

const firefoxTheme = toFirefoxTheme(record);
assert.equal(firefoxTheme.colors.frame, palette.background);
assert.equal(firefoxTheme.colors.tab_line, palette.accent);
assert.equal(firefoxTheme.colors.toolbar_field_highlight, palette.selection);
assert.equal(firefoxTheme.colors.toolbar_field_highlight_text, palette.bright_foreground);
assert.equal(firefoxTheme.colors.button_background_active, palette.selection);
assert.equal(firefoxTheme.colors.popup_highlight, palette.selection);
assert.equal(firefoxTheme.colors.sidebar_highlight, palette.selection);
assert.equal(firefoxTheme.colors.toolbar_bottom_separator, palette.brown);
assert.equal(firefoxTheme.properties.color_scheme, "dark");

const lowContrastHighlightTheme = toFirefoxTheme({
  ...record,
  palette: {
    ...palette,
    selection: "#FDFAFA",
    bright_foreground: "#FEFBFB"
  }
});
assert.equal(lowContrastHighlightTheme.colors.toolbar_field_highlight_text, palette.background);

const lowContrastIconTheme = toFirefoxTheme({
  ...record,
  palette: {
    ...palette,
    accent: "#AE6378",
    selection: "#FDFAFA",
    foreground: "#FDFAFA",
    light_foreground: "#FDFBFB",
    bright_foreground: "#FEFBFB",
    bright_yellow: "#FFD384"
  }
});
assert.equal(lowContrastIconTheme.colors.icons, "#FDFBFB");
assert.ok(
  contrastRatio(
    lowContrastIconTheme.colors.button_background_active,
    lowContrastIconTheme.colors.toolbar_text
  ) >= 4.5
);
assert.equal(lowContrastIconTheme.colors.popup_highlight, "#AE6378");
assert.equal(lowContrastIconTheme.colors.sidebar_highlight, "#AE6378");

const lowContrastChromeTheme = toFirefoxTheme({
  ...record,
  palette: {
    ...palette,
    dark_background: "#777777",
    lighter_background: "#858585",
    foreground: "#808080",
    light_foreground: "#828282",
    bright_foreground: "#848484"
  }
});
assert.ok(
  contrastRatio(
    lowContrastChromeTheme.colors.toolbar,
    lowContrastChromeTheme.colors.toolbar_text
  ) >= 4.5
);
assert.ok(
  contrastRatio(
    lowContrastChromeTheme.colors.button_background_hover,
    lowContrastChromeTheme.colors.toolbar_text
  ) >= 4.5
);
assert.ok(
  contrastRatio(
    lowContrastChromeTheme.colors.tab_selected,
    lowContrastChromeTheme.colors.tab_text
  ) >= 4.5
);

const monochromePalette = Object.fromEntries(
  PALETTE_KEYS.map((key) => [key, key === "mode" ? "dark" : "#777777"])
);
const fallbackHighlightTheme = toFirefoxTheme({ ...record, palette: monochromePalette });
assert.equal(fallbackHighlightTheme.colors.toolbar_field_highlight_text, "#000000");

assert.throws(
  () => parseThemeMessage({
    ...message,
    palette: { ...palette, accent: "red" }
  }),
  /accent/
);
assert.throws(
  () => parseThemeMessage({ ...message, protocol: "other" }),
  /protocol/
);
assert.throws(
  () => parseThemeMessage({ ...message, extra: "nope" }),
  /Unexpected message/
);
assert.throws(
  () => parseThemeMessage({ ...message, theme: "x".repeat(101) }),
  /theme name/
);
assert.throws(
  () => parseThemeMessage({
    ...message,
    palette: { ...palette, extra: "#123456" }
  }),
  /Unexpected palette/
);

// Split view in the chrome theme (omafire-v2z.6). These read the source;
// the measured geometry is in the bead's fxlab evidence.
const themeSource = (name) =>
  fs.readFileSync(path.join(__dirname, "../theme/src", name), "utf8");
const frameCss = themeSource("frame.css");
const sidebarCss = themeSource("sidebar.css");

// Panes sit on the frame like one page: Firefox's --space-xsmall margin
// around each active pane is cancelled, the divider is the only space.
assert.match(
  frameCss,
  /#tabbrowser-tabpanels\[splitview\] \{\s*& \.split-view-panel\.split-view-panel-active \{\s*margin: 0 !important;/
);

// Firefox's native cue (a focus outline on the selected pane) stays off in
// DOM fullscreen too, so it is a top-level rule, not under the
// :root:not([inDOMFullscreen]) frame block.
assert.match(
  frameCss,
  /^#tabbrowser-tabpanels\[splitview\] > \.split-view-panel > \.browserContainer \{\s*border: none !important;\s*outline: none !important;/m
);

// The new tab clears only its own (selected) pane, never the other one.
assert.match(
  frameCss,
  /&:has\(\.tabbrowser-tab\[selected\]\[image\*="PHN2ZyBpZD0ib21hZm94LW5ld3RhYiIg"\]\)\s*#tabbrowser-tabpanels > \.deck-selected \.browserContainer \{\s*background-color: transparent !important;/
);

// Compact's card keeps its start gap where the layout's "the launcher
// splitter is the gap" rule (same selector) would zero it.
assert.match(
  themeSource("modes/compact.css"),
  /&,\s*&:has\(#sidebar-container:not\(\[hidden\]\)\) \{\s*& #tabbrowser-tabbox \{\s*grid-column: side \/ ai-split !important;\s*margin-inline-start: var\(--oc-gap\) !important;/
);

// The revealed column sits a gap in from the edge that revealed it; a
// strip on the column fills that gap (start side, mirrored at the end),
// or the pointer resting on the edge loses :hover and the column parks.
const compactCss = themeSource("modes/compact.css");
assert.match(
  compactCss,
  /& :is\(#navigator-toolbox, #sidebar-container\) \{\s*position: relative !important;\s*overflow-clip-margin: var\(--oc-gap\) !important;\s*&::before \{\s*content: "" !important;\s*position: absolute !important;\s*inset-block: 0 !important;\s*inset-inline-end: 100% !important;\s*width: var\(--oc-gap\) !important;/
);
assert.match(compactCss, /&::before \{\s*inset-inline: 100% auto !important;/);

// F11 folds the tab column to nothing; its flush-mode edge goes with it.
const columnEdges = sidebarCss.match(/^\s*:root:not\([^)]*\) #sidebar-container \{/gm) ?? [];
assert.equal(columnEdges.length, 2);
for (const rule of columnEdges) {
  assert.match(rule, /:root:not\(\[inDOMFullscreen\], \[fullscreenNavToolboxHidden\]\)/);
}

// Compact sidebar: compact.uc.js marks what compact.css can't see (an open
// menupopup the column launched, keyboard focus on the sidebar's tools),
// and compact.css reveals the column on those marks.
const root = path.join(__dirname, "..");
assert.match(compactCss, /&\[omafire-column-popup\],\s*&\[omafire-tools-focus\],\s*&:has\(/);
// A native menupopup never carries [open] (Firefox 157), so these never matched.
assert.doesNotMatch(compactCss,
  /#(tabContextMenu|new-tab-button-popup|sidebar-context-menu|open-tab-group-context-menu|saved-tab-group-context-menu)\[open\]/);

function loadCompact() {
  const listeners = {};
  const marks = new Set();
  // sidebar-main as the tools observer sees it (omafire-v2z.13): the native
  // readings it would act on, and where the column is
  const tools = { readings: [], updates: 0, rect: { left: -258, right: 0, width: 258 }, frames: [] };
  const toolsMain = {
    getBoundingClientRect: () => tools.rect,
    requestUpdate: () => tools.updates++,
    createToolsObservers() {
      this._toolsIntersectionObserver = new window.IntersectionObserver(entries => tools.readings.push(entries));
    }
  };
  const document = {
    documentElement: { toggleAttribute: (name, on) => on ? marks.add(name) : marks.delete(name) },
    querySelector: selector => selector === "sidebar-main" ? toolsMain : null
  };
  const focus = {
    FLAG_BYMOUSE: 0x1000, FLAG_BYKEY: 0x2000, focusedElement: null, method: 0,
    getLastFocusMethod() { return this.method; }
  };
  const window = {
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    IntersectionObserver: class { constructor(callback) { tools.callback = callback; } },
    innerWidth: 1000,
    requestAnimationFrame: fn => tools.frames.push(fn)
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "chrome/scripts/compact.uc.js"), "utf8"),
    { window, document, Services: { focus, obs: { addObserver() {}, removeObserver() {} } }, Promise });
  const fire = (type, target) => listeners[type].forEach(fn => fn({ target }));
  // the column: toolbox and sidebar, the tab strip slotted into sidebar-main,
  // the tools inside its shadow root
  const node = (props, parentNode = null) => ({ ownerDocument: document, parentNode, ...props });
  const sidebar = node({ id: "sidebar-container" });
  const sidebarMain = node({ localName: "sidebar-main" }, sidebar);
  const shadow = { parentNode: null, host: sidebarMain };
  const tool = node({ localName: "button" }, shadow);
  const newTab = node({ id: "tabs-newtab-button" }, node({ id: "vertical-tabs" }, sidebarMain));
  const page = node({ localName: "browser" }, node({ id: "browser" }));
  return { marks, fire, focus, tool, newTab, page, tools, window };
}

(async () => {
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const c = loadCompact();
  const tabMenu = { localName: "menupopup", triggerNode: c.newTab };
  const toolMenu = { localName: "menupopup", triggerNode: c.tool };
  const pageMenu = { localName: "menupopup", triggerNode: c.page };
  const tooltip = { localName: "tooltip", triggerNode: c.tool };

  c.fire("popupshown", pageMenu);
  c.fire("popupshown", tooltip);
  assert.equal(c.marks.has("omafire-column-popup"), false);
  c.fire("popupshown", tabMenu);
  c.fire("popupshown", toolMenu);
  assert.equal(c.marks.has("omafire-column-popup"), true);
  c.fire("popuphidden", tabMenu);
  assert.equal(c.marks.has("omafire-column-popup"), true);
  c.fire("popuphidden", toolMenu);
  assert.equal(c.marks.has("omafire-column-popup"), false);

  // a panel anchored in the column (no trigger) counts too
  const editor = { localName: "panel", anchorNode: c.newTab };
  c.fire("popupshown", editor);
  assert.equal(c.marks.has("omafire-column-popup"), true);
  c.fire("popuphidden", editor);
  assert.equal(c.marks.has("omafire-column-popup"), false);

  const focusOn = async (el, method) => {
    c.focus.focusedElement = el;
    c.focus.method = method;
    c.fire("focusin", el);
    await settle();
  };
  await focusOn(c.tool, c.focus.FLAG_BYKEY);
  assert.equal(c.marks.has("omafire-tools-focus"), true);
  await focusOn(c.tool, c.focus.FLAG_BYMOUSE);
  assert.equal(c.marks.has("omafire-tools-focus"), false);
  // the slotted tab strip is :focus-visible's job, not the mark's
  await focusOn(c.newTab, c.focus.FLAG_BYKEY);
  assert.equal(c.marks.has("omafire-tools-focus"), false);
  await focusOn(c.tool, c.focus.FLAG_BYKEY);
  await focusOn(c.page, c.focus.FLAG_BYKEY);
  assert.equal(c.marks.has("omafire-tools-focus"), false);

  // the tools observer ignores readings while the column is off-screen (omafire-v2z.13),
  // and re-reads the tools once it is wholly inside the window
  const t = c.tools;
  assert.equal(c.window.IntersectionObserver.name, "IntersectionObserver", "the native class is put back");
  const updates = t.updates;
  t.callback(["parked"]);
  assert.deepEqual(t.readings, [], "a parked column's reading is dropped");
  t.rect = { left: -101, right: 157, width: 258 };
  t.frames.shift()();
  t.callback(["sliding"]);
  assert.deepEqual(t.readings, [], "so is a sliding one");
  assert.equal(t.updates, updates, "no re-read while it slides");
  t.frames.shift()();
  t.rect = { left: 8, right: 266, width: 258 };
  t.frames.shift()();
  assert.equal(t.updates, updates + 1, "re-read once it is in");
  t.callback(["settled"]);
  assert.deepEqual(t.readings, [["settled"]]);

  console.log("theme.test.js: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
