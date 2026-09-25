#!/usr/bin/env python3
"""The extension glyphs, v2 ("Omarchy line").

Drawn to sit beside Firefox's Nova toolbar icons: 1.5px strokes with round
caps and joins (Nova's), straight 90°/45° geometry with tight 1-1.5px corner
radii, true circles only where the concept is round, and solids only as
Nova-sized accents (r≈0.8-1 dots, small arrowheads). Ink coverage is held in
the native band (Nova toolbar icons measure 16-35%).

Usage: glyphs.py    writes out/final-strip{1,2}.png, out/final-zoom*.png and
prints metrics next to the natives.
"""
import os
from lib import S, F, poly, rect, circle, arc, f

def dot(cx, cy, r=1.0):
    return F(circle(cx, cy, r))


def head(tip, back, w=2.1):
    """Small solid arrowhead, as on Nova's reload and sync."""
    import math
    dx, dy = tip[0] - back[0], tip[1] - back[1]
    L = math.hypot(dx, dy); ux, uy = dx / L, dy / L
    b = (tip[0] - ux * w * 1.2, tip[1] - uy * w * 1.2)
    t = (tip[0] + ux * .35, tip[1] + uy * .35)
    return F(poly([t, (b[0] - uy * w, b[1] + ux * w), (b[0] + uy * w, b[1] - ux * w)], .55))


def chevron(pts):
    return S(poly(pts, 0, closed=False))


def monkey(sk=5.0, cy=8.6, er=1.45, ey=10.25, eye=.75):
    """Skull ring, ears at eye level on the sides (a monkey's, not a bear's or
    a mouse's), and the heart-shaped face mask: a widow's-peak brow that meets
    the skull, so the jaw line doubles as the bottom of the mask."""
    x0, x1 = 8 - sk + .55, 8 + sk - .55
    brow = (f"M{f(x0)} {f(cy + .6)}C{f(x0 + .5)} {f(cy - 1.5)} {f(x0 + 1.8)} {f(cy - 2.35)} 6.4 {f(cy - 2.05)}"
            f"C7.2 {f(cy - 1.85)} 7.7 {f(cy - 1.35)} 8 {f(cy - .75)}C8.3 {f(cy - 1.35)} 8.8 {f(cy - 1.85)} 9.6 {f(cy - 2.05)}"
            f"C{f(x1 - 1.8)} {f(cy - 2.35)} {f(x1 - .5)} {f(cy - 1.5)} {f(x1)} {f(cy + .6)}")
    return [S(circle(8, cy, sk)),
            S(arc(8 - sk - er + .35, cy, er, 90, 270)), S(arc(8 + sk + er - .35, cy, er, 90, -90)),
            S(brow), dot(6.3, ey, eye), dot(9.7, ey, eye)]


SHIELD = [(2.75, 2.25), (13.25, 2.25), (13.25, 8.25), (8, 14.25), (2.75, 8.25)]
CUBE = [(8, 2.25), (13.25, 5.25), (13.25, 10.75), (8, 13.75), (2.75, 10.75), (2.75, 5.25)]

G = {
    # Greasemonkey: a monkey head in the native line
    "greasemonkey": monkey(),
    # uBlock Origin: a shield with a block bar
    "ublock": [S(poly(SHIELD, 1)), S("M5.5 7H10.5")],
    # 1Password: its ring with a keyhole
    "1password": [S(circle(8, 8, 5.75)), dot(8, 6.9, 1.15), S("M8 7.5V10.75")],
    # Vimium C: a command prompt: the browser driven from the keyboard
    "vimium": [chevron([(2.75, 3.75), (7.25, 8), (2.75, 12.25)]), S("M9.25 12.25H13.25")],
    # Dark Reader: a crescent moon
    "darkreader": None,  # filled in below (needs the circle intersection)
    # Omarchy FF Sync: Omarchy's square O opened into a two-arrow loop
    "ff-sync": [S(poly([(2.75, 10), (2.75, 2.75), (10.25, 2.75)], 1.2, False)), head((12.6, 2.75), (10, 2.75)),
                S(poly([(13.25, 6), (13.25, 13.25), (5.75, 13.25)], 1.2, False)), head((3.4, 13.25), (6, 13.25))],
    # Multi-Account Containers: a box
    "containers": [S(poly(CUBE, .9)), chevron([(3.1, 5.45), (8, 8.25), (12.9, 5.45)]), S("M8 8.25V13.4")],
    # SponsorBlock: skip forward
    "sponsorblock": [S(poly([(3.25, 3.5), (10, 8), (3.25, 12.5)], 1)), S("M12.75 3.25V12.75")],
    # DeArrow: the clickbait arrow in its thumbnail
    "dearrow": [S(rect(1.75, 3.75, 12.5, 8.5, 1.5)), S("M6 6.5L9.75 10"), chevron([(9.75, 7.5), (9.75, 10), (7.25, 10)])],
    # Redirector: a route bent to a new destination, from its origin
    "redirector": [dot(2.5, 4.75), S(poly([(4.75, 4.75), (11.75, 4.75), (11.75, 12)], 1.65, False)),
                   chevron([(9, 11), (11.75, 13.75), (14.5, 11)])],
    # Bypass Paywalls Clean: a folded newspaper
    "bypass-paywalls": [S(poly([(4.75, 2.75), (14.25, 2.75), (14.25, 11.75), (12.75, 13.25), (3.25, 13.25)], 1.25, False)),
                        S(poly([(4.75, 2.75), (4.75, 12), (3.5, 13.25), (2.25, 12.25), (2.25, 7), (4.75, 7)], .9, False)),
                        S("M7.5 6H11.5"), S("M7.5 9.5H11.5")],
    # Rakuten: cash back: a shopping bag with a smile
    "rakuten": [S(rect(2.75, 5.75, 10.5, 8.5, 1.5)), S(arc(8, 5.75, 2.25, 180, 360)), S(arc(8, 8.25, 2.5, 35, 145))],
    # Augmented Steam: Steam's piston arm
    "augmented-steam": [S(circle(10.25, 5.75, 3.25)), S(circle(4.5, 11.5, 2)), S("M6.1 10.1L7.85 8.35"), dot(10.25, 5.75, .9)],
    # Reddit Enhancement Suite: the upvote
    "res": [S(poly([(8, 1.75), (14.25, 8), (10.75, 8), (10.75, 14.25), (5.25, 14.25), (5.25, 8), (1.75, 8)], 1))],
    # Tether: a one-time-code field
    "tether": [S(rect(1.75, 4.25, 12.5, 7.5, 1.35)), dot(5, 8), dot(8, 8), dot(11, 8)],
}


