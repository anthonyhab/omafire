# Extension glyph sources

`export.py` writes `src/icons/extensions/*.svg` from the brand marks in
`brand/` (the earlier "Omarchy line" metaphors were rejected as
unrecognisable). Rules:

- Each extension's own mark, in one colour: Simple Icons (CC0) where it has the
  brand (uBlock Origin, 1Password, Dark Reader, Steam, Rakuten, Reddit);
  otherwise a potrace of the add-on's own icon (Greasemonkey, SponsorBlock,
  DeArrow, Redirector, Bypass Paywalls Clean), the add-on's own monochrome
  glyph (Multi-Account Containers, the omafox mark), or a hand-drawn mark
  where a trace turns to mush at 16px (Vimium C's V, Tether's infinity).
- Fitted by visual bounding box into a 12.5px square centred on the 16px
  grid, the optical size of Nova's toolbar icons; 14px read heavier than
  the line icons beside them.
- One `context-fill` path per glyph (strokes outlined, shapes unioned), so a
  disabled button dims evenly.

A new glyph: add `brand/<name>.svg` (no `width`/`height` on the root, so its
units are its viewBox's), a title in `export.py`, the rule in `src/icons.css`,
then run `export.py` (needs Inkscape, rsvg-convert, ImageMagick). It prints
each result's pixel difference from the fitted source.

Not part of the theme payload; only `src/` ships.
