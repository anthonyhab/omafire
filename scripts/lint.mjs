#!/usr/bin/env node
// Enforce the two house rules that keep the theme maintainable:
//   1. Every declaration is !important, except --oc-* token definitions.
//      userChrome is user-origin; without !important Firefox's own rules win
//      and the failure is silent.
//   2. Only src/tokens.css chooses colors. Components read --oc-* tokens.
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

// @property descriptors and @keyframes steps are not cascaded
// declarations (!important is invalid there); blank them out too.
const stripAtBlocks = (s) =>
  s.replace(/@(property|keyframes)[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, (b) =>
    b.replace(/[^\n]/g, " "));

const findings = [];
for (const file of files) {
  const src = stripAtBlocks(stripComments(readFileSync(join(root, file), "utf8")));
  for (const m of src.matchAll(DECL)) {
    const [, prop, value] = m;
    const line = src.slice(0, m.index).split("\n").length;
    const where = `${relative(root, join(root, file))}:${line}`;
    if (!prop.startsWith("--oc-") && !value.includes("!important"))
      findings.push(`${where}: ${prop} is missing !important`);
    if (file !== join("src", "tokens.css") && COLOR.test(value))
      findings.push(`${where}: ${prop} uses a literal color; add a token`);
  }
}

for (const f of findings) console.error(f);
if (findings.length) process.exit(1);
console.log(`lint: ${files.length} files ok`);
