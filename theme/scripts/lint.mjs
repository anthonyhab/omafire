#!/usr/bin/env node
// Enforce the two house rules that keep the theme maintainable:
//   1. Every declaration is !important, except --oc-* token definitions.
//      userChrome is user-origin; without !important Firefox's own rules win
//      and the failure is silent.
//   2. Only the token files choose colors. Components read --oc-* tokens.
//      src/tokens-content.css restates tokens.css's derived tokens for
//      Firefox-owned pages; each one it shares must match tokens.css.
//   3. Every var(--oc-*) a sheet reads is defined on its side (chrome or
//      content), and every extension sheet's pages are in the content
//      tokens' scope: otherwise the token resolves to nothing, silently.
//   4. Every Firefox variable the theme sets exists in the installed
//      Firefox (its omni.ja, from $OMAFIRE_FIREFOX or /usr/lib/firefox): a
//      renamed one is dropped silently. Skipped where there is no Firefox
//      (CI); extension sheets set their extensions' own variables.
// Usage: node scripts/lint.mjs   (exit 1 on any finding)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const files = [
  "userChrome.css",
  "userContent.css",
  ...readdirSync(join(root, "src"), { recursive: true })
    .filter((f) => f.endsWith(".css"))
    .sort()
    .map((f) => join("src", f)),
];

const DECL = /(?<=[{;\s])((?:--)?[a-zA-Z][\w-]*)\s*:\s*([^;{}]+?)\s*;/gs;
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/;

// Blank out comments, keeping offsets so line numbers stay right.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

// @property and @counter-style descriptors and @keyframes steps are not
// cascaded declarations (!important is invalid there); blank them out too.
const stripAtBlocks = (s) =>
  s.replace(/@(property|keyframes|counter-style)[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, (b) =>
    b.replace(/[^\n]/g, " "));

const TOKEN_FILES = [join("src", "tokens.css"), join("src", "tokens-content.css")];
const tokenDefs = {};  // file -> Map(name -> [value, line]), first definition
const norm = (v) => v.replace(/\s+/g, " ").trim();

const findings = [];
for (const file of files) {
  const src = stripAtBlocks(stripComments(readFileSync(join(root, file), "utf8")));
  for (const m of src.matchAll(DECL)) {
    const [, prop, value] = m;
    const line = src.slice(0, m.index).split("\n").length;
    const where = `${relative(root, join(root, file))}:${line}`;
    if (!prop.startsWith("--oc-") && !value.includes("!important"))
      findings.push(`${where}: ${prop} is missing !important`);
    if (TOKEN_FILES.includes(file) && prop.startsWith("--oc-")) {
      const defs = (tokenDefs[file] ??= new Map());
      if (!defs.has(prop)) defs.set(prop, [norm(value), line]);
    }
    if (!TOKEN_FILES.includes(file) && COLOR.test(value))
      findings.push(`${where}: ${prop} uses a literal color; add a token`);
  }
}

// Derived tokens (color-mix of other tokens) mean the same in both files.
const [chrome, content] = TOKEN_FILES.map((f) => tokenDefs[f] ?? new Map());
for (const [prop, [value, line]] of content) {
  const theirs = chrome.get(prop);
  if (theirs && value.includes("color-mix(") && value !== theirs[0])
    findings.push(`${TOKEN_FILES[1]}:${line}: ${prop} differs from ${TOKEN_FILES[0]}:${theirs[1]}`);
}

// A token a sheet reads must exist on its side: content documents only get
// tokens-content.css, so a chrome-only token (or a typo) there resolves to
// nothing, silently. Sides follow userChrome/userContent's @imports.
const imports = (f) => [...readFileSync(join(root, f), "utf8")
  .matchAll(/@import\s+"(src\/[^"]+)"/g)].map((m) => m[1]);
for (const top of ["userChrome.css", "userContent.css"]) {
  const side = imports(top);
  const read = side.map((f) => [f, stripAtBlocks(stripComments(readFileSync(join(root, f), "utf8")))]);
  const defined = new Set(read.flatMap(([, s]) => [...s.matchAll(/(--oc-[\w-]+)\s*:/g)].map((m) => m[1])));
  for (const [f, s] of read)
    for (const m of s.matchAll(/var\(\s*(--oc-[\w-]+)/g))
      if (!defined.has(m[1]))
        findings.push(`${f}:${s.slice(0, m.index).split("\n").length}: ${m[1]} is not defined for ${top}`);
}

// Content tokens are scoped to the pages they serve: an extension sheet's
// pages must be in tokens-content.css's scope, or none of its tokens resolve.
const contentScope = readFileSync(join(root, TOKEN_FILES[1]), "utf8");
for (const f of imports("userContent.css").filter((f) => f.startsWith("src/extensions/")))
  for (const m of readFileSync(join(root, f), "utf8").matchAll(/regexp\("[^"]*"\)/g))
    if (!contentScope.includes(m[0]))
      findings.push(`${f}: ${m[0]} is missing from ${TOKEN_FILES[1]}'s scope`);

// Firefox's own sources, where a variable it reads is named.
const firefox = process.env.OMAFIRE_FIREFOX || "/usr/lib/firefox";
const omni = [join(firefox, "omni.ja"), join(firefox, "browser", "omni.ja")].filter(existsSync);
let checkedFirefox = false;
if (omni.length) {
  let sources = "";
  for (const ja of omni) {
    try {
      sources += execFileSync("unzip", ["-p", ja, "*.css", "*.js", "*.mjs", "*.xhtml", "*.html"],
        { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString();
    } catch (e) {
      // (unzip exits 1 on omni.ja's offset warning, with the output intact)
      if (!e.stdout?.length) throw e;
      sources += e.stdout.toString();
    }
  }
  const own = /^--(oc|omafire|omarchy)-/;
  const seen = new Set();
  for (const file of files.filter((f) => !f.startsWith(join("src", "extensions")))) {
    const src = stripAtBlocks(stripComments(readFileSync(join(root, file), "utf8")));
    for (const m of src.matchAll(DECL)) {
      const prop = m[1];
      if (!prop.startsWith("--") || own.test(prop) || seen.has(prop)) continue;
      seen.add(prop);
      if (!sources.includes(prop))
        findings.push(`${file}:${src.slice(0, m.index).split("\n").length}: ${prop} is not a Firefox variable (${firefox})`);
    }
  }
  checkedFirefox = true;
}

for (const f of findings) console.error(f);
if (findings.length) process.exit(1);
console.log(`lint: ${files.length} files ok${checkedFirefox ? ", Firefox variables checked" : ""}`);
