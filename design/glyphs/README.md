# Extension glyph sources

Generators for `src/icons/extensions/*.svg`: a 16×16 grid, 1.5px walls,
square terminals, only 90°/45° corners (curves become octagons), one
solid mass at most, one `context-fill` path per glyph.

- `glyphs.py` defines the shapes and renders comparison sheets.
- `monkeys_defs.py` holds the Greasemonkey variants.
- `final.py` maps each extension to its chosen variant.
- `export.py` writes the SVGs. Strokes are converted to fills with Inkscape.

Not part of the theme payload; only `src/` ships.