def _crescent(cx, cy, R, ox, oy, r):
    import math
    d = math.hypot(ox - cx, oy - cy)
    a = (R * R - r * r + d * d) / (2 * d); h = math.sqrt(R * R - a * a)
    mx, my = cx + a * (ox - cx) / d, cy + a * (oy - cy) / d
    p1 = (mx + h * (oy - cy) / d, my - h * (ox - cx) / d)
    p2 = (mx - h * (oy - cy) / d, my + h * (ox - cx) / d)
    return (f"M{f(p1[0])} {f(p1[1])}A{f(R)} {f(R)} 0 1 0 {f(p2[0])} {f(p2[1])}"
            f"A{f(r)} {f(r)} 0 0 1 {f(p1[0])} {f(p1[1])}Z")


G["darkreader"] = [S(_crescent(8, 8, 5.75, 11.25, 4.75, 4.1))]

TITLE = {
    "greasemonkey": "Greasemonkey: monkey head, side ears, widow's-peak face mask",
    "ublock": "uBlock Origin: shield with a block bar",
    "1password": "1Password: ring with a keyhole",
    "vimium": "Vimium C: command prompt",
    "darkreader": "Dark Reader: crescent moon",
    "ff-sync": "Omarchy FF Sync: square O opened into a two-arrow loop",
    "containers": "Multi-Account Containers: box",
    "sponsorblock": "SponsorBlock: skip forward",
    "dearrow": "DeArrow: arrow in a thumbnail",
    "redirector": "Redirector: route bent to a new destination",
    "bypass-paywalls": "Bypass Paywalls Clean: folded newspaper",
    "rakuten": "Rakuten: shopping bag with a smile",
    "augmented-steam": "Augmented Steam: piston arm",
    "res": "Reddit Enhancement Suite: upvote",
    "tether": "Tether: one-time-code field",
}

# Toolbar order as the user has them, then the rest.
ORDER = ["ublock", "1password", "vimium", "greasemonkey", "darkreader", "ff-sync", "containers", "sponsorblock",
         "dearrow", "redirector", "bypass-paywalls", "rakuten", "augmented-steam", "res", "tether"]

if __name__ == "__main__":
    from lib import strip_sheet, zoom_sheet, glyph_svg, native_svg, metrics, fmt_metrics, OUT
    for n in ("back", "forward", "reload", "menu", "sidebar-collapsed", "downloads", "extension"):
        print(fmt_metrics("native " + n, metrics(native_svg(n))))
    for n in ORDER:
        print(fmt_metrics(n, metrics(glyph_svg(G[n]))))
    strip_sheet([G[n] for n in ORDER[:8]], os.path.join(OUT, "final-strip1.png"), label="v2 Omarchy line", urlbar=40)
    strip_sheet([G[n] for n in ORDER[8:]], os.path.join(OUT, "final-strip2.png"), label="v2 Omarchy line", urlbar=40)
    for i in range(0, len(ORDER), 8):
        zoom_sheet([(n, G[n]) for n in ORDER[i:i + 8]], os.path.join(OUT, f"final-zoom{i // 8 + 1}.png"), native=("back", "reload"))
