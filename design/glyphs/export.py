#!/usr/bin/env python3
"""Write src/icons/extensions/*.svg from glyphs.py.

Inkscape turns the strokes into outlines and unions each glyph into one
path, so a glyph paints once with context-fill/context-fill-opacity (no
darker overlaps when Firefox dims a disabled button). Each result is checked
against the stroke source render.
"""
import os, re, subprocess
from lib import HERE, glyph_svg
from glyphs import G, TITLE

DEST = os.path.normpath(os.path.join(HERE, "..", "..", "src", "icons", "extensions"))
INK = os.path.join(HERE, "ink")
os.makedirs(INK, exist_ok=True)


def fmt(d):
    d = re.sub(r"-?\d*\.\d+(?:e-?\d+)?|-?\d+", lambda m: ("%.3f" % float(m.group())).rstrip("0").rstrip("."), d)
    d = re.sub(r"\s*,\s*", " ", d)
    d = re.sub(r"\s+", " ", d).strip()
    d = re.sub(r" ?([MLHVZACQSTmlhvzacqst]) ?", r"\1", d)
    return d.replace(" -", "-").replace("-0 ", "0 ")


def outline(name):
    src = os.path.join(INK, name + ".svg"); dst = os.path.join(INK, name + ".out.svg")
    open(src, "w").write(glyph_svg(G[name], "#000"))
    subprocess.run(["inkscape", src, "--actions",
                    "select-all;object-stroke-to-path;select-all;path-union;"
                    f"export-plain-svg;export-filename:{dst};export-do"],
                   check=True, capture_output=True)
    body = open(dst).read()
    assert "transform" not in body, name + ": unexpected transform"
    return "".join(fmt(x) for x in re.findall(r'\sd="([^"]+)"', body))


def check(name, final):
    a, b = os.path.join(INK, name + ".a.png"), os.path.join(INK, name + ".b.png")
    t = os.path.join(INK, name + ".chk.svg")
    open(t, "w").write(final.replace("context-fill-opacity", "1").replace("context-fill", "#000"))
    subprocess.run(["rsvg-convert", "-w", "64", "-h", "64", "-b", "white", t, "-o", a], check=True)
    subprocess.run(["rsvg-convert", "-w", "64", "-h", "64", "-b", "white", "-o", b],
                   input=glyph_svg(G[name], "#000").encode(), check=True)
    r = subprocess.run(["magick", "compare", "-metric", "AE", "-fuzz", "20%", a, b, "null:"],
                       capture_output=True, text=True)
    return r.stderr.strip().split()[0]


if __name__ == "__main__":
    for name in G:
        d = outline(name)
        out = (f"<!-- Omarchy Chrome extension glyph. {TITLE[name]}. -->\n"
               '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" '
               'fill="context-fill" fill-opacity="context-fill-opacity">\n'
               f'  <path d="{d}"/>\n</svg>\n')
        open(os.path.join(DEST, name + ".svg"), "w").write(out)
        print(f"{name:18s} {len(out):5d}B  diff(px@64) {check(name, out)}")
