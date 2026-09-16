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
  "$SCRIPT_DIR/run.sh" \
  "$SCRIPT_DIR/command.test.sh" \
  "$SCRIPT_DIR/package.test.sh" \
  "$SCRIPT_DIR/zen-integration.test.sh" \
  "$SCRIPT_DIR/firefox-integration.test.sh" \
  "$SCRIPT_DIR/fixtures/bin/omarchy"

node --check "$PROJECT_DIR/extension/theme.js"
node --check "$PROJECT_DIR/extension/features.js"
node --check "$PROJECT_DIR/extension/background.js"
node --check "$PROJECT_DIR/extension/popup/popup.js"
node --check "$SCRIPT_DIR/native-host.test.js"
cc -std=c17 -Wall -Wextra -Wpedantic -Werror -fsyntax-only \
  "$PROJECT_DIR/omarchy/omafox-native-host.c"
cc -std=c17 -Wall -Wextra -Wpedantic -Werror -fsyntax-only \
  "$PROJECT_DIR/omarchy/omafox.c"

node "$SCRIPT_DIR/theme.test.js"
node "$SCRIPT_DIR/background.test.js"
node "$SCRIPT_DIR/native-host.test.js"
"$SCRIPT_DIR/command.test.sh"
"$SCRIPT_DIR/zen-integration.test.sh"
"$SCRIPT_DIR/firefox-integration.test.sh"
"$SCRIPT_DIR/package.test.sh"

echo "All Omafox tests passed."
