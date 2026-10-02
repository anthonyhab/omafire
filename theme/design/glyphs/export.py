#!/usr/bin/env python3
"""Write src/icons/extensions/*.svg from the brand marks in brand/ (DEC-63).

Each source is fitted, by its visual bounding box, into a BOX-px square
centred on the 16px grid (12.5: the optical size of Nova's toolbar icons),
then Inkscape outlines strokes and unions everything into one path, so a
glyph paints once with context-fill/context-fill-opacity (no darker overlaps
when Firefox dims a disabled button). Each result is checked against the
fitted source render.
"""
import os, re, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "brand")
DEST = os.path.normpath(os.path.join(HERE, "..", "..", "src", "icons", "extensions"))
INK = os.path.join(HERE, "ink")
os.makedirs(INK, exist_ok=True)
BOX = 12.5

TITLE = {
    "ublock": "uBlock Origin: its shield (Simple Icons)",
    "1password": "1Password: its keyhole mark (Simple Icons)",
    "vimium": "Vimium C: Vim's serifed V (drawn)",
    "greasemonkey": "Greasemonkey: its monkey (traced from the add-on's icon)",
    "darkreader": "Dark Reader: its face (Simple Icons)",
    "ff-sync": "Omafire: the omafox mark (the add-on's icon)",
    "containers": "Multi-Account Containers: the add-on's own glyph",
    "sponsorblock": "SponsorBlock: shield with play (traced from the add-on's icon)",
    "dearrow": "DeArrow: its eye (traced from the add-on's icon)",
    "redirector": "Redirector: its arrow (traced from the add-on's icon)",
    "bypass-paywalls": "Bypass Paywalls Clean: its newspaper (traced from the add-on's icon)",
    "rakuten": "Rakuten: its R (Simple Icons)",
    "augmented-steam": "Augmented Steam: Steam's mark (Simple Icons)",
    "res": "Reddit Enhancement Suite: Reddit's Snoo (Simple Icons)",
    "tether": "Tether: an infinity link (drawn)",
}


def fmt(d):
    d = re.sub(r"-?\d*\.\d+(?:e-?\d+)?|-?\d+", lambda m: ("%.3f" % float(m.group())).rstrip("0").rstrip("."), d)
    d = re.sub(r"\s*,\s*", " ", d)
    d = re.sub(r"\s+", " ", d).strip()
    d = re.sub(r" ?([MLHVZACQSTmlhvzacqst]) ?", r"\1", d)
    return d.replace(" -", "-").replace("-0 ", "0 ")


def fitted(name):
    """The source wrapped in a 16px document, fitted into BOX, in black."""
    p = os.path.join(SRC, name + ".svg")
    src = open(p).read()
    q = subprocess.run(["inkscape", "--query-all", p], capture_output=True, text=True, check=True).stdout.splitlines()
    boxes = [tuple(map(float, l.split(",")[1:])) for l in q[1:]]
    boxes = [b for b in boxes if b[2] and b[3]]
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes); y1 = max(b[1] + b[3] for b in boxes)
    vb = re.search(r'viewBox="([^"]+)"', src)  # sources carry no width/height: px = user units
    vx, vy = map(float, vb.group(1).split()[:2]) if vb else (0, 0)
    x0 += vx; x1 += vx; y0 += vy; y1 += vy
    s = BOX / max(x1 - x0, y1 - y0)
    tx, ty = 8 - (x0 + x1) / 2 * s, 8 - (y0 + y1) / 2 * s
    inner = re.sub(r"(?s)^.*?<svg[^>]*>", "", src)
    inner = re.sub(r"(?s)</svg>\s*$", "", inner)
    inner = re.sub(r"(?s)<(style|title|metadata)\b.*?</\1>", "", inner)
    inner = re.sub(r'(fill|stroke)="(?!none)[^"]*"', r'\1="#000"', inner)
    inner = re.sub(r'\s(fill|stroke)-opacity="[^"]*"', "", inner)
    stroke = re.search(r'<svg[^>]*\sstroke="', src)
    attrs = re.search(r"<svg([^>]*)>", src).group(1)
    keep = " ".join(m.group(0) for m in re.finditer(r'(stroke-width|stroke-linecap|stroke-linejoin|fill)="[^"]*"', attrs))
    keep = re.sub(r'fill="(?!none)[^"]*"', "", keep)
    paint = ' stroke="#000"' if stroke else ' fill="#000"'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">'
            f'<g transform="translate({tx:.4f} {ty:.4f}) scale({s:.6f})" {keep}{paint}>{inner}</g></svg>\n')


def outline(name, svg):
    src = os.path.join(INK, name + ".svg"); dst = os.path.join(INK, name + ".out.svg")
    open(src, "w").write(svg)
    subprocess.run(["inkscape", src, "--actions",
                    "select-by-element:g;selection-ungroup;" * 3 +
                    "select-all;object-to-path;object-stroke-to-path;select-all;path-union;"
                    f"export-plain-svg;export-filename:{dst};export-do"],
                   check=True, capture_output=True)
    body = open(dst).read()
    assert "transform" not in body, name + ": unexpected transform"
    return "".join(fmt(x) for x in re.findall(r'\sd="([^"]+)"', body))


def check(name, final, svg):
    a, b = os.path.join(INK, name + ".a.png"), os.path.join(INK, name + ".b.png")
    t = os.path.join(INK, name + ".chk.svg")
    open(t, "w").write(final.replace("context-fill-opacity", "1").replace("context-fill", "#000"))
    subprocess.run(["rsvg-convert", "-w", "64", "-h", "64", "-b", "white", t, "-o", a], check=True)
    subprocess.run(["rsvg-convert", "-w", "64", "-h", "64", "-b", "white", "-o", b], input=svg.encode(), check=True)
    r = subprocess.run(["magick", "compare", "-metric", "AE", "-fuzz", "20%", a, b, "null:"],
                       capture_output=True, text=True)
    return r.stderr.strip().split()[0]


if __name__ == "__main__":
    for name in TITLE:
        svg = fitted(name)
        d = outline(name, svg)
        out = (f"<!-- Omafire extension glyph. {TITLE[name]}. -->\n"
               '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" '
               'fill="context-fill" fill-opacity="context-fill-opacity">\n'
               f'  <path d="{d}"/>\n</svg>\n')
        open(os.path.join(DEST, name + ".svg"), "w").write(out)
        print(f"{name:18s} {len(out):6d}B  diff(px@64) {check(name, out, svg)}")
