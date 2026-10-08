// The Omafire panel's rows over ~/.config/omafire/config.json.
// Keys, values and defaults are the CLI's (config/schema.json); this file
// adds only labels, sections and when a row applies. tests/shell-plugin.test.js
// keeps the two in step.

var ROWS = [
  { key: "toolbar", section: "LAYOUT", label: "Toolbar", type: "choice",
    options: [{ value: "top", label: "Top" }, { value: "sidebar", label: "Sidebar" }] },
  { key: "tabs", section: "LAYOUT", label: "Tabs", type: "choice",
    options: [{ value: "horizontal", label: "Horizontal" }, { value: "vertical", label: "Vertical" }] },
  { key: "side", section: "LAYOUT", label: "Side", type: "choice",
    options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }],
    when: function(c) { return c.tabs === "vertical" } },
  { key: "launcher", section: "LAYOUT", label: "Launcher", type: "choice",
    options: [{ value: "drop", label: "Drop" }, { value: "center", label: "Centred" }],
    when: function(c) { return c.toolbar === "sidebar" || c["zen-mode"] === true } },
  { key: "density", section: "LAYOUT", label: "Density", type: "choice",
    options: [{ value: "normal", label: "Normal" }, { value: "compact", label: "Compact" }] },

  { key: "zen-mode", section: "BEHAVIOUR", label: "Zen mode", type: "toggle",
    hint: "Hide the toolbar until you reach for it.",
    when: function(c) { return c.toolbar === "top" } },
  { key: "compact-sidebar", section: "BEHAVIOUR", label: "Compact sidebar", type: "toggle",
    hint: "Collapse the sidebar to icons.",
    when: function(c) { return c.toolbar === "sidebar" } },
  { key: "floating-page", section: "BEHAVIOUR", label: "Floating page", type: "toggle",
    hint: "Inset the page from the window edges.",
    when: function(c) { return c.toolbar === "top" } },

  { key: "glass", section: "LOOK", label: "Glass", type: "toggle",
    hint: "Translucent chrome over the desktop." },
  { key: "opacity", section: "LOOK", label: "Opacity", type: "slider",
    min: 0.5, max: 1, step: 0.01,
    when: function(c) { return c.glass === true } },
  { key: "glass-pages", section: "LOOK", label: "Glass pages", type: "toggle",
    hint: "Pages show the desktop behind them. Needs Cinder.",
    when: function(c) { return c.glass === true } },
  { key: "tab-numbers", section: "LOOK", label: "Tab numbers", type: "toggle" },
  { key: "tab-numbers-hold", section: "LOOK", label: "Numbers on hold", type: "toggle",
    hint: "Show them only while Alt is held; Alt, then digits, switches on release.",
    when: function(c) { return c["tab-numbers"] === true } },
  { key: "extension-glyphs", section: "LOOK", label: "Extension glyphs", type: "toggle",
    hint: "Monochrome icons for extensions." },
  { key: "key-zen", section: "KEYS", label: "Hide the chrome", type: "chord" },
  { key: "key-layout", section: "KEYS", label: "Switch toolbar", type: "chord" },
  { key: "key-glass", section: "KEYS", label: "Glass", type: "chord" },
  { key: "key-settings", section: "KEYS", label: "This panel", type: "chord" }
]

function visibleRows(config) {
  var c = config || {}
  var out = []
  for (var i = 0; i < ROWS.length; i++)
    if (!ROWS[i].when || ROWS[i].when(c)) out.push(ROWS[i])
  return out
}

function rowIndex(rows, key) {
  for (var i = 0; i < rows.length; i++)
    if (rows[i].key === key) return i
  return -1
}

// Cursor moves by key; a key whose row vanished falls back to the nearest
// surviving index.
function moveRowKey(rows, key, delta, fallbackIndex) {
  if (rows.length === 0) return ""
  var index = rowIndex(rows, key)
  var next = index === -1
    ? Math.max(0, Math.min(rows.length - 1, Math.round(Number(fallbackIndex) || 0)))
    : Math.max(0, Math.min(rows.length - 1, index + delta))
  return rows[next].key
}

function stepChoice(options, value, delta, wrap) {
  var index = -1
  for (var i = 0; i < options.length; i++)
    if (options[i].value === value) index = i
  var next = index === -1 ? 0 : index + delta
  if (wrap) next = ((next % options.length) + options.length) % options.length
  else next = Math.max(0, Math.min(options.length - 1, next))
  return options[next].value
}

// Two decimals, the precision Firefox's pref keeps.
function stepSlider(row, value, delta) {
  var n = Number(value)
  if (!isFinite(n)) n = row.min
  n = Math.round((n + delta * 0.05) * 100) / 100
  return Math.max(row.min, Math.min(row.max, n))
}

function wordFor(value) {
  return typeof value === "number" ? String(Math.round(value * 100) / 100) : String(value)
}

// The hero's meta line and whether anything needs repair, from
// `omafire status --json`. null status: not read yet.
function summary(status) {
  if (!status) return { meta: "Reading status…", broken: [], profiles: [] }
  var listed = (status.firefox && status.firefox.profiles) || []
  var profiles = listed.map(function(p) {
    return { browser: "Firefox", name: profileName(p.path), status: p.status, ok: p.ok }
  })
  var broken = profiles.filter(function(p) { return !p.ok })
  if (!status.hook || !status.hook.present) broken.unshift({ browser: "Omarchy", name: "theme hook", status: "missing", ok: false })
  var theme = status.theme || "unknown"
  var meta = broken.length === 0 ? theme + " · in sync"
    : broken.length === 1 ? theme + " · 1 thing needs setup"
    : theme + " · " + broken.length + " things need setup"
  return { meta: meta, broken: broken, profiles: profiles }
}

// "…/3ix5m4nz.default-release" → "default-release"
function profileName(path) {
  var base = String(path || "").replace(/\/+$/, "").split("/").pop()
  var dot = base.indexOf(".")
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1) : base
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ROWS: ROWS,
    visibleRows: visibleRows,
    rowIndex: rowIndex,
    moveRowKey: moveRowKey,
    stepChoice: stepChoice,
    stepSlider: stepSlider,
    wordFor: wordFor,
    summary: summary,
    profileName: profileName
  }
}
