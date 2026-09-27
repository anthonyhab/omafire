# Extension glyph sources

Generators for `src/icons/extensions/*.svg`. The glyphs sit beside Firefox's
Nova toolbar icons (sidebar, back, forward, reload, downloads, extensions,
menu) and are drawn to their rules:

- 16×16 grid, 1.5px strokes (Nova's width), round caps and round joins.
- Straight 90°/45° geometry with 1–1.5px corner radii; true circles only
  where the concept is round. That precision is the Omarchy half.
- Solids only as Nova-sized accents: r≈0.75–1.15 dots, small arrowheads.
- Ink coverage in the native band: Nova toolbar icons measure 16–35%
  (back 16, menu 21, downloads 22, reload 23, extensions 28, sidebar 35);
  the glyphs measure 11–34%, median 25%.
- One concept per extension, never a letter or a traced logo.

Files:

- `lib.py`: geometry helpers, rendering, metrics, toolbar strips that put the
  glyphs between the real Nova icons (dark and light, @1x/1.6x/2x).
- `native.py`: extracts the Nova icons from the installed Firefox into
  `native/` (not committed). Run it first.
- `glyphs.py`: the glyphs (the "Omarchy line" direction, picked over a
  softer Nova one and a brutalist one); prints metrics and writes preview sheets
  to `out/`.
- `export.py`: outlines and unions each glyph into one `context-fill` path
  with Inkscape, writes the SVGs and diffs them against the stroke source.

Not part of the theme payload; only `src/` ships.
