# Write clean fill-only glyphs from the Inkscape outlines (ink/<name>.out.svg)
# and check each against the stroke-source render.
import re, subprocess, os
import final
W = "/tmp/claude-1000/-home-habibe-Projects-omarchy-firefox-bundle/50fb2e1f-6bb5-4a4b-8448-dab4d6e615f9/scratchpad/theme-glyphs/src/icons/extensions"
os.makedirs(W, exist_ok=True)
TITLE = {
 "greasemonkey": "Greasemonkey: monkey mask with a widow's-peak brow",
 "ublock": "uBlock Origin: shield with a solid core",
 "1password": "1Password: keyhole in an octagon",
 "vimium": "Vimium C: V and a block cursor",
 "darkreader": "Dark Reader: half-dark octagon",
 "ff-sync": "Omarchy FF Sync: square loop, two arrows",
 "containers": "Multi-Account Containers: three boxes and a plus",
 "sponsorblock": "SponsorBlock: skip forward",
 "dearrow": "DeArrow: struck-out arrow",
 "redirector": "Redirector: rerouted arrow",
 "bypass-paywalls": "Bypass Paywalls Clean: newspaper",
 "rakuten": "Rakuten: R",
 "augmented-steam": "Augmented Steam: piston arm",
 "res": "Reddit Enhancement Suite: upvote",
 "tether": "Tether: one-time code field",
}
def fmt(d):
    d = re.sub(r"-?\d+\.\d+", lambda m: ("%.3f" % float(m.group())).rstrip("0").rstrip("."), d)
    d = re.sub(r"\s+", " ", d).strip()
    d = re.sub(r" ?([MLHVZmlhvzC]) ?", r"\1", d)
    return d.replace(" -", "-")
for k in final.FINAL:
    ds = re.findall(r'\sd="([^"]+)"', open(f"ink/{k}.out.svg").read())
    d = "".join(fmt(x) for x in ds)
    out = (f"<!-- Omarchy Chrome extension glyph. {TITLE[k]}. -->\n"
           '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" '
           'fill="context-fill" fill-opacity="context-fill-opacity">\n'
           f'  <path fill-rule="evenodd" d="{d}"/>\n</svg>\n')
    open(f"{W}/{k}.svg", "w").write(out)
    open("ink/tmp.svg", "w").write(out.replace("context-fill-opacity", "1").replace("context-fill", "#000"))
    a, b = f"ink/{k}.chk-a.png", f"ink/{k}.chk-b.png"
    subprocess.run(["rsvg-convert", "-w", "64", "-h", "64", "-b", "white", "ink/tmp.svg", "-o", a], check=True)
    subprocess.run(["rsvg-convert", "-w", "64", "-h", "64", "-b", "white", f"ink/{k}.svg", "-o", b], check=True)
    r = subprocess.run(["magick", "compare", "-metric", "AE", "-fuzz", "20%", a, b, "null:"], capture_output=True, text=True)
    print(k, "diff", r.stderr.strip())
