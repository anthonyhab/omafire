#!/usr/bin/env node
/*
 * Favicon contrast lab
 *
 * Scores the real favicon corpus with the exact decision code inside
 * favicon-contrast.uc.js (worker threads each load it through the same vm
 * injection as the unit test) and writes an HTML report showing what
 * Firefox would render for every icon on each background — including the
 * previous algorithm's pick for comparison.
 *
 *   scripts/favicon-dump.py --profile ~/.mozilla/firefox/<profile> --out tests/favicon-corpus
 *   node scripts/favicon-lab.mjs [--corpus tests/favicon-corpus] [--out tests/favicon-corpus/report.html]
 *
 * Options:
 *   --corpus DIR      corpus dir from favicon-dump.py (default: tests/favicon-corpus)
 *   --out FILE        report path (default: <corpus>/report.html)
 *   --bg #hex[,#hex]  backgrounds to test (default: live palette + dark set)
 *   --all             include icons whose decision stays "original" on every bg
 *   --hosts a,b       only these hosts (exact or subdomain match)
 *   --decisions a,b   only icons decided to one of these modes on some bg
 *   --limit N         only score the first N corpus icons
 *   --jobs N          worker threads (default: cpus)
 *   --json [FILE]     also write raw scores JSON (default: <corpus>/scores.json)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { Worker } from "node:worker_threads";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = name => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
};
const has = name => args.includes(name);

const corpusDir = path.resolve(flag("--corpus") || "tests/favicon-corpus");
const outFile = path.resolve(flag("--out") || path.join(corpusDir, "report.html"));
const limit = flag("--limit") ? Number(flag("--limit")) : Infinity;
const showAll = has("--all");
const hostFilter = flag("--hosts")
    ? flag("--hosts").split(",").map(s => s.trim().toLowerCase())
    : null;
const decisionFilter = flag("--decisions")
    ? flag("--decisions").split(",").map(s => s.trim())
    : null;

/* ------------------------------------------------------------------ *
 *  Backgrounds: the live palette plus representative dark/mid themes.   *
 * ------------------------------------------------------------------ */
