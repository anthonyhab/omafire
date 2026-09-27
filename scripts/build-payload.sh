#!/bin/bash
# Build the Firefox payload from theme/ in this repository. The payload is
# installed to <profile>/chrome/omarchy-firefox/, one level below the files
# omafox and the user generate in chrome/, so its entrypoints are derived
# from the theme's rather than copied:
#   - the first line is the ownership marker omafox checks before touching it,
#   - OMAFOX bridge blocks (present when the theme is itself a live
#     profile's chrome/) are dropped,
#   - imports of generated or user-owned files resolve against chrome/ (../).
#
# Usage: scripts/build-payload.sh DEST

set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
THEME_DIR="$PROJECT_DIR/theme"
DEST=${1:?usage: scripts/build-payload.sh DEST}

MARKER='/* OMAFOX FIREFOX BRIDGE MANAGED FILE */'
# Files that live in the profile's chrome/, never inside the payload.
CHROME_ROOT_FILES='omarchy-radius\.css|omafox-palette\.css|omafox-content-palette\.css|customChrome\.css|customContent\.css'

[[ -f $THEME_DIR/src/tokens.css ]] \
  || { echo "no theme at $THEME_DIR (src/tokens.css missing)" >&2; exit 1; }

# The stamp names what was built: the version, and the commit when there is one.
stamp="omafox $(cat "$PROJECT_DIR/VERSION")"
if rev=$(git -C "$PROJECT_DIR" rev-parse --short=12 HEAD 2>/dev/null); then
  stamp+=" ($rev"
  git -C "$PROJECT_DIR" diff --quiet HEAD -- theme/userChrome.css theme/userContent.css theme/src \
    || stamp+=", modified"
  stamp+=")"
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
# Only committed-shape files: src/ as it is, without the generated ones a
# live checkout keeps beside the entrypoints.
cp -a "$THEME_DIR/src" "$stage/src"

entrypoint() {
  {
    printf '%s\n' "$MARKER"
    printf '/* Generated from the theme in %s by scripts/%s. */\n' \
      "$stamp" "$(basename "$0")"
    sed -e '\|^/\* BEGIN OMAFOX FIREFOX BRIDGE \*/$|,\|^/\* END OMAFOX FIREFOX BRIDGE \*/$|d' \
        -E -e "s#^(@import (url\\()?\")(${CHROME_ROOT_FILES})\"#\\1../\\3\"#" \
        "$THEME_DIR/$1"
  } > "$stage/$1"
  if grep -Eq "^@import (url\\()?\"(${CHROME_ROOT_FILES})\"" "$stage/$1"; then
    echo "unrewritten chrome-root import in $1" >&2
    exit 1
  fi
}
entrypoint userChrome.css
entrypoint userContent.css

find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -a "$stage" "$DEST"
echo "Built the Firefox payload from $stamp into $DEST" >&2
