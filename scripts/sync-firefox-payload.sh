#!/bin/bash
# Regenerate packaging/firefox/chrome from a committed Omarchy Chrome
# revision. The payload is installed to <profile>/chrome/omarchy-firefox/, one
# level below the files omafox and the user generate in chrome/, so its
# entrypoints are derived from the theme's rather than copied:
#   - the first line is the ownership marker omafox checks before touching it,
#   - OMAFOX bridge blocks (present when the theme checkout is itself a live
#     profile's chrome/) are dropped,
#   - imports of generated or user-owned files resolve against chrome/ (../).
#
# Usage: scripts/sync-firefox-payload.sh [theme-dir] [rev]
#   theme-dir  Omarchy Chrome checkout (default: ../theme beside this repo)
#   rev        committed revision to package (default: HEAD)

set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
THEME_DIR=${1:-$PROJECT_DIR/../theme}
REV=${2:-HEAD}
DEST="$PROJECT_DIR/packaging/firefox/chrome"

MARKER='/* OMAFOX FIREFOX BRIDGE MANAGED FILE */'
# Files that live in the profile's chrome/, never inside the payload.
CHROME_ROOT_FILES='omarchy-radius\.css|omafox-palette\.css|omafox-content-palette\.css|customChrome\.css|customContent\.css'

git -C "$THEME_DIR" rev-parse --verify --quiet "$REV^{commit}" >/dev/null \
  || { echo "not a commit in $THEME_DIR: $REV" >&2; exit 1; }
sha=$(git -C "$THEME_DIR" rev-parse --short=12 "$REV^{commit}")
# Everything the entrypoints import.
PAYLOAD_DIRS=(src)

if [[ $REV == HEAD ]] && ! git -C "$THEME_DIR" diff --quiet HEAD -- \
    userChrome.css userContent.css "${PAYLOAD_DIRS[@]}"; then
  echo "note: $THEME_DIR has uncommitted changes; packaging $sha only" >&2
fi

git -C "$THEME_DIR" cat-file -e "$REV:src/tokens.css" 2>/dev/null \
  || { echo "$REV is not an Omarchy Chrome (Nova) revision: no src/tokens.css" >&2; exit 1; }

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
git -C "$THEME_DIR" archive "$REV" "${PAYLOAD_DIRS[@]}" | tar -x -C "$stage"

entrypoint() {
  {
    printf '%s\n' "$MARKER"
    printf '/* Generated from Omarchy Chrome %s by omafox scripts/%s. */\n' \
      "$sha" "$(basename "$0")"
    git -C "$THEME_DIR" show "$REV:$1" \
      | sed -e '\|^/\* BEGIN OMAFOX FIREFOX BRIDGE \*/$|,\|^/\* END OMAFOX FIREFOX BRIDGE \*/$|d' \
            -E -e "s#^(@import (url\\()?\")(${CHROME_ROOT_FILES})\"#\\1../\\3\"#"
  } > "$stage/$1"
  if grep -Eq "^@import (url\\()?\"(${CHROME_ROOT_FILES})\"" "$stage/$1"; then
    echo "unrewritten chrome-root import in $1" >&2
    exit 1
  fi
}
entrypoint userChrome.css
entrypoint userContent.css

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -a "$stage" "$DEST"
chmod 755 "$DEST"
echo "Packaged Omarchy Chrome $sha into ${DEST#"$PROJECT_DIR"/}"
