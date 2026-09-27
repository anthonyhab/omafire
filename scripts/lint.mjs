#!/usr/bin/env node
// Enforce the two house rules that keep the theme maintainable:
//   1. Every declaration is !important, except --oc-* token definitions.
//      userChrome is user-origin; without !important Firefox's own rules win
//      and the failure is silent.
//   2. Only the token files choose colors. Components read --oc-* tokens.
//      src/tokens-content.css restates tokens.css's derived tokens for
//      Firefox-owned pages; each one it shares must match tokens.css.
// Usage: node scripts/lint.mjs   (exit 1 on any finding)

import { readFileSync, readdirSync } from "node:fs";
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

for (const f of findings) console.error(f);
if (findings.length) process.exit(1);
console.log(`lint: ${files.length} files ok`);
