#!/usr/bin/env python3
"""Glyph sources (stroke centerlines + solids) and a preview sheet renderer.

Usage: glyphs.py [names...]   writes design/out/<name>.svg (preview color)
and design/sheet.png. Stroke paths use class s (1.5 wall), solids class f.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

# Each glyph: list of (kind, d). kind "s" = 1.5 stroke centerline, "f" = solid.
G = {}

G["ublock"] = [
    ("s", "M2.75 1.75H13.25V8.69L8 13.94L2.75 8.69Z"),
    ("f", "M4.5 3.5H11.5V7.96L8 11.46L4.5 7.96Z"),
]
G["ublock-b"] = [
    ("s", "M2.75 1.75H13.25V8.69L8 13.94L2.75 8.69Z"),
    ("f", "M4.5 3.5H8V11.46L4.5 7.96Z"),
]

G["1password"] = [
    ("s", "M5.31 1.75H10.69L14.25 5.31V10.69L10.69 14.25H5.31L1.75 10.69V5.31Z"),
    ("f", "M7 4H9V7.5H8V8.5H9V12H7Z"),
]

G["vimium"] = [
    ("s", "M2.2 2L7 13.2L11.8 2"),
    ("f", "M12.5 10H15V14H12.5Z"),
]

G["greasemonkey"] = [
    ("f",
     # head octagon + ears
     "M5 1H11L14 4V6H16V10H14V12L11 15H5L2 12V10H0V6H2V4Z"
     # carved mask (evenodd hole)
     "M6.5 4.5L8 6L9.5 4.5H11L12.5 6V11L10 13.5H6L3.5 11V6L5 4.5Z"
     # eyes
     "M5 7H7V9H5ZM9 7H11V9H9Z"
     # mouth
     "M6.5 11H9.5V12H6.5Z"),
]

G["coloreader"] = [
    ("f", "M1 5H7V11H1Z"),
    ("s", "M9.75 5.75H14.25V10.25H9.75Z"),
    ("f", "M7 5.5H9V7H7Z"),
]

G["sync"] = [
    ("s", "M2.75 11V2.75H10"),
    ("f", "M10 0.5L12.75 2.75L10 5Z"),
    ("s", "M13.25 5V13.25H6"),
    ("f", "M6 11L3.25 13.25L6 15.5Z"),
]

G["containers"] = [
    ("s", "M1.75 1.75H6.25V6.25H1.75Z"),
    ("s", "M1.75 9.75H6.25V14.25H1.75Z"),
    ("s", "M9.75 9.75H14.25V14.25H9.75Z"),
    ("f", "M9 3.25H15V4.75H9Z M11.25 1H12.75V7H11.25Z"),
]

G["sponsorblock"] = [
    ("f", "M3 2.5L8.5 8L3 13.5Z"),
    ("f", "M10.5 2.5H12V13.5H10.5Z"),
]

G["dearrow"] = [
    ("s", "M1.75 3.75H14.25V12.25H1.75Z"),
    ("s", "M5 10L10 5"),
    ("f", "M7 5H11V9Z"),
]

G["redirector"] = [
    ("s", "M1 4.75H11.25V11"),
    ("f", "M8.25 11H14.25L11.25 14Z"),
]

G["bpc"] = [
    ("s", "M1.75 2.75H14.25V13.25H1.75Z"),
    ("f", "M3.5 4.5H7.5V8.5H3.5Z M9 4.5H12.5V6H9Z M9 7H12.5V8.5H9Z M3.5 10H12.5V11.5H3.5Z"),
]

G["rakuten"] = [
    ("s", "M3.75 14V2.75H11.25V8.25H3.75"),
    ("s", "M7.5 8.25L13 13.75"),
]


def svg(parts, color):
    body = []
    for kind, d in parts:
        if kind == "s":
            body.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.5" '
                        'stroke-linejoin="miter" stroke-miterlimit="10" stroke-linecap="butt"/>')
        else:
            body.append(f'<path d="{d}" fill="{color}" fill-rule="evenodd"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">'
            + "".join(body) + "</svg>")


def render(names, sheet="sheet.png"):
    rows = []
    for n in names:
        cells = []
        for bg, fg in (("#0d0d0d", "#d8d8d8"), ("#f4f4f4", "#1a1a1a")):
            p = os.path.join(OUT, f"{n}-{fg[1:]}.svg")
            open(p, "w").write(svg(G[n], fg))
            for px, scale in ((16, 1), (16, 4), (26, 1), (26, 2), (64, 1)):
                png = os.path.join(OUT, f"{n}-{fg[1:]}-{px}.png")
                subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px),
                                "-b", bg, p, "-o", png], check=True)
                cell = os.path.join(OUT, f"{n}-{fg[1:]}-{px}x{scale}-cell.png")
                subprocess.run(["magick", "-size", "76x76", f"xc:{bg}", "(", png,
                                "-filter", "point", "-resize", f"{scale*100}%", ")",
                                "-gravity", "center", "-composite", cell], check=True)
                cells.append(cell)
        row = os.path.join(OUT, f"{n}-row.png")
        subprocess.run(["magick", "-size", "96x76", "xc:#555", "-fill", "white",
                        "-pointsize", "13", "-gravity", "center", "-annotate", "+0+0", n,
                        *cells, "+append", row], check=True)
        rows.append(row)
    subprocess.run(["magick", *rows, "-append", os.path.join(HERE, sheet)], check=True)


if __name__ == "__main__":
    render(sys.argv[1:] or list(G))
