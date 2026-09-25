#!/usr/bin/env python3
"""Three candidate directions for the whole set, each drawn from the same
concepts so they compare like for like.

  A  Nova soft      round caps/joins, generous radii, true curves
  B  Omarchy line   round caps/joins, tight radii, straight 90/45 geometry,
                    circles only where the concept is round
  C  Brutalist line square caps, miter joins, no radii, octagons for curves

Usage: candidates.py            writes sheets to out/cand-*.png
"""
import math
from lib import S, F, poly, rect, circle, arc, f

DIRS = {
    "A": dict(r=2.75, rs=1.75, cap="round", join="round", oct=False, name="A  Nova soft"),
    "B": dict(r=1.5, rs=1.0, cap="round", join="round", oct=False, name="B  Omarchy line"),
    "C": dict(r=0.0, rs=0.0, cap="butt", join="miter", oct=True, name="C  Brutalist line"),
}


def ring(D, cx, cy, r):
    if not D["oct"]:
        return circle(cx, cy, r)
    k = r * math.tan(math.pi / 8)
    return poly([(cx - k, cy - r), (cx + k, cy - r), (cx + r, cy - k), (cx + r, cy + k),
                 (cx + k, cy + r), (cx - k, cy + r), (cx - r, cy + k), (cx - r, cy - k)])


def dot(cx, cy, r=1.0):
    return F(circle(cx, cy, r))


def sq(cx, cy, r=1.0):
    return F(rect(cx - r, cy - r, 2 * r, 2 * r))


def pip(D, cx, cy, r=1.0):
    return sq(cx, cy, r * .9) if D["oct"] else dot(cx, cy, r)


def head(D, tip, back, w=2.25):
    """Arrowhead at `tip` for a shaft coming from `back`: a small solid
    triangle like Nova's reload/sync heads (C: sharp; A/B: rounded)."""
    dx, dy = tip[0] - back[0], tip[1] - back[1]
    L = math.hypot(dx, dy); ux, uy = dx / L, dy / L
    b = (tip[0] - ux * w * 1.2, tip[1] - uy * w * 1.2)
    p1 = (b[0] - uy * w, b[1] + ux * w); p2 = (b[0] + uy * w, b[1] - ux * w)
    t = (tip[0] + ux * .35, tip[1] + uy * .35)
    return F(poly([t, p1, p2], 0 if D["oct"] else .55))


def chev(D, tip, back, w=2.75):
    """Open chevron arrowhead (Nova back/forward style)."""
    dx, dy = tip[0] - back[0], tip[1] - back[1]
    L = math.hypot(dx, dy); ux, uy = dx / L, dy / L
    b = (tip[0] - ux * w, tip[1] - uy * w)
    p1 = (b[0] - uy * w, b[1] + ux * w); p2 = (b[0] + uy * w, b[1] - ux * w)
    return S(poly([p1, tip, p2], 0, closed=False))


def crescent(cx, cy, R, ox, oy, r):
    """Outer circle (cx,cy,R) minus circle (ox,oy,r): the lit sliver's outline."""
    d = math.hypot(ox - cx, oy - cy)
    a = (R * R - r * r + d * d) / (2 * d); h = math.sqrt(R * R - a * a)
    mx, my = cx + a * (ox - cx) / d, cy + a * (oy - cy) / d
    p1 = (mx + h * (oy - cy) / d, my - h * (ox - cx) / d)
    p2 = (mx - h * (oy - cy) / d, my + h * (ox - cx) / d)
    return (f"M{f(p1[0])} {f(p1[1])}A{f(R)} {f(R)} 0 1 0 {f(p2[0])} {f(p2[1])}"
            f"A{f(r)} {f(r)} 0 0 1 {f(p1[0])} {f(p1[1])}Z")


