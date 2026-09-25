import monkeys_defs  # noqa: registers variants
from glyphs import G
FINAL = {
  "greasemonkey": G["gm-m"],
  "ublock": G["ublock"],
  "1password": G["1password-b"],
  "vimium": G["vimium-d"],
  "darkreader": G["contrast"],
  "ff-sync": G["sync"],
  "containers": G["containers"],
  "sponsorblock": G["sponsorblock"],
  "dearrow": G["dearrow-f"],
  "redirector": G["redirector"],
  "bypass-paywalls": G["bpc-b"],
  "rakuten": G["rakuten"],
  "augmented-steam": G["steam"],
  "res": G["upvote"],
  "tether": G["otp"],
}
for k,v in FINAL.items(): G["F-"+k]=v
if __name__=="__main__":
    import sys
    from zoom import zoom
    from glyphs import render
    render(["F-"+k for k in FINAL], "sheet-final.png")
    zoom(["F-"+k for k in list(FINAL)[:6]], "zoom-final-1.png")
    zoom(["F-"+k for k in list(FINAL)[6:]], "zoom-final-2.png")
