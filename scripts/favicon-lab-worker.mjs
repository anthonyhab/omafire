#!/usr/bin/env node
/*
 * Worker half of favicon-lab.mjs: loads the real decision core out of
 * favicon-contrast.uc.js through the same vm injection as the unit test,
 * then scores a slice of the corpus on every requested background.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

const { ucPath, corpusDir, backgrounds, items } = workerData;

const marker = '    const style = document.createElementNS(HTML_NS, "style");';
let source = fs.readFileSync(ucPath, "utf8");
if (!source.includes(marker)) {
    throw new Error("favicon helper test injection marker is missing");
}
source = source.replace(
    marker,
    `    globalThis.__faviconLab = {\n` +
        `        evaluate, chooseFilter, analyzeIcon, parseCssColor,\n` +
        `        relativeLuminance, contrastRatio, composite,\n` +
        `    };\n` +
        `    return;\n\n` +
        marker,
);
const context = { Components: { utils: { reportError() {} } }, window: {} };
vm.runInNewContext(source, context, { filename: ucPath });
const api = context.__faviconLab;

/* ------------------------------------------------------------------ *
 *  The previous algorithm, kept here as the comparison baseline.        *
 * ------------------------------------------------------------------ */
const LEGACY_TARGET = 2.25;
const legacyPixel = (icon, i, mode) => {
    if (mode === "dark") return { r: 0, g: 0, b: 0 };
    if (mode === "light") return { r: 255, g: 255, b: 255 };
    if (mode === "invert")
        return {
            r: 255 - icon.red[i],
            g: 255 - icon.green[i],
            b: 255 - icon.blue[i],
        };
    if (mode === "hue") {
        const [r, g, b] = [icon.red[i] / 255, icon.green[i] / 255, icon.blue[i] / 255];
        const clamp = c => Math.max(0, Math.min(1, c)) * 255;
        return {
            r: clamp(-0.574 * r + 1.43 * g + 0.144 * b),
            g: clamp(0.426 * r + 0.43 * g + 0.144 * b),
            b: clamp(0.426 * r + 1.43 * g - 0.856 * b),
        };
    }
    return { r: icon.red[i], g: icon.green[i], b: icon.blue[i] };
};
const legacyScore = (icon, bg, mode) => {
    const bgLum = api.relativeLuminance(bg.r, bg.g, bg.b);
    let visible = 0,
        poor = 0,
        sum = 0;
    for (let i = 0; i < icon.alphas.length; i++) {
        const a = icon.alphas[i];
        if (a < 0.06) continue;
        const t = legacyPixel(icon, i, mode);
        const lum = api.relativeLuminance(
            t.r * a + bg.r * (1 - a),
            t.g * a + bg.g * (1 - a),
            t.b * a + bg.b * (1 - a),
        );
        const c = api.contrastRatio(lum, bgLum);
        visible += a;
        poor += c < LEGACY_TARGET ? a : 0;
        sum += Math.min(c, 10) * a;
    }
    return visible
        ? { badFraction: poor / visible, average: sum / visible }
        : { badFraction: 0, average: 10 };
};
const legacyChoose = (icon, bg) => {
    const modes = ["original", "invert", "hue", "dark", "light"];
    const cands = modes.map(name => ({ name, result: legacyScore(icon, bg, name) }));
    const ok = c =>
        c.result.average >= LEGACY_TARGET && c.result.badFraction <= 0.35;
    const val = c => (1 - c.result.badFraction) * 10 + Math.min(c.result.average, 10);
    if (ok(cands[0])) return "original";
    let pool = cands.slice(1, 3).filter(ok);
    if (!pool.length) pool = cands.slice(3).filter(ok);
    if (!pool.length) pool = cands.slice(1);
    return pool.sort((a, b) => val(b) - val(a))[0].name;
};

const rows = [];
for (const item of items) {
    const raw = fs.readFileSync(path.join(corpusDir, "raw", `${item.sha}.rgba`));
    const pixels = raw.length / 4;
    const icon = {
        red: new Uint8Array(pixels),
        green: new Uint8Array(pixels),
        blue: new Uint8Array(pixels),
        alphas: new Float32Array(pixels),
    };
    for (let i = 0, o = 0; i < pixels; i++, o += 4) {
        icon.red[i] = raw[o];
        icon.green[i] = raw[o + 1];
        icon.blue[i] = raw[o + 2];
        icon.alphas[i] = raw[o + 3] / 255;
    }
    const perBg = backgrounds.map(bg => {
        const ev = api.evaluate(icon, bg, true);
        return {
            choice: ev.choice,
            legacy: legacyChoose(icon, bg),
            modes: Object.fromEntries(
                Object.values(ev.results).map(r => [
                    r.mode,
                    {
                        avg: +r.average.toFixed(3),
                        bad: +r.badFraction.toFixed(3),
                        det: +r.detailLoss.toFixed(3),
                        ok: r.legible,
                    },
                ]),
            ),
        };
    });
    rows.push({
        sha: item.sha,
        opaqueShare: icon.analysis?.opaqueShare ?? null,
        perBg,
    });
}

parentPort.postMessage(rows);