def build(D):
    r, rs = D["r"], D["rs"]
    G = {}

    # uBlock Origin — a shield, split per pale (its two-tone crest)
    top, side, tipy = 2.25, 8.25, 14.25
    sh = [(2.75, top), (13.25, top), (13.25, side), (8, tipy), (2.75, side)]
    if D["oct"] is False and r > 2:
        G["ublock"] = [S(f"M8 {top}C10.5 {top} 12 2.9 13.25 3.25V8C13.25 10.75 10.75 12.9 8 14.25"
                         f"C5.25 12.9 2.75 10.75 2.75 8V3.25C4 2.9 5.5 {top} 8 {top}Z"),
                       S(f"M8 5.25V11")]
    else:
        G["ublock"] = [S(poly(sh, rs)), S("M8 5.25V11")]
    G["ublock-core"] = [S(poly(sh, rs)), F(poly([(5.5, 5), (10.5, 5), (10.5, 7.6), (8, 10.1), (5.5, 7.6)], rs * .5))]
    G["ublock-bar"] = [S(poly(sh, rs)), S("M5.5 7H10.5")]

    # 1Password — a ring with the upright bar of its mark
    G["1password"] = [S(ring(D, 8, 8, 5.75)), S("M8 5.25V10.75")]
    G["1password-key"] = [S(ring(D, 8, 8, 5.75)), pip(D, 8, 6.9, 1.15), S("M8 7.5V10.75")]

    # Vimium C — a keycap with a v-chevron: keyboard-driven, no letter
    G["vimium"] = [S(rect(2.25, 2.25, 11.5, 11.5, r)), S(poly([(5.25, 6.5), (8, 9.75), (10.75, 6.5)], 0, False))]
    # link hint: a hint label pointing at a caret
    G["vimium-hint"] = [S(rect(1.75, 2.75, 8.5, 6, r * .7)), S("M4.5 5.75H7.5"),
                        S(poly([(9.5, 9.5), (13.75, 13.75)], 0, False)), head(D, (9.2, 9.2), (13.75, 13.75), 2)]

    # Greasemonkey
    #  gm-mask: head + side ears + widow's-peak brow + eyes
    hc, hr = (8, 8.5), 5.25
    ear_l = arc(2.4, 8.5, 1.7, 90, 270) if not D["oct"] else poly([(3.1, 10.2), (1.4, 10.2), (0.75, 9.5), (0.75, 7.5), (1.4, 6.8), (3.1, 6.8)], 0, False)
    ear_r = arc(13.6, 8.5, 1.7, 90, -90) if not D["oct"] else poly([(12.9, 10.2), (14.6, 10.2), (15.25, 9.5), (15.25, 7.5), (14.6, 6.8), (12.9, 6.8)], 0, False)
    G["gm-mask"] = [S(ring(D, *hc, hr)), S(ear_l), S(ear_r),
                    S(poly([(4.75, 8.5), (6.35, 6.6), (8, 7.8), (9.65, 6.6), (11.25, 8.5)], rs * .8, False)),
                    pip(D, 6.4, 9.6, .85), pip(D, 9.6, 9.6, .85)]
    #  gm-face: head + ears + eyes + muzzle smile (no brow)
    G["gm-face"] = [S(ring(D, *hc, hr)), S(ear_l), S(ear_r),
                    pip(D, 6.25, 7.75, .85), pip(D, 9.75, 7.75, .85),
                    S(arc(8, 9.4, 2.1, 30, 150) if not D["oct"] else "M6 11L7 12H9L10 11")]
    #  gm-braces: a userscript monkey — braces are the ears/cheeks, {•‿•}
    if D["oct"]:
        lb = "M4.75 2.75H3.25V6.75L1.75 8L3.25 9.25V13.25H4.75"
        rb = "M11.25 2.75H12.75V6.75L14.25 8L12.75 9.25V13.25H11.25"
    else:
        lb = "M5 2.5C3.5 2.5 3.25 3.25 3.25 4.5V6.5C3.25 7.5 2.75 8 1.75 8C2.75 8 3.25 8.5 3.25 9.5V11.5C3.25 12.75 3.5 13.5 5 13.5"
        rb = "M11 2.5C12.5 2.5 12.75 3.25 12.75 4.5V6.5C12.75 7.5 13.25 8 14.25 8C13.25 8 12.75 8.5 12.75 9.5V11.5C12.75 12.75 12.5 13.5 11 13.5"
    G["gm-braces"] = [S(lb), S(rb), pip(D, 6.5, 7, .9), pip(D, 9.5, 7, .9),
                      S(arc(8, 8.4, 2.1, 35, 145) if not D["oct"] else "M6.25 10L7 10.75H9L9.75 10")]
    #  gm-mono: a monkey head as one line — skull, ears and the heart-shaped
    #  face mask sharing the outline (the mask *is* the lower face)
    if D["oct"]:
        G["gm-mono"] = [S(ring(D, 8, 8.25, 5.5)), S(ear_l), S(ear_r),
                        S("M4.5 10.25V8L6 6.5H6.75L8 7.75L9.25 6.5H10L11.5 8V10.25"), pip(D, 6.4, 9.5, .8), pip(D, 9.6, 9.5, .8)]
    else:
        G["gm-mono"] = [S(ring(D, 8, 8.25, 5.5)), S(ear_l), S(ear_r),
                        S("M4.6 11.2C4.2 9.7 4.4 7 6.4 6.6C7.3 6.4 7.8 7 8 7.6C8.2 7 8.7 6.4 9.6 6.6C11.6 7 11.8 9.7 11.4 11.2"),
                        pip(D, 6.45, 9.4, .8), pip(D, 9.55, 9.4, .8)]

    # Dark Reader — a crescent (night) ; alt: a half-dark disc
    if D["oct"]:
        G["darkreader"] = [S("M9.5 2.25H5.5L2.25 5.5V10.5L5.5 13.75H10.5L13.75 10.5V9.5L12.5 10.25H9.75L7.25 7.75V4.5Z")]
    else:
        G["darkreader"] = [S(crescent(8, 8, 5.75, 11.25, 4.75, 4.1))]
    G["darkreader-half"] = [S(ring(D, 8, 8, 5.75)), F(f"M8 4.5A3.5 3.5 0 0 1 8 11.5Z" if not D["oct"] else "M8 4.5H9.5L11.5 6.5V9.5L9.5 11.5H8Z")]

    # Omarchy FF Sync — Omarchy's square "O" opened into a two-arrow loop
    G["ff-sync"] = [S(poly([(2.75, 10), (2.75, 2.75), (10.25, 2.75)], r * .8, False)), head(D, (12.6, 2.75), (10, 2.75), 2.1),
                    S(poly([(13.25, 6), (13.25, 13.25), (5.75, 13.25)], r * .8, False)), head(D, (3.4, 13.25), (6, 13.25), 2.1)]
    G["ff-sync-o"] = [S(poly([(2.75, 11.5), (2.75, 2.75), (9, 2.75)], r * .8, False)),
                      S(poly([(13.25, 4.5), (13.25, 13.25), (7, 13.25)], r * .8, False)),
                      pip(D, 12, 2.75, .9), pip(D, 4, 13.25, .9)]

    # Multi-Account Containers — a shipping container: box + ribs
    G["containers"] = [S(rect(1.75, 3.75, 12.5, 8.5, rs)), S("M5.75 6.5V9.5"), S("M8 6.5V9.5"), S("M10.25 6.5V9.5")]
    # stacked boxes (identities side by side)
    G["containers-stack"] = [S(rect(1.75, 7.25, 5.5, 6, rs)), S(rect(8.75, 7.25, 5.5, 6, rs)), S(rect(5.25, 1.75, 5.5, 5.5, rs))]

    # SponsorBlock — skip over a segment
    G["sponsorblock"] = [S(poly([(3.25, 3.5), (10, 8), (3.25, 12.5)], rs)), S("M12.75 3.25V12.75")]
    G["sponsorblock-jump"] = [S("M1.75 12.75H4.5"), S("M11.5 12.75H14.25"), S("M6.5 12.75H9.5" if False else "M7 12.75H9"),
                              S(arc(8, 10.25, 5, 180, 330) if not D["oct"] else "M3 9.75V7.25L5.25 5H10.75L12.75 7"),
                              head(D, (12.85, 7.9), (11.2, 6.1), 1.9)]

    # DeArrow — the thumbnail arrow, pulled out of its frame
    G["dearrow"] = [S(poly([(9.25, 2.75), (2.75, 2.75), (2.75, 13.25), (13.25, 13.25), (13.25, 6.75)], rs, False)),
                    S("M6.25 9.75L13.5 2.5"), S(poly([(9.25, 2.5), (13.5, 2.5), (13.5, 6.75)], 0, False))]
    # a curved clickbait arrow, struck through
    G["dearrow-strike"] = [S("M3 12.5C4.5 7.5 7.5 5 12 4.25" if not D["oct"] else "M3 12.75V8.75L7.25 4.5H12"),
                           head(D, (13.6, 4.2), (11.25, 4.35), 2.1), S("M4.25 4.25L11.75 11.75")]
    G["dearrow-frame"] = [S(rect(1.75, 3.25, 12.5, 9.5, rs)), S("M5.25 9.5L10.75 6.5" if False else "M5.5 6.25L9.75 9.75"),
                          head(D, (10.6, 10.45), (5.5, 6.25), 1.9)]

    # Redirector — a route bent to a new destination, with its origin
    G["redirector"] = [pip(D, 2.5, 4.75, 1), S(poly([(4.75, 4.75), (11.75, 4.75), (11.75, 12)], r * 1.1, False)),
                       chev(D, (11.75, 13.75), (11.75, 4.75), 2.75)]
    G["redirector-fork"] = [S("M1.75 8H6"), S(poly([(6, 8), (8.75, 3.75), (13.5, 3.75)], rs, False)),
                            chev(D, (14, 3.75), (8, 3.75), 2.2), S("M6 8L8.25 11.5H9.25" if False else "M8 8H9.5"), S("M11.5 8H12.25")]

    # Bypass Paywalls Clean — a newspaper
    G["bypass-paywalls"] = [S(rect(1.75, 2.75, 12.5, 10.5, rs)), S(rect(4.25, 5.25, 3, 3, rs * .5)),
                            S("M9.75 5.5H11.75"), S("M9.75 8H11.75"), S("M4.5 10.75H11.75")]
    G["bpc-lines"] = [S(poly([(10.75, 2.75), (1.75, 2.75), (1.75, 13.25), (14.25, 13.25), (14.25, 6.25)], rs, False)),
                      S(poly([(10.75, 2.75), (14.25, 6.25)], 0, False)), S("M4.5 6.5H8"), S("M4.5 9H11.5"), S("M4.5 11.5H11.5")]
    # a wall with an arrow through the breach
    G["bpc-wall"] = [S("M2.75 1.75V14.25"), S("M13.25 1.75V14.25"), S("M2.75 5H6"), S("M10 5H13.25"),
                     S("M2.75 11H6"), S("M10 11H13.25"), S("M5 8H11"), chev(D, (11.75, 8), (5, 8), 2.5)]

    # Rakuten — cash back: a shopping bag with the Rakuten swoosh
    G["rakuten"] = [S(rect(2.75, 5.25, 10.5, 9, rs)),
                    S(arc(8, 5.25, 2.5, 180, 360) if not D["oct"] else "M5.5 5.25V3.75L6.5 2.75H9.5L10.5 3.75V5.25"),
                    S(arc(8, 7.75, 3, 35, 145) if not D["oct"] else "M5.5 9.5L6.5 10.5H9.5L10.5 9.5")]
    G["rakuten-tag"] = [S(poly([(2.25, 2.25), (8.25, 2.25), (13.75, 7.75), (7.75, 13.75), (2.25, 8.25)], rs)), pip(D, 5.5, 5.5, 1)]

    # Augmented Steam — Steam's piston arm
    G["augmented-steam"] = [S(ring(D, 10.25, 5.75, 3.25)), S(ring(D, 4.5, 11.5, 2)),
                            S("M6.1 10.1L7.85 8.35" if True else ""), pip(D, 10.25, 5.75, .9)]

    # RES — the upvote
    G["res"] = [S(poly([(8, 1.75), (14.25, 8), (10.75, 8), (10.75, 14.25), (5.25, 14.25), (5.25, 8), (1.75, 8)], rs))]

    # Tether — a one-time-code field
    G["tether"] = [S(rect(1.75, 4.25, 12.5, 7.5, r * .9)), pip(D, 5, 8), pip(D, 8, 8), pip(D, 11, 8)]
    return G


SET = ["ublock", "1password", "vimium", "gm-mask", "darkreader", "ff-sync", "containers", "sponsorblock",
       "dearrow", "redirector", "bypass-paywalls", "rakuten", "augmented-steam", "res", "tether"]

if __name__ == "__main__":
    import os, sys
    from lib import strip_sheet, zoom_sheet, glyph_svg, metrics, fmt_metrics, OUT
    for k, D in DIRS.items():
        G = build(D)
        for i, part in enumerate((SET[:8], SET[8:])):
            strip_sheet([G[n] for n in part], os.path.join(OUT, f"cand-{k}-strip{i+1}.png"), D["cap"], D["join"], D["name"], urlbar=40)
        zoom_sheet([(n, G[n]) for n in G], os.path.join(OUT, f"cand-{k}-zoom.png"), D["cap"], D["join"])
        print("==", D["name"])
        covs = []
        for n in G:
            m = metrics(glyph_svg(G[n], "#000", D["cap"], D["join"]))
            covs.append(m["cov"]) if n in SET else None
            print(" ", fmt_metrics(n, m))
        print("  set median cov %.1f%%  max %.1f%%" % (sorted(covs)[len(covs)//2], max(covs)))
