#!/usr/bin/env bash
# audit-native-skin.sh — diff our maintained layers against the installed
# Firefox's native skin.
#
#   update   Regenerate tests/native-skin-baseline.txt from the installed
#            omni.ja. Run once per supported Firefox version bump, after
#            reviewing what `check` reports.
#   check    Compare live omni.ja against the baseline: new visual tokens =
#            new skin surface to theme; vanished tokens/selectors = our
#            rules may have gone dead. Exits non-zero on drift.
#
# Baseline file sections:
#   [TOKENS]     every visual custom property the native skin defines
#   [SELECTORS]  selectors our CSS uses that resolve in native skin/markup
set -euo pipefail

MODE="${1:-check}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$HERE/tests/native-skin-baseline.txt"

# Firefox splits chrome across two jars: the toolkit/global skin lives in
# omni.ja, the browser skin in browser/omni.ja. Read both.
OMNIS=()
for cand in ${FIREFOX_OMNI:+"$FIREFOX_OMNI"} /usr/lib/firefox/omni.ja \
            /usr/lib/firefox/browser/omni.ja; do
    [ -n "$cand" ] && [ -f "$cand" ] && OMNIS+=("$cand")
done
if [ "${#OMNIS[@]}" -eq 0 ]; then
    echo "audit-native-skin: no omni.ja found (set FIREFOX_OMNI); skipping"
    exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
for jar in "${OMNIS[@]}"; do
    unzip -qq -o "$jar" 'chrome/browser/skin/*' 'chrome/toolkit/skin/*' \
        'chrome/browser/content/browser/*.xhtml' -d "$WORK" 2>/dev/null || true
done

python3 - "$MODE" "$HERE" "$BASELINE" "$WORK" <<'PYEOF'
import re, sys
from pathlib import Path

mode, maint, baseline_path, work = sys.argv[1:5]
maint = Path(maint)
work = Path(work)

TOK_DEF = re.compile(r'(--[a-zA-Z][\w-]*)\s*:')
VISUAL = re.compile(
    r'color|background|border|radius|shadow|fill|outline|gradient|icon|'
    r'opacity|separator|selection|highlight|accent', re.I)
# raw palette ramps are inputs, not surfaces
RAMP = re.compile(r'^--color-[a-z]+-(?:desaturated-)?\d+$|^--color-(?:black|white)(?:-alpha-\d+)?$')

skin_dirs = [work / "chrome/browser/skin/classic", work / "chrome/toolkit/skin/classic"]
native_tokens = set()
for d in skin_dirs:
    if not d.is_dir():
        continue
    for f in d.rglob("*.css"):
        try:
            txt = f.read_text(errors="replace")
        except OSError:
            continue
        for t in TOK_DEF.findall(txt):
            if VISUAL.search(t) and not RAMP.match(t):
                native_tokens.add(t)

# selectors our maintained layers rely on (ids, custom-element tags, classes)
SEL_ID = re.compile(r'#([A-Za-z][\w-]*)')
SEL_CLS = re.compile(r'\.([a-zA-Z][\w-]*)')
SEL_TAG = re.compile(r'(?:^|[\s,>+~])([a-z][a-z0-9]*-[a-z0-9-]+)\b')
used_sel = {"id": set(), "cls": set(), "tag": set()}
for f in maint.rglob("*.css"):
    if "omarchy-firefox" in f.parts:
        continue
    try:
        txt = re.sub(r'/\*.*?\*/', '', f.read_text(errors="replace"), flags=re.S)
    except OSError:
        continue
    for m in SEL_ID.finditer(txt):
        used_sel["id"].add(m.group(1))
    for m in SEL_CLS.finditer(txt):
        used_sel["cls"].add(m.group(1))
    for m in SEL_TAG.finditer(txt):
        used_sel["tag"].add(m.group(1))
used_sel["tag"] -= {"user-agent", "proton-root"}  # non-element false positives

# native corpus: skin css + browser markup
corpus = ""
for d in skin_dirs + [work / "chrome/browser/content/browser"]:
    if not d.is_dir():
        continue
    for f in list(d.rglob("*.css")) + list(d.rglob("*.xhtml")):
        try:
            corpus += f.read_text(errors="replace")
        except OSError:
            pass

def sel_present(kind, name):
    if kind == "id":
        return f'id="{name}"' in corpus or f"#{name}" in corpus
    if kind == "cls":
        return re.search(rf'class="[^"]*\b{re.escape(name)}\b', corpus) or \
               f".{name}" in corpus
    return re.search(rf'<{re.escape(name)}[\s>/]', corpus) or \
           re.search(rf'(^|[\s,>+~]){re.escape(name)}[\s,>+~:.\[]', corpus)

alive = {k: sorted(n for n in names if sel_present(k, n))
         for k, names in used_sel.items()}

def render():
    out = ["[TOKENS]"] + sorted(native_tokens) + ["[SELECTORS]"]
    for k in ("id", "cls", "tag"):
        out += [f"{k}:{n}" for n in alive[k]]
    return "\n".join(out) + "\n"

if mode == "update":
    Path(baseline_path).write_text(render())
    n_sel = sum(map(len, alive.values()))
    print(f"wrote {baseline_path}: {len(native_tokens)} tokens, "
          f"{n_sel} live selectors")
    sys.exit(0)

# check mode
base = Path(baseline_path)
if not base.exists():
    print(f"audit-native-skin: no baseline at {base}; run `update` first")
    sys.exit(0)
sections = base.read_text().split("[SELECTORS]")
base_tokens = {l for l in sections[0].splitlines() if l and l != "[TOKENS]"}
base_sels = {l.strip() for l in sections[1].splitlines() if l.strip()}

new_tokens = sorted(native_tokens - base_tokens)
gone_tokens = sorted(base_tokens - native_tokens)
cur_sels = {f"{k}:{n}" for k in ("id", "cls", "tag") for n in alive[k]}
gone_sels = sorted(base_sels - cur_sels)

drift = bool(new_tokens or gone_tokens or gone_sels)
if new_tokens:
    print("NEW visual tokens in this Firefox (new skin surface to theme):")
    for t in new_tokens:
        print(f"  + {t}")
if gone_tokens:
    print("tokens REMOVED upstream (check our overrides aren't dead):")
    for t in gone_tokens:
        print(f"  - {t}")
if gone_sels:
    print("selectors GONE from native skin/markup (our rules may be dead):")
    for s in gone_sels:
        print(f"  ! {s}")
if not drift:
    print("audit-native-skin: no drift vs baseline")
sys.exit(1 if drift else 0)
PYEOF
