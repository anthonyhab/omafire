"use strict";

// sRGB contrast (WCAG 2) of the theme's derived colour tokens over Omarchy
// palettes, read from the token files as written. Each palette goes through
// the extension's own lightweight-theme mapping, so chrome text is the
// toolbar_text it picks; the about: pages read the raw palette
// (tokens-content.css). Text and marks are composited over every surface
// they sit on, and over that surface hovered, and the worst ratio counts.
// Glass is left out: its alpha never drops below the theme's glass floor
// (DEC-66), and what shows through is the wallpaper, not the palette.

const fs = require("node:fs");
const path = require("node:path");
const { toFirefoxTheme } = require("../extension/theme.js");

const THEME = process.env.CONTRAST_TOKENS_DIR || path.join(__dirname, "..", "theme", "src");

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (c) => {
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// color-mix(in srgb, a, b p): p of b, which is also b at alpha p over a.
const mix = (a, b, p) => a.map((v, i) => v * (1 - p) + b[i] * p);

// A colour token as a function of the palette colours it reads:
// ({ text, accent, glow }, light) -> [rgb, alpha].
function parseColor(expr, light) {
  const e = expr.trim();
  const ld = e.match(/^light-dark\(([\s\S]*)\)$/);
  if (ld) {
    const [a, b] = splitTop(ld[1]);
    return parseColor(light ? a : b, light);
  }
  const ref = e.match(/^var\(--oc-([\w-]+)\)$/);
  if (ref) return (v) => [v[ref[1]], 1];
  const fade = e.match(/^color-mix\(in srgb, var\(--oc-([\w-]+)\) (\d+)%, transparent\)$/);
  if (fade) return (v) => [v[fade[1]], fade[2] / 100];
  const lean = e.match(/^color-mix\(in srgb, var\(--oc-([\w-]+)\), var\(--oc-([\w-]+)\) (\d+)%\)$/);
  if (lean) return (v) => [mix(v[lean[1]], v[lean[2]], lean[3] / 100), 1];
  throw new Error(`contrast.js cannot model ${e}`);
}

function splitTop(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  throw new Error(`no top-level comma in ${s}`);
}

function readTokens(file) {
  const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const defs = {};
  for (const m of css.matchAll(/(--oc-[\w-]+):\s*([^;{}]+?)\s*;/g)) defs[m[1]] = m[2].replace(/\s+/g, " ");
  return defs;
}

function tokenModel(defs, name, light) {
  return parseColor(defs[name], light);
}

// The lit end of --oc-glow-edge: its first stop (a token or a fade).
function edgeLead(defs, light) {
  const first = splitTop(defs["--oc-glow-edge"] + ",")[0].trim();
  const ref = first.match(/^var\((--oc-[\w-]+)\)$/);
  return ref ? tokenModel(defs, ref[1], light) : parseColor(first, light);
}

// --oc-glow in chrome is the accent (site colours aside); about: pages
// state theirs in tokens-content.css.
function glowOf(defs, v, light) {
  const g = defs["--oc-glow"];
  if (!g || g.includes("--tab-loading-fill")) return v.accent;
  if (g === "var(--oc-accent)") return v.accent;
  return over(tokenModel(defs, g.match(/^var\((--oc-[\w-]+)\)$/)[1], light)(v));
}

const over = ([c, a], bg = [0, 0, 0]) => mix(bg, c, a);

function measure(palettes) {
  const files = {
    chrome: readTokens(path.join(THEME, "tokens.css")),
    content: readTokens(path.join(THEME, "tokens-content.css"))
  };
  const rows = [];
  for (const [theme, p] of Object.entries(palettes).sort()) {
    const lwt = toFirefoxTheme({ schemaVersion: 1, palette: p }).colors;
    const light = p.mode === "light";
    for (const [doc, defs] of Object.entries(files)) {
      const text = rgb(doc === "chrome" ? lwt.toolbar_text : p.foreground);
      const frame = rgb(p.dark_background);
      const surfaces = doc === "chrome"
        ? [frame, mix(frame, text, 0.05)]                 // window, --oc-panel
        : [rgb(p.background), frame];                      // page, box
      const hovered = surfaces.flatMap((s) => [s, mix(s, text, 0.08)]);
      const v = { text, accent: rgb(p.accent) };
      v.glow = glowOf(defs, v, light);
      const worst = (on, f) => Math.min(...on.map(f));
      const tier = (name) => {
        if (!defs[name]) return null;
        const [c, a] = tokenModel(defs, name, light)(v);
        return worst(hovered, (s) => ratio(mix(s, c, a), s));
      };
      const mark = (model) => worst(surfaces, (s) => {
        const [c, a] = model(v);
        return ratio(mix(s, c, a), s);
      });
      const falloff = (s) => mix(s, v.glow, 0.22);          // the light's strongest stop
      rows.push({
        theme, mode: p.mode, doc,
        focus: mark(tokenModel(defs, "--oc-accent-mark", light)),
        glowEdge: mark(edgeLead(defs, light)),
        label: tier("--oc-text-label"),
        dim: tier("--oc-text-dim"),
        meta: tier("--oc-text-meta"),
        navLabel: doc === "content" ? ratio(text, falloff(surfaces[0])) : null,
        primary: doc === "content"
          ? worst(surfaces, (s) => ratio(text, falloff(mix(s, text, 0.09)))) : null
      });
    }
  }
  return rows;
}

module.exports = { measure, ratio, rgb };

if (require.main === module) {
  const palettes = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, "fixtures", "palettes.json"), "utf8"));
  const rows = measure(palettes);
  const cols = ["focus", "glowEdge", "label", "dim", "meta", "navLabel", "primary"];
  const cell = (x) => (x == null ? "" : x.toFixed(2));
  console.log(`| theme | mode | doc | ${cols.join(" | ")} |`);
  console.log(`|${" --- |".repeat(cols.length + 3)}`);
  for (const r of rows) console.log(`| ${r.theme} | ${r.mode} | ${r.doc} | ${cols.map((c) => cell(r[c])).join(" | ")} |`);
  for (const mode of ["dark", "light"]) {
    const min = cols.map((c) => {
      const xs = rows.filter((r) => r.mode === mode && r[c] != null).map((r) => r[c]);
      return xs.length ? `${c} ${Math.min(...xs).toFixed(2)}` : null;
    }).filter(Boolean);
    console.log(`min ${mode}: ${min.join(", ")}`);
  }
}
