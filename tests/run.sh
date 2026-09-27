#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

make -C "$PROJECT_DIR" all >/dev/null
export OMAFOX_BIN="$PROJECT_DIR/build/omafox"

bash -n \
  "$PROJECT_DIR/extension/build.sh" \
  "$PROJECT_DIR/packaging/omafox-hook" \
  "$SCRIPT_DIR/command.test.sh" \
  "$SCRIPT_DIR/package.test.sh" \
  "$SCRIPT_DIR/zen-integration.test.sh" \
  "$SCRIPT_DIR/firefox-integration.test.sh" \
  "$SCRIPT_DIR/managed-files.test.sh" \
  "$SCRIPT_DIR/profile-safety.test.sh" \
  "$SCRIPT_DIR/fixtures/bin/omarchy"

shellcheck \
  "$PROJECT_DIR/extension/build.sh" \
  "$PROJECT_DIR/packaging/omafox-hook" \
  "$PROJECT_DIR/scripts/sync-firefox-payload.sh" \
  "$PROJECT_DIR/scripts/check-payload.sh" \
  "$PROJECT_DIR/scripts/check-xpi.sh" \
  "$SCRIPT_DIR/run.sh" \
  "$SCRIPT_DIR/command.test.sh" \
  "$SCRIPT_DIR/package.test.sh" \
  "$SCRIPT_DIR/zen-integration.test.sh" \
  "$SCRIPT_DIR/firefox-integration.test.sh" \
  "$SCRIPT_DIR/managed-files.test.sh" \
  "$SCRIPT_DIR/profile-safety.test.sh" \
  "$SCRIPT_DIR/fixtures/bin/omarchy"

node --check "$PROJECT_DIR/extension/theme.js"
node --check "$PROJECT_DIR/extension/background.js"
node --check "$PROJECT_DIR/extension/tabglow.js"
node --check "$PROJECT_DIR/extension/wallpaper.js"
node --check "$PROJECT_DIR/extension/popup/popup.js"
node --check "$PROJECT_DIR/extension/newtab/newtab.js"
node --check "$SCRIPT_DIR/native-host.test.js"
node --check "$PROJECT_DIR/chrome/omafox-prefs.js"
node --check - < "$PROJECT_DIR/chrome/omafox.cfg"
for script in "$PROJECT_DIR"/chrome/scripts/*.uc.js; do
  node --check "$script"
done
cc -std=c17 -Wall -Wextra -Wpedantic -Werror -fsyntax-only \
  "$PROJECT_DIR/omarchy/omafox-native-host.c"
cc -std=c17 -Wall -Wextra -Wpedantic -Werror -fsyntax-only \
  -DOMAFOX_VERSION="\"$(cat "$PROJECT_DIR/VERSION")\"" \
  "$PROJECT_DIR/omarchy/omafox.c"

# One version: VERSION, which make compiles in; the PKGBUILD must agree.
version=$(cat "$PROJECT_DIR/VERSION")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "VERSION is not x.y.z: $version" >&2; exit 1; }
pkgver=$(sed -n 's/^pkgver=//p' "$PROJECT_DIR/PKGBUILD")
[[ $pkgver == "$version" ]] \
  || { echo "PKGBUILD pkgver $pkgver != VERSION $version" >&2; exit 1; }

# The packaged payload must stay generated: owned by marker, and never
# resolving chrome-root files (palette, radius, custom*) inside itself.
for entry in userChrome.css userContent.css; do
  payload_entry="$PROJECT_DIR/packaging/firefox/chrome/$entry"
  [[ $(head -n1 "$payload_entry") == '/* OMAFOX FIREFOX BRIDGE MANAGED FILE */' ]]
  if grep -Eq '^@import (url\()?"(omarchy-radius|omafox-palette|omafox-content-palette|customChrome|customContent)\.css"|OMAFOX FIREFOX BRIDGE \*/$' \
      "$payload_entry"; then
    echo "$entry is not a generated payload entrypoint; run make payload" >&2
    exit 1
  fi
done

# Payload provenance, where a theme checkout is at hand (CI clones one;
# OMAFOX_THEME_CHECKOUT, else ../theme beside this repo).
theme_checkout=${OMAFOX_THEME_CHECKOUT:-$PROJECT_DIR/../theme}
if [[ -d $theme_checkout/.git || -f $theme_checkout/.git ]]; then
  "$PROJECT_DIR/scripts/check-payload.sh" "$theme_checkout"
elif [[ -n ${OMAFOX_REQUIRE_PAYLOAD_CHECK:-} ]]; then
  echo "no theme checkout at $theme_checkout for the payload check" >&2
  exit 1
else
  echo "payload check skipped: no theme checkout at $theme_checkout"
fi

# The packaged XPI is the signed build of extension/ as committed.
"$PROJECT_DIR/scripts/check-xpi.sh"

node "$SCRIPT_DIR/theme.test.js"
node "$SCRIPT_DIR/background.test.js"
node "$SCRIPT_DIR/tabglow.test.js"
node "$SCRIPT_DIR/tabglow-race.test.js"
node "$SCRIPT_DIR/wallpaper.test.js"
node "$SCRIPT_DIR/native-host.test.js"
"$SCRIPT_DIR/command.test.sh"
"$SCRIPT_DIR/zen-integration.test.sh"
"$SCRIPT_DIR/firefox-integration.test.sh"
"$SCRIPT_DIR/managed-files.test.sh"
"$SCRIPT_DIR/profile-safety.test.sh"
"$SCRIPT_DIR/package.test.sh"

echo "All Omafox tests passed."
