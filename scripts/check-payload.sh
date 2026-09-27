#!/bin/bash
# Prove the committed Firefox payload is exactly what the Omarchy Chrome
# revision stamped in it generates, and that the revision is on the theme's
# main branch (the one its CI gates).
#
# Usage: scripts/check-payload.sh [theme-dir]   (default: ../theme)

set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
THEME_DIR=${1:-$PROJECT_DIR/../theme}
PAYLOAD="$PROJECT_DIR/packaging/firefox/chrome"

sha=$(sed -nE '2s#^/\* Generated from Omarchy Chrome ([0-9a-f]{12}) by .*#\1#p' "$PAYLOAD/userChrome.css")
[[ -n $sha ]] || { echo "payload has no Omarchy Chrome stamp" >&2; exit 1; }

git -C "$THEME_DIR" rev-parse --verify --quiet "$sha^{commit}" >/dev/null \
  || { echo "theme revision $sha is not in $THEME_DIR" >&2; exit 1; }
main=$(git -C "$THEME_DIR" rev-parse --verify --quiet refs/remotes/origin/main \
  || git -C "$THEME_DIR" rev-parse --verify --quiet refs/remotes/forgejo/main \
  || git -C "$THEME_DIR" rev-parse --verify refs/heads/main)
git -C "$THEME_DIR" merge-base --is-ancestor "$sha" "$main" \
  || { echo "theme revision $sha is not on main" >&2; exit 1; }

regen=$(mktemp -d)
trap 'rm -rf "$regen"' EXIT
PAYLOAD_DEST="$regen/chrome" "$PROJECT_DIR/scripts/sync-firefox-payload.sh" "$THEME_DIR" "$sha" 2>/dev/null
diff -r "$regen/chrome" "$PAYLOAD" >&2 \
  || { echo "payload differs from Omarchy Chrome $sha; run make payload" >&2; exit 1; }
echo "payload: Omarchy Chrome $sha, on main, regenerates identically"
