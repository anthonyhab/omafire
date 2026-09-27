#!/bin/bash
# Managed-block edge cases in users' own profile files: a file without a
# trailing newline, and one too large to read. Neither may be damaged.

set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$TEST_DIR")
TEST_ROOT=$(mktemp -d)
TEST_HOME="$TEST_ROOT/home"
MOCK_BIN="$TEST_ROOT/bin"
THEME_DIR="$TEST_ROOT/theme"
FF_ROOT="$TEST_HOME/.mozilla/firefox"
PAYLOAD="$TEST_ROOT/payload"
UNTERMINATED="$FF_ROOT/profiles/unterminated"
OVERSIZED="$FF_ROOT/profiles/oversized"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

RUN=("${OMAFIRE_BIN:-$PROJECT_DIR/build/omafire}")

mkdir -p "$MOCK_BIN" "$THEME_DIR" "$PAYLOAD" "$UNTERMINATED" "$TEST_ROOT/host"
install -m 755 "$TEST_DIR/fixtures/bin/omarchy" "$MOCK_BIN/omarchy"
printf '#!/bin/sh\nexit 1\n' > "$MOCK_BIN/hyprctl"
chmod 755 "$MOCK_BIN/hyprctl"
cp "$TEST_DIR/fixtures/colors.toml" "$THEME_DIR/colors.toml"
printf '%s\n' 'osaka-jade' > "$THEME_DIR/theme.name"
printf '%s\n' '/* OMAFIRE FIREFOX BRIDGE MANAGED FILE */' > "$PAYLOAD/userChrome.css"
printf '%s\n' '/* payload content */' > "$PAYLOAD/userContent.css"
install -m 755 /dev/null "$TEST_ROOT/host/omafire-native-host"
install -m 644 "$PROJECT_DIR/packaging/org.omarchy.omafox.json" "$TEST_ROOT/host/manifest.json"
install -m 755 "$PROJECT_DIR/packaging/omafire-hook" "$TEST_ROOT/host/hook"

export HOME="$TEST_HOME"
export PATH="$MOCK_BIN:$PATH"
export OMAFIRE_THEME_DIR="$THEME_DIR"
export OMAFIRE_THEME_NAME_FILE="$THEME_DIR/theme.name"
export OMAFIRE_NATIVE_HOST_PATH="$TEST_ROOT/host/omafire-native-host"
export OMAFIRE_NATIVE_MANIFEST_PATH="$TEST_ROOT/host/manifest.json"
export OMAFIRE_HOOK_SOURCE="$TEST_ROOT/host/hook"
export OMAFIRE_FIREFOX_ROOT="$FF_ROOT"
export OMAFIRE_FIREFOX_PAYLOAD_SOURCE="$PAYLOAD"
export OMAFIRE_ZEN_PROFILES_FILE="$TEST_ROOT/missing-zen-profiles.ini"

profiles() {
  local index=0
  : > "$FF_ROOT/profiles.ini"
  for name in "$@"; do
    printf '[Profile%d]\nName=%s\nIsRelative=1\nPath=profiles/%s\n\n' \
      "$index" "$name" "$name" >> "$FF_ROOT/profiles.ini"
    index=$((index + 1))
  done
}

# A user.js whose last line has no newline keeps that line.
printf 'user_pref("fixture.last", true);' > "$UNTERMINATED/user.js"
profiles unterminated
"${RUN[@]}" setup >/dev/null
grep -Fxq 'user_pref("fixture.last", true);' "$UNTERMINATED/user.js"
grep -Fq 'toolkit.legacyUserProfileCustomizations.stylesheets' "$UNTERMINATED/user.js"

# A user.js too large to read is refused, not replaced by the block.
mkdir -p "$OVERSIZED"
python3 - "$OVERSIZED/user.js" <<'PY'
import sys
line = 'user_pref("fixture.filler", "' + "x" * 200 + '");\n'
with open(sys.argv[1], "w", encoding="utf-8") as target:
    target.write(line * (5 * 1024 * 1024 // len(line) + 1))
    target.write('user_pref("fixture.sentinel", true);\n')
PY
cp "$OVERSIZED/user.js" "$TEST_ROOT/oversized-original.js"
profiles oversized
if "${RUN[@]}" setup >"$TEST_ROOT/out" 2>&1; then
  echo "setup accepted an unreadable user.js" >&2
  exit 1
fi
grep -Fq 'refusing to rewrite it' "$TEST_ROOT/out"
cmp "$TEST_ROOT/oversized-original.js" "$OVERSIZED/user.js"

echo "managed-files.test.sh: ok"
