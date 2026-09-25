"""Shared drawing, measuring and preview code for the extension glyphs.

A glyph is SVG markup on a 16x16 grid. Class "s" is a 1.5px stroke (caps and
joins come from the direction's style), class "f" a solid, class "h" a
stroke hole (painted in the background colour, used only for previews of
knock-outs; export turns it into a real cut).
"""
import io, math, os, re, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

# Firefox's own Nova toolbar icons, extracted from omni.ja by native.py.
NATIVE = os.path.join(HERE, "native")

SW = 1.5  # stroke width, the same as Nova's


# ---- geometry helpers ------------------------------------------------------

def f(n):
    s = ("%.3f" % n).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def poly(pts, r=0.0, closed=True):
    """Polyline/polygon with each corner rounded by radius r (a circular arc
    tangent to both edges, clamped to half the shorter edge)."""
    n = len(pts)
    out = []
    idx = range(n) if closed else range(1, n - 1)
    corners = {}
    for i in idx:
        p0, p1, p2 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
        v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1 = math.hypot(*v1); l2 = math.hypot(*v2)
        cosang = max(-1, min(1, (v1[0]*v2[0] + v1[1]*v2[1]) / (l1*l2)))
        ang = math.acos(cosang)
        if r <= 0 or ang > math.pi - 1e-6:
            corners[i] = None; continue
        t = r / math.tan(ang / 2)
        t = min(t, l1 / 2, l2 / 2)
        rr = t * math.tan(ang / 2)
        a = (p1[0] + v1[0]/l1*t, p1[1] + v1[1]/l1*t)
        b = (p1[0] + v2[0]/l2*t, p1[1] + v2[1]/l2*t)
        sweep = 1 if (v1[0]*v2[1] - v1[1]*v2[0]) < 0 else 0
        corners[i] = (a, b, rr, sweep)
    def start(i):
        c = corners.get(i)
        return c[1] if c else pts[i]
    if closed:
        c0 = corners.get(0)
        out.append("M" + f((c0[1] if c0 else pts[0])[0]) + " " + f((c0[1] if c0 else pts[0])[1]))
        order = list(range(1, n)) + [0]
    else:
        out.append("M" + f(pts[0][0]) + " " + f(pts[0][1]))
        order = list(range(1, n))
    for i in order:
        c = corners.get(i)
        if c:
            a, b, rr, sw = c
            out.append(f"L{f(a[0])} {f(a[1])}A{f(rr)} {f(rr)} 0 0 {sw} {f(b[0])} {f(b[1])}")
        else:
            out.append(f"L{f(pts[i][0])} {f(pts[i][1])}")
    if closed:
        out.append("Z")
    return "".join(out)


def rect(x, y, w, h, r=0.0):
    return poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], r)


def circle(cx, cy, r):
    return f"M{f(cx - r)} {f(cy)}A{f(r)} {f(r)} 0 1 0 {f(cx + r)} {f(cy)}A{f(r)} {f(r)} 0 1 0 {f(cx - r)} {f(cy)}Z"


def arc(cx, cy, r, a0, a1):
    """Arc from angle a0 to a1 (degrees, 0 = +x, clockwise on screen)."""
    p0 = (cx + r*math.cos(math.radians(a0)), cy + r*math.sin(math.radians(a0)))
    p1 = (cx + r*math.cos(math.radians(a1)), cy + r*math.sin(math.radians(a1)))
    large = 1 if abs(a1 - a0) % 360 > 180 else 0
    sweep = 1 if a1 > a0 else 0
    return f"M{f(p0[0])} {f(p0[1])}A{f(r)} {f(r)} 0 {large} {sweep} {f(p1[0])} {f(p1[1])}"


def S(d):
    return ("s", d)


def F(d):
    return ("f", d)


# ---- rendering -------------------------------------------------------------

def glyph_svg(parts, color="#000", cap="round", join="round", size=16):
    body = []
    for kind, d in parts:
        if kind == "s":
            body.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{SW}" '
                        f'stroke-linecap="{cap}" stroke-linejoin="{join}" stroke-miterlimit="10"/>')
        else:
            body.append(f'<path d="{d}" fill="{color}" fill-rule="evenodd"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="{size}" height="{size}">'
            + "".join(body) + "</svg>")


def native_svg(name, color="#000"):
    s = open(os.path.join(NATIVE, name + ".svg")).read()
    return s.replace('"FG"', f'"{color}"')


def inner(svgtext):
    """<svg> markup -> (viewBox, inner markup)."""
    vb = re.search(r'viewBox="([^"]+)"', svgtext).group(1)
    body = re.sub(r"^.*?<svg[^>]*>", "", svgtext, flags=re.S)
    body = re.sub(r"</svg>\s*$", "", body)
    return vb, body


def rsvg(svgtext, out, zoom=None, w=None, bg=None):
    cmd = ["rsvg-convert"]
    if zoom: cmd += ["-z", str(zoom)]
    if w: cmd += ["-w", str(w), "-h", str(w)]
    if bg: cmd += ["-b", bg]
    cmd += ["-o", out]
    subprocess.run(cmd, input=svgtext.encode(), check=True)


# ---- metrics ---------------------------------------------------------------

