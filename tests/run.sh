#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

make -C "$PROJECT_DIR" all >/dev/null
export OMAFIRE_BIN="$PROJECT_DIR/build/omafire"

bash -n \
  "$PROJECT_DIR/extension/build.sh" \
  "$PROJECT_DIR/packaging/omafire-hook" \
  "$SCRIPT_DIR/command.test.sh" \
  "$SCRIPT_DIR/package.test.sh" \
  "$SCRIPT_DIR/zen-integration.test.sh" \
  "$SCRIPT_DIR/firefox-integration.test.sh" \
  "$SCRIPT_DIR/managed-files.test.sh" \
  "$SCRIPT_DIR/profile-safety.test.sh" \
  "$SCRIPT_DIR/upgrade.test.sh" \
  "$SCRIPT_DIR/settings.test.sh" \
  "$PROJECT_DIR/packaging/omafox-shim" \
  "$SCRIPT_DIR/fixtures/bin/omarchy"

shellcheck \
  "$PROJECT_DIR/extension/build.sh" \
  "$PROJECT_DIR/packaging/omafire-hook" \
  "$PROJECT_DIR/scripts/build-payload.sh" \
  "$PROJECT_DIR/scripts/check-xpi.sh" \
  "$SCRIPT_DIR/run.sh" \
  "$SCRIPT_DIR/command.test.sh" \
  "$SCRIPT_DIR/package.test.sh" \
  "$SCRIPT_DIR/zen-integration.test.sh" \
  "$SCRIPT_DIR/firefox-integration.test.sh" \
  "$SCRIPT_DIR/managed-files.test.sh" \
  "$SCRIPT_DIR/profile-safety.test.sh" \
  "$SCRIPT_DIR/upgrade.test.sh" \
  "$SCRIPT_DIR/settings.test.sh" \
  "$PROJECT_DIR/packaging/omafox-shim" \
  "$SCRIPT_DIR/fixtures/bin/omarchy"

node --check "$PROJECT_DIR/extension/theme.js"
node --check "$PROJECT_DIR/extension/background.js"
node --check "$PROJECT_DIR/extension/tabglow.js"
node --check "$PROJECT_DIR/extension/wallpaper.js"
node --check "$PROJECT_DIR/extension/popup/popup.js"
node --check "$PROJECT_DIR/extension/newtab/newtab.js"
node --check "$SCRIPT_DIR/native-host.test.js"
node --check "$PROJECT_DIR/shell/omafire/Model.js"
node --check "$PROJECT_DIR/chrome/omafire-prefs.js"
node --check - < "$PROJECT_DIR/chrome/omafire.cfg"
node --check "$PROJECT_DIR/chrome/config.sys.mjs"
for script in "$PROJECT_DIR"/chrome/scripts/*.uc.js; do
  node --check "$script"
done
unformatted=$(cd "$PROJECT_DIR" && gofmt -l cmd config)
[[ -z $unformatted ]] || { echo "gofmt needed: $unformatted" >&2; exit 1; }
(cd "$PROJECT_DIR" && go vet ./... && go test ./...)

# One version: VERSION, which make links in; the PKGBUILD must agree.
version=$(cat "$PROJECT_DIR/VERSION")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "VERSION is not x.y.z: $version" >&2; exit 1; }
pkgver=$(sed -n 's/^pkgver=//p' "$PROJECT_DIR/PKGBUILD")
[[ $pkgver == "$version" ]] \
  || { echo "PKGBUILD pkgver $pkgver != VERSION $version" >&2; exit 1; }
plugin_version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$PROJECT_DIR/shell/omafire/manifest.json")
[[ $plugin_version == "$version" ]] \
  || { echo "shell plugin version $plugin_version != VERSION $version" >&2; exit 1; }

# The built payload: owned by marker, and never resolving chrome-root files
# (palette, radius, custom*) inside itself.
for entry in userChrome.css userContent.css; do
  payload_entry="$PROJECT_DIR/build/firefox/chrome/$entry"
  [[ $(head -n1 "$payload_entry") == '/* OMAFIRE FIREFOX BRIDGE MANAGED FILE */' ]]
  if grep -Eq '^@import (url\()?"(omafire-radius|omafire-palette|omafire-content-palette|customChrome|customContent)\.css"|OMAFIRE FIREFOX BRIDGE \*/$' \
      "$payload_entry"; then
    echo "$entry is not a generated payload entrypoint" >&2
    exit 1
  fi
done

# The theme's own rules: !important everywhere, colours only in token files.
node "$PROJECT_DIR/theme/scripts/lint.mjs"

# The packaged XPI is the signed build of extension/ as committed.
"$PROJECT_DIR/scripts/check-xpi.sh"

node "$SCRIPT_DIR/theme.test.js"
node "$SCRIPT_DIR/background.test.js"
node "$SCRIPT_DIR/tabglow.test.js"
node "$SCRIPT_DIR/tabglow-race.test.js"
node "$SCRIPT_DIR/config-bridge.test.js"
node "$SCRIPT_DIR/wallpaper.test.js"
node "$SCRIPT_DIR/native-host.test.js"
node "$SCRIPT_DIR/shell-plugin.test.js"
"$SCRIPT_DIR/command.test.sh"
"$SCRIPT_DIR/zen-integration.test.sh"
"$SCRIPT_DIR/firefox-integration.test.sh"
"$SCRIPT_DIR/managed-files.test.sh"
"$SCRIPT_DIR/profile-safety.test.sh"
"$SCRIPT_DIR/upgrade.test.sh"
"$SCRIPT_DIR/settings.test.sh"
"$SCRIPT_DIR/package.test.sh"

echo "All Omafire tests passed."