const paletteBg = () => {
    for (const file of ["omafox-palette.css", "customChrome.css"]) {
        try {
            const css = fs.readFileSync(path.join(root, file), "utf8");
            const m = css.match(/--toolbar-bgcolor:\s*(#[0-9a-f]{3,8})/i);
            if (m) return m[1];
        } catch {}
    }
    return null;
};
const backgrounds = flag("--bg")
    ? flag("--bg").split(",").map(s => s.trim())
    : [paletteBg(), "#1e1e2e", "#282828", "#f4f4f5"].filter(Boolean);

const parseBg = hex => {
    const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (!m) throw new Error(`bad --bg color: ${hex}`);
    let d = m[1];
    if (d.length === 3) d = d.split("").map(c => c + c).join("");
    return {
        r: parseInt(d.slice(0, 2), 16),
        g: parseInt(d.slice(2, 4), 16),
        b: parseInt(d.slice(4, 6), 16),
        a: 1,
    };
};
const bgs = backgrounds.map(parseBg);

/* ------------------------------------------------------------------ *
 *  Corpus manifest.                                                   *
 * ------------------------------------------------------------------ */
const manifestPath = path.join(corpusDir, "manifest.jsonl");
if (!fs.existsSync(manifestPath)) {
    console.error(`no corpus at ${corpusDir}; run scripts/favicon-dump.py first`);
    process.exit(2);
}
const hostOf = entry => {
    for (const u of [...entry.pages, entry.icon_url]) {
        try {
            const h = new URL(u).hostname;
            if (h) return h;
        } catch {}
    }
    return entry.icon_url.slice(0, 60);
};
const items = fs
    .readFileSync(manifestPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(e =>
        fs.existsSync(path.join(corpusDir, "raw", `${e.sha}.rgba`)) &&
        fs.existsSync(path.join(corpusDir, "icons", `${e.sha}.${e.kind}`)),
    )
    .slice(0, limit)
    .map(e => ({ ...e, host: hostOf(e), dataUri: `icons/${e.sha}.${e.kind}` }));

/* ------------------------------------------------------------------ *
 *  Score everything in worker threads.                                *
 * ------------------------------------------------------------------ */
const jobs = Math.min(
    Math.max(1, Number(flag("--jobs") || os.cpus().length)),
    items.length || 1,
);
const chunks = Array.from({ length: jobs }, () => []);
items.forEach((item, i) => chunks[i % jobs].push(item));
const scored = await Promise.all(
    chunks
        .filter(c => c.length)
        .map(
            chunk =>
                new Promise((resolve, reject) => {
                    const worker = new Worker(
                        path.join(root, "scripts", "favicon-lab-worker.mjs"),
                        {
                            workerData: {
                                ucPath: path.join(root, "favicon-contrast.uc.js"),
                                corpusDir,
                                backgrounds: bgs,
                                items: chunk,
                            },
                        },
                    );
                    worker.once("message", resolve);
                    worker.once("error", reject);
                }),
        ),
);
const bySha = new Map();
for (const part of scored) {
    for (const row of part) {
        bySha.set(row.sha, row);
    }
}

const stats = bgs.map(() => ({}));
const rows = [];
for (const entry of items) {
    const scored_row = bySha.get(entry.sha);
    if (!scored_row) continue;
    const perBg = scored_row.perBg.map((r, bi) => ({
        bg: backgrounds[bi],
        ev: { choice: r.choice, results: r.modes },
        legacy: r.legacy,
    }));
    for (const r of perBg) {
        stats[backgrounds.indexOf(r.bg)][r.ev.choice] =
            (stats[backgrounds.indexOf(r.bg)][r.ev.choice] || 0) + 1;
    }
    const touched = perBg.some(r => r.ev.choice !== "original");
    rows.push({ entry, perBg, touched, host: entry.host });
}
rows.sort(
    (a, b) =>
        b.touched - a.touched ||
        a.host.localeCompare(b.host) ||
        a.entry.sha.localeCompare(b.entry.sha),
);

if (has("--json")) {
    const dump = rows.map(row => ({
        host: row.host,
        sha: row.entry.sha,
        kind: row.entry.kind,
        opaqueShare: bySha.get(row.entry.sha)?.opaqueShare ?? null,
        bgs: Object.fromEntries(
            row.perBg.map(({ bg, ev, legacy }) => [
                bg,
                { choice: ev.choice, legacy, modes: ev.results },
            ]),
        ),
    }));
    const jsonPath =
        flag("--json") || path.join(corpusDir, "scores.json");
    fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 1));
    console.log(`scores: ${jsonPath}`);
}

/* ------------------------------------------------------------------ *
 *  HTML report.                                                       *
 * ------------------------------------------------------------------ */
const MODE_STYLE = {
    original: "",
    invert: "filter:invert(1)",
    hue: "filter:hue-rotate(180deg)",
    huefix: "filter:invert(1) hue-rotate(180deg)",
    dim: "filter:brightness(.55)",
    lift: "filter:brightness(1.9)",
    dark: "filter:brightness(0) saturate(100%)",
    light: "filter:brightness(0) saturate(100%) invert(1)",
    "halo-d": "filter:drop-shadow(0 0 0.9px rgba(15,15,19,.9))",
    "halo-l": "filter:drop-shadow(0 0 0.9px rgba(250,250,252,.9))",
    "plate-d": "background:rgb(15,15,19);border-radius:3.5px",
    "plate-l": "background:rgb(250,250,252);border-radius:3.5px",
};
const MODE_ORDER = Object.keys(MODE_STYLE);

let visible = showAll ? rows : rows.filter(r => r.touched);
if (hostFilter) {
    visible = visible.filter(row =>
        hostFilter.some(h => row.host === h || row.host.endsWith(`.${h}`)),
    );
}
if (decisionFilter) {
    visible = visible.filter(row =>
        row.perBg.some(({ ev }) => decisionFilter.includes(ev.choice)),
    );
}

const esc = s =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const thumb = (entry, mode) =>
    `<img class="ic" src="${entry.dataUri}" style="${MODE_STYLE[mode] || ""}" alt="">`;

const summaryRows = bgs
    .map((bg, i) => {
        const cells = MODE_ORDER.map(m => `<td>${stats[i][m] || 0}</td>`).join("");
        return `<tr><td><span class="swatch" style="background:${backgrounds[i]}"></span>${esc(backgrounds[i])}</td>${cells}</tr>`;
    })
    .join("\n");

const bodyRows = visible
    .map(row => {
        const cells = row.perBg
            .map(({ bg, ev, legacy }) => {
                const mode = ev.choice;
                const detail = Object.entries(ev.results)
                    .map(
                        ([name, r]) =>
                            `<tr class="${r.ok ? "ok" : ""}${name === mode ? " pick" : ""}">` +
                            `<td>${name}</td><td>${r.avg.toFixed(2)}</td><td>${(r.bad * 100).toFixed(0)}%</td>` +
                            `<td>${thumb(row.entry, name)}</td></tr>`,
                    )
                    .join("");
                const same = legacy === mode;
                return `<td class="cell" style="background:${bg}">
                    <div class="pair">${thumb(row.entry, "original")}<span class="arr">&rarr;</span>${thumb(row.entry, mode)}</div>
                    <div class="lbl">${mode}${same ? "" : ` <em>was:${legacy}</em>`}</div>
                    <details><summary>all</summary><table class="modes" style="background:${bg}">${detail}</table></details>
                </td>`;
            })
            .join("\n");
        return `<tr class="${row.touched ? "" : "untouched"}"><td class="host" title="${esc(row.entry.icon_url)}">${esc(row.host)}<br><span class="kind">${row.entry.kind}</span></td><td class="orig">${thumb(row.entry, "original")}</td>${cells}</tr>`;
    })
    .join("\n");

const html = `<!doctype html>
<meta charset="utf-8">
<title>favicon lab</title>
<style>
  body{font:12px/1.4 ui-monospace,monospace;background:#111;color:#ddd;padding:16px}
  table{border-collapse:collapse}
  td,th{padding:3px 6px;text-align:left;vertical-align:middle}
  .ic{width:16px;height:16px;image-rendering:auto;vertical-align:middle}
  .swatch{display:inline-block;width:12px;height:12px;margin-right:6px;border:1px solid #555;vertical-align:middle}
  .cell{min-width:120px}
  .pair{display:flex;align-items:center;gap:4px}
  .pair .ic{width:20px;height:20px}
  .arr{color:#888}
  .lbl{text-align:center;color:#cde}
  .lbl em{color:#e9a;font-style:normal}
  .modes{margin-top:4px}
  .modes td{padding:1px 4px;font-size:10px}
  .modes .ok td{color:#8d8}
  .modes .pick td{color:#fe8;font-weight:bold}
  .host{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .kind{color:#777}
  .untouched{opacity:.45}
  h1{font-size:14px}
  details{display:inline-block}
  summary{cursor:pointer;color:#888;font-size:10px}
</style>
<h1>favicon lab — ${items.length} icons &times; ${bgs.length} backgrounds (${visible.length} shown)</h1>
<table><tr><th>bg</th>${MODE_ORDER.map(m => `<th>${m}</th>`).join("")}</tr>
${summaryRows}</table>
<br>
<table><tr><th>site</th><th>icon</th>${backgrounds.map(b => `<th><span class="swatch" style="background:${b}"></span>${esc(b)}</th>`).join("")}</tr>
${bodyRows}
</table>`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`scored ${items.length} icons × ${bgs.length} backgrounds (${jobs} jobs)`);
for (let i = 0; i < bgs.length; i++) {
    const parts = MODE_ORDER.map(m => `${m}:${stats[i][m] || 0}`)
        .filter(s => !s.endsWith(":0"))
        .join("  ");
    console.log(`  ${backgrounds[i]}  ${parts}`);
}
console.log(`report: ${outFile}`);