def metrics(svgtext):
    import numpy as np
    from PIL import Image
    def raster(px):
        p = subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px)], input=svgtext.encode(),
                           capture_output=True, check=True)
        return np.asarray(Image.open(io.BytesIO(p.stdout)).convert("RGBA"))[..., 3] / 255.0
    a = raster(320)
    ys, xs = (a > 0.5).nonzero()
    bb = (xs.min() / 20, ys.min() / 20, (xs.max() + 1) / 20, (ys.max() + 1) / 20)
    box = a[int(bb[1]*20):int(bb[3]*20), int(bb[0]*20):int(bb[2]*20)]
    return dict(cov=a.mean() * 100, w=bb[2] - bb[0], h=bb[3] - bb[1], inbox=box.mean() * 100,
                cx=(xs.mean() + .5) / 20, cy=(ys.mean() + .5) / 20)


def fmt_metrics(name, m):
    return (f"{name:22s} cov {m['cov']:5.1f}%  box {m['w']:4.1f}x{m['h']:4.1f}  "
            f"in-box {m['inbox']:4.1f}%  centroid {m['cx']:4.1f},{m['cy']:4.1f}")


# ---- toolbar strip ---------------------------------------------------------

THEMES = {"dark": ("#111111", "#e4e4e4", "#1c1c1c"), "light": ("#f3f3f1", "#1d1d1d", "#e4e4e2")}
LEFT = ["sidebar-collapsed", "back", "forward", "reload"]
RIGHT_NATIVE = ["downloads", "extension"]


def strip_svg(glyphs, theme="dark", cap="round", join="round", urlbar=150, hover=None):
    """A nav-bar: native sidebar/back/forward/reload, an urlbar, native
    downloads + extensions, then `glyphs` (list of parts or ('native', name)),
    then the native app menu. 32px tiles, icons at 8,8 — like Firefox."""
    bg, fg, field = THEMES[theme]
    cells = [("native", n) for n in LEFT] + ["urlbar"] + [("native", n) for n in RIGHT_NATIVE] \
        + list(glyphs) + [("native", "menu")]
    x = 4
    out = []
    for i, c in enumerate(cells):
        if c == "urlbar":
            out.append(f'<rect x="{x+4}" y="4" width="{urlbar-8}" height="24" rx="4" fill="{field}"/>')
            x += urlbar; continue
        if hover == i:
            out.append(f'<rect x="{x}" y="0" width="32" height="32" rx="4" fill="{field}"/>')
        if isinstance(c, tuple) and c[0] == "native":
            vb, body = inner(native_svg(c[1], fg))
        else:
            vb, body = inner(glyph_svg(c, fg, cap, join))
        out.append(f'<svg x="{x+8}" y="8" width="16" height="16" viewBox="{vb}" fill="{fg}">{body}</svg>')
        x += 32
    W = x + 4
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="32" viewBox="0 0 {W} 32">'
            f'<rect width="{W}" height="32" fill="{bg}"/>' + "".join(out) + "</svg>")


def strip_sheet(glyphs, out, cap="round", join="round", label=None, urlbar=150):
    """Dark + light strips at 1x (shown 2x nearest), 1.6x and 2x, stacked."""
    rows = []
    for theme in ("dark", "light"):
        s = strip_svg(glyphs, theme, cap, join, urlbar)
        for z in (1, 1.6, 2):
            p = os.path.join(OUT, f"_strip-{theme}-{z}.png")
            rsvg(s, p, zoom=z)
            if z == 1:
                subprocess.run(["magick", p, "-filter", "point", "-resize", "200%", p], check=True)
            rows.append(p)
    cmd = ["magick", *rows, "-background", "#555", "-gravity", "north", "-splice", "0x6", "-append", "-gravity", "north"]
    if label:
        cmd += ["-gravity", "north", "-splice", "0x24", "-fill", "white", "-pointsize", "16",
                "-annotate", "+0+4", label]
    subprocess.run(cmd + [out], check=True)


def zoom_sheet(names_parts, out, cap="round", join="round", native=("back", "reload", "menu", "downloads")):
    """Per glyph: 16px @1x shown 8x (pixels), @1.6x and @2x shown 4x, dark and
    light. Natives first as a reference row."""
    from PIL import Image
    rows = []
    items = [(n, ("native", n)) for n in native] + list(names_parts)
    for name, parts in items:
        cells = []
        for theme in ("dark", "light"):
            bg, fg, _ = THEMES[theme]
            svgt = native_svg(parts[1], fg) if isinstance(parts, tuple) and parts[0] == "native" \
                else glyph_svg(parts, fg, cap, join)
            for px, sc in ((16, 8), (26, 5), (32, 4)):
                p = os.path.join(OUT, f"_z-{theme}-{px}.png")
                rsvg(svgt, p, w=px, bg=bg)
                c = os.path.join(OUT, f"_z-{name}-{theme}-{px}.png")
                subprocess.run(["magick", "-size", "140x140", f"xc:{bg}", "(", p, "-filter", "point",
                                "-resize", f"{sc*100}%", ")", "-gravity", "center", "-composite", c], check=True)
                cells.append(c)
        r = os.path.join(OUT, f"_z-{name}-row.png")
        subprocess.run(["magick", "-size", "120x140", "xc:#444", "-fill", "white", "-pointsize", "13",
                        "-gravity", "center", "-annotate", "+0+0", name, *cells, "+append", r], check=True)
        rows.append(r)
    subprocess.run(["magick", *rows, "-append", out], check=True)
