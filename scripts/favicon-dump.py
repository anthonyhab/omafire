#!/usr/bin/env python3
"""Extract and rasterize the favicon corpus from a Firefox favicons.sqlite.

Copies the database (it may be locked by a running Firefox), dedupes icon
blobs by SHA-1, rasterizes each to the same 32x32 center-fit RGBA sample the
favicon-contrast helper produces, and writes a manifest the lab scores.

Outputs into --out:
  icons/<sha>.<ext>   original blob (embedded in the report)
  raw/<sha>.rgba      32*32*4 bytes, alpha-premultiplied-ready sample
  manifest.jsonl      {"sha","kind","icon_url","pages"}
"""

import argparse
import concurrent.futures
import hashlib
import io
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

SAMPLE = 32


def sniff(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"\x00\x00\x01\x00":
        return "ico"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"GIF8":
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    head = data[:512].lstrip().lower()
    if head.startswith(b"<svg") or head.startswith(b"<?xml") or b"<svg" in head:
        return "svg"
    return "bin"


def fit_sample(im):
    """Center-fit into SAMPLE x SAMPLE on transparency, like drawImage."""
    from PIL import Image

    im = im.convert("RGBA")
    scale = min(SAMPLE / im.width, SAMPLE / im.height)
    w = max(1, round(im.width * scale))
    h = max(1, round(im.height * scale))
    if (w, h) != im.size:
        im = im.resize((w, h), Image.LANCZOS)
    canvas = Image.new("RGBA", (SAMPLE, SAMPLE), (0, 0, 0, 0))
    canvas.paste(im, ((SAMPLE - w) // 2, (SAMPLE - h) // 2))
    return canvas.tobytes()


def raster_raster(data: bytes) -> bytes | None:
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    if getattr(im, "is_animated", False):
        im.seek(0)
    sizes = getattr(getattr(im, "ico", None), "sizes", lambda: None)()
    if sizes:
        # ICO: pick the largest embedded frame
        size = max(sizes, key=lambda s: s[0] * s[1])
        im = Image.open(io.BytesIO(data))
        im.size = size
    return fit_sample(im)


def raster_svg(data: bytes, work: Path) -> bytes | None:
    src = work / "icon.svg"
    src.write_bytes(data)
    png = work / "icon.png"
    try:
        subprocess.run(
            ["rsvg-convert", "-w", str(SAMPLE), "-h", str(SAMPLE),
             "-o", str(png), str(src)],
            check=True, capture_output=True, timeout=30,
        )
    except Exception:
        try:
            subprocess.run(
                ["magick", "-background", "none", str(src),
                 "-resize", f"{SAMPLE}x{SAMPLE}",
                 "-gravity", "center", "-extent", f"{SAMPLE}x{SAMPLE}",
                 f"png32:{png}"],
                check=True, capture_output=True, timeout=30,
            )
        except Exception:
            return None
    from PIL import Image

    with Image.open(png) as im:
        return fit_sample(im)


def raster_magick(data: bytes, kind: str, work: Path) -> bytes | None:
    src = work / f"icon.{kind}"
    src.write_bytes(data)
    raw = work / "icon.rgba"
    try:
        subprocess.run(
            ["magick", f"{src}[0]", "-background", "none",
             "-resize", f"{SAMPLE}x{SAMPLE}", "-gravity", "center",
             "-extent", f"{SAMPLE}x{SAMPLE}", "-depth", "8", f"rgba:{raw}"],
            check=True, capture_output=True, timeout=30,
        )
        out = raw.read_bytes()
        return out if len(out) == SAMPLE * SAMPLE * 4 else None
    except Exception:
        return None


def rasterize(entry, corpus: Path):
    sha, kind, data = entry
    work = Path(tempfile.mkdtemp(prefix="favicon-lab-"))
    try:
        if kind == "svg":
            raw = raster_svg(data, work)
        else:
            raw = None
        if raw is None:
            raw = raster_raster(data)
        if raw is None:
            raw = raster_magick(data, kind, work)
        if raw is None:
            return sha, kind, False
        (corpus / "icons" / f"{sha}.{kind}").write_bytes(data)
        (corpus / "raw" / f"{sha}.rgba").write_bytes(raw)
        return sha, kind, True
    except Exception:
        return sha, kind, False
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", help="path to favicons.sqlite (copied first)")
    parser.add_argument("--profile", help="Firefox profile dir to read from")
    parser.add_argument("--out", required=True, help="corpus output dir")
    parser.add_argument("--jobs", type=int, default=8)
    args = parser.parse_args()

    db_path = Path(args.db) if args.db else None
    if db_path is None and args.profile:
        db_path = Path(args.profile) / "favicons.sqlite"
    if db_path is None or not db_path.is_file():
        print("favicons.sqlite not found; pass --db or --profile", file=sys.stderr)
        return 2

    corpus = Path(args.out)
    (corpus / "icons").mkdir(parents=True, exist_ok=True)
    (corpus / "raw").mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    shutil.copyfile(db_path, tmp_path)

    icons: dict[str, dict] = {}
    db = sqlite3.connect(tmp_path)
    for icon_id, icon_url, data in db.execute(
        "SELECT id, icon_url, data FROM moz_icons WHERE data IS NOT NULL"
    ):
        sha = hashlib.sha1(data).hexdigest()
        entry = icons.setdefault(
            sha, {"sha": sha, "icon_url": icon_url, "data": data, "pages": set()}
        )
        for (page_url,) in db.execute(
            "SELECT p.page_url FROM moz_pages_w_icons p "
            "JOIN moz_icons_to_pages m ON m.page_id = p.id "
            "WHERE m.icon_id = ? LIMIT 3",
            (icon_id,),
        ):
            entry["pages"].add(page_url)
    db.close()
    tmp_path.unlink(missing_ok=True)

    jobs = [(e["sha"], sniff(e["data"]), e["data"]) for e in icons.values()]
    ok = 0
    with concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:
        for sha, kind, success in pool.map(
            lambda e: rasterize(e, corpus), jobs
        ):
            ok += success
            icons[sha]["kind"] = kind
            icons[sha]["ok"] = success

    failed = [e["sha"] for e in icons.values() if not e.get("ok")]
    with (corpus / "manifest.jsonl").open("w") as fh:
        for entry in icons.values():
            if not entry.get("ok"):
                continue
            fh.write(
                json.dumps(
                    {
                        "sha": entry["sha"],
                        "kind": entry["kind"],
                        "icon_url": entry["icon_url"],
                        "pages": sorted(entry["pages"]),
                    }
                )
                + "\n"
            )
    print(f"icons: {len(jobs)}  rasterized: {ok}  failed: {len(failed)}")
    if failed:
        print("failed shas:", ",".join(failed[:10]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
