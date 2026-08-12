#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

bash -n \
    scripts/autothemer.sh \
    scripts/check-omarchy.sh \
    scripts/generate-omarchy-radius.sh \
    scripts/generate-pkgbuild.sh \
    scripts/install-favicon-contrast.sh \
    scripts/rebase-branches.sh \
    tests/autothemer.sh \
    tests/generate-omarchy-radius.sh \
    tests/install-favicon-contrast.sh

if command -v shellcheck >/dev/null 2>&1; then
    shellcheck \
        scripts/autothemer.sh \
        scripts/check-omarchy.sh \
        scripts/generate-omarchy-radius.sh \
        scripts/generate-pkgbuild.sh \
        scripts/install-favicon-contrast.sh \
        scripts/rebase-branches.sh \
        tests/autothemer.sh \
        tests/generate-omarchy-radius.sh \
        tests/install-favicon-contrast.sh
fi

if command -v node >/dev/null 2>&1; then
    node --check favicon-contrast.uc.js
    node --check configuration/autoconfig.js
    node --check tests/favicon-contrast-core.js
    node --check < configuration/mozilla.cfg
    node tests/favicon-contrast-core.js
fi

python3 - <<'PY'
import re
import subprocess
from pathlib import Path
from xml.etree import ElementTree

root = Path.cwd()

for svg in sorted((root / "theme/icons/custom").glob("*.svg")):
    ElementTree.parse(svg)

optional_imports = {
    "customChrome.css",
    "customContent.css",
    "generated-gtk-colors.css",
    "omarchy-radius.css",
}
for entrypoint in (root / "userChrome.css", root / "userContent.css"):
    text = entrypoint.read_text()
    for imported in re.findall(r'@import\s+["\']([^"\']+)["\']', text):
        target = entrypoint.parent / imported
        if not target.is_file() and target.name not in optional_imports:
            raise SystemExit(f"missing import: {entrypoint.name} -> {imported}")

chrome = (root / "omarchy-chrome.css").read_text()
content = (root / "omarchy-content.css").read_text()
for snippet in (
    'tab-split-view-wrapper:not([dragtarget])',
    'margin-inline-start: auto !important',
):
    if snippet not in chrome:
        raise SystemExit(f"missing chrome compatibility guard: {snippet}")
if "~ #alltabs-button" in chrome:
    raise SystemExit("omarchy-chrome.css must leave all-tabs visibility to preference gates")
if ':root[dir="rtl"] sidebar-tab-row[selected]' not in content:
    raise SystemExit("missing RTL selected-sidebar edge")


def check_css(path: Path) -> None:
    text = path.read_text()
    depth = 0
    quote = None
    escaped = False
    index = 0
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif char == "/" and following == "*":
            end = text.find("*/", index + 2)
            if end < 0:
                raise SystemExit(f"unterminated CSS comment: {path}")
            index = end + 1
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                raise SystemExit(f"extra closing brace: {path}")
        index += 1
    if quote or depth:
        raise SystemExit(f"unbalanced CSS: {path} (depth={depth})")


for css in (
    root / "omarchy-chrome.css",
    root / "omarchy-content.css",
    root / "omarchy-features.css",
    root / "theme/parts/extension-icons.css",
    root / "userChrome.css",
    root / "userContent.css",
):
    check_css(css)

required = (
    root / "THIRD_PARTY.md",
    root / "LICENSES/CC0-1.0.md",
    root / "LICENSES/MPL-2.0.txt",
)
for path in required:
    if not path.is_file():
        raise SystemExit(f"missing notice/license: {path.relative_to(root)}")

# The 2026-08-12 rebrand retired the --gnome-*/gnomeTheme.* naming in favor
# of --omarchy-base-*/omarchyTheme.*. Fail if either stale prefix resurfaces
# anywhere in the tracked tree, so a partial future edit (a copy-pasted rule,
# a reverted hunk) can't silently reintroduce it undetected.
allowed_stale_refs = {
    # Handoff doc: documents the old names as historical inventory on purpose.
    "docs/rebrand-and-restructure-plan.md",
    # This script: has to name the retired strings to check for them.
    "scripts/check-omarchy.sh",
}
tracked = subprocess.run(
    ["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True, text=True
).stdout.split("\0")
for relative_path in tracked:
    if not relative_path or relative_path in allowed_stale_refs:
        continue
    path = root / relative_path
    if not path.is_file():
        continue
    try:
        text = path.read_text()
    except (UnicodeDecodeError, OSError):
        continue
    if "--gnome-" in text or "gnomeTheme." in text:
        raise SystemExit(f"stale pre-rebrand naming found in {relative_path}")

print("Omarchy static checks passed")
PY

tests/autothemer.sh
tests/generate-omarchy-radius.sh
tests/install-favicon-contrast.sh

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git diff --check
fi
