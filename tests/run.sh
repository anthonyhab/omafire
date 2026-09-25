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
  "$SCRIPT_DIR/fixtures/bin/omarchy"

shellcheck \
  "$PROJECT_DIR/extension/build.sh" \
  "$PROJECT_DIR/packaging/omafox-hook" \
  "$PROJECT_DIR/scripts/sync-firefox-payload.sh" \
  "$SCRIPT_DIR/run.sh" \
  "$SCRIPT_DIR/command.test.sh" \
  "$SCRIPT_DIR/package.test.sh" \
  "$SCRIPT_DIR/zen-integration.test.sh" \
  "$SCRIPT_DIR/firefox-integration.test.sh" \
  "$SCRIPT_DIR/fixtures/bin/omarchy"

node --check "$PROJECT_DIR/extension/theme.js"
node --check "$PROJECT_DIR/extension/background.js"
node --check "$PROJECT_DIR/extension/tabglow.js"
node --check "$PROJECT_DIR/extension/popup/popup.js"
node --check "$PROJECT_DIR/extension/newtab/newtab.js"
node --check "$SCRIPT_DIR/native-host.test.js"
cc -std=c17 -Wall -Wextra -Wpedantic -Werror -fsyntax-only \
  "$PROJECT_DIR/omarchy/omafox-native-host.c"
cc -std=c17 -Wall -Wextra -Wpedantic -Werror -fsyntax-only \
  "$PROJECT_DIR/omarchy/omafox.c"

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

node "$SCRIPT_DIR/theme.test.js"
node "$SCRIPT_DIR/background.test.js"
node "$SCRIPT_DIR/tabglow.test.js"
node "$SCRIPT_DIR/native-host.test.js"
"$SCRIPT_DIR/command.test.sh"
"$SCRIPT_DIR/zen-integration.test.sh"
"$SCRIPT_DIR/firefox-integration.test.sh"
"$SCRIPT_DIR/package.test.sh"

echo "All Omafox tests passed."
