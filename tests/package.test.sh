#!/bin/bash

set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$TEST_DIR")
TEST_ROOT=$(mktemp -d)
PACKAGE_ROOT="$TEST_ROOT/package"
TEST_HOME="$TEST_ROOT/home"
MOCK_BIN="$TEST_ROOT/bin"
THEME_DIR="$TEST_ROOT/theme"
BUILD_DIR="$TEST_ROOT/build"
SYSTEM_COMMAND="$PACKAGE_ROOT/usr/bin/omafire"
SYSTEM_HOOK_SOURCE="$PACKAGE_ROOT/usr/share/omafire/hooks/omafire"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$TEST_HOME" "$MOCK_BIN" "$THEME_DIR"
install -m 755 "$TEST_DIR/fixtures/bin/omarchy" "$MOCK_BIN/omarchy"
cp "$TEST_DIR/fixtures/colors.toml" "$THEME_DIR/colors.toml"
printf '%s\n' 'osaka-jade' > "$THEME_DIR/theme.name"

make -C "$PROJECT_DIR" BUILD_DIR="$BUILD_DIR" all >/dev/null
make -C "$PROJECT_DIR" \
  BUILD_DIR="$BUILD_DIR" \
  DESTDIR="$PACKAGE_ROOT" \
  PREFIX=/usr \
  install >/dev/null

[[ -x $SYSTEM_COMMAND ]]
[[ -x $SYSTEM_HOOK_SOURCE ]]
# No add-on, native host or messaging manifest: the chrome scripts do it all.
[[ ! -e "$PACKAGE_ROOT/usr/lib/omafire" ]]
[[ ! -e "$PACKAGE_ROOT/usr/lib/mozilla" ]]
[[ -z $(find "$PACKAGE_ROOT" -name '*.xpi') ]]
[[ ! -e "$PACKAGE_ROOT/usr/share/omafire/zen" ]]
[[ -f "$PACKAGE_ROOT/usr/share/omafire/firefox/chrome/userChrome.css" ]]
[[ -f "$PACKAGE_ROOT/usr/share/doc/omafire/README.md" ]]
[[ -f "$PACKAGE_ROOT/usr/share/licenses/omafire/LICENSE" ]]
[[ -f "$PACKAGE_ROOT/usr/share/licenses/omafire/THIRD_PARTY_NOTICES.md" ]]
[[ $($SYSTEM_COMMAND version) == "$(cat "$PROJECT_DIR/VERSION")" ]]
# omafox's name forwards to omafire (the old theme hook calls it).
grep -Fqx 'exec /usr/bin/omafire "$@"' "$PACKAGE_ROOT/usr/bin/omafox"

# The chrome script loader: autoconfig names omafire.cfg, whose first line
# Firefox skips, and every script it lists ships beside it.
FIREFOX_DIR="$PACKAGE_ROOT/usr/lib/firefox"
grep -Fqx 'pref("general.config.filename", "omafire.cfg");' \
  "$FIREFOX_DIR/defaults/pref/omafire-prefs.js"
[[ $(head -c2 "$FIREFOX_DIR/omafire.cfg") == '//' ]]
read -ra scripts < <(sed -nE 's/^ *const SCRIPTS = \[(.*)\];/\1/p' "$FIREFOX_DIR/omafire.cfg" | tr -d '",')
[[ ${#scripts[@]} -gt 0 ]]
for name in "${scripts[@]}"; do
  [[ -f "$FIREFOX_DIR/omafire/$name.uc.js" ]]
done
[[ $(find "$FIREFOX_DIR/omafire" -name '*.uc.js' | wc -l) -eq ${#scripts[@]} ]]
# The Omarchy shell plugin, byte for byte.
diff -r "$PROJECT_DIR/shell/omafire" "$PACKAGE_ROOT/usr/share/omafire/shell/omafire"

# The settings module the loader starts, with the CLI's schema beside it.
grep -Fq 'resource://omafire/config.sys.mjs' "$FIREFOX_DIR/omafire.cfg"
cmp "$PROJECT_DIR/chrome/config.sys.mjs" "$FIREFOX_DIR/omafire/config.sys.mjs"
cmp "$PROJECT_DIR/chrome/pseudo-state.sys.mjs" "$FIREFOX_DIR/omafire/pseudo-state.sys.mjs"
cmp "$PROJECT_DIR/chrome/site-scheme.sys.mjs" "$FIREFOX_DIR/omafire/site-scheme.sys.mjs"
# The new tab page, served as chrome://omafire/ by the manifest beside it.
cmp "$PROJECT_DIR/chrome/chrome.manifest" "$FIREFOX_DIR/omafire/chrome.manifest"
diff -r "$PROJECT_DIR/chrome/newtab" "$FIREFOX_DIR/omafire/newtab"
cmp "$PROJECT_DIR/config/schema.json" "$FIREFOX_DIR/omafire/config-schema.json"

export HOME="$TEST_HOME"
# Settings follow XDG_CONFIG_HOME; never the caller's.
unset XDG_CONFIG_HOME OMAFIRE_CONFIG
# Nor the host's installed shell plugin.
export OMAFIRE_SHELL_PLUGIN_SOURCE="$HOME/no-shell-plugin"
export PATH="$MOCK_BIN:$PATH"
export OMAFIRE_HOOK_SOURCE="$SYSTEM_HOOK_SOURCE"
export OMAFIRE_THEME_DIR="$THEME_DIR"
export OMAFIRE_THEME_NAME_FILE="$THEME_DIR/theme.name"

# A Zen profile: omafire no longer supports Zen and must leave it alone.
ZEN_PROFILE="$TEST_HOME/.config/zen/Profiles/default-release"
mkdir -p "$ZEN_PROFILE"
printf '%s\n' \
  '[Profile0]' \
  'Name=default-release' \
  'IsRelative=1' \
  'Path=Profiles/default-release' > "$TEST_HOME/.config/zen/profiles.ini"

# No Firefox profile yet: setup still installs the hook, then says so and
# fails rather than report a theme it never applied.
if setup_error=$("$SYSTEM_COMMAND" setup 2>&1 >/dev/null); then
  echo "setup without a Firefox profile unexpectedly succeeded" >&2
  exit 1
fi
[[ $setup_error == *"no Firefox profile found ($TEST_HOME/.config/mozilla/firefox/profiles.ini)"* ]]
USER_HOOK="$TEST_HOME/.config/omarchy/hooks/theme-set.d/omafire"
STATE_FILE="$TEST_HOME/.local/state/omafire/theme.json"
[[ -x $USER_HOOK ]]
cmp "$SYSTEM_HOOK_SOURCE" "$USER_HOOK"
[[ -f $STATE_FILE ]]
[[ -z $(ls -A "$ZEN_PROFILE") ]]
python3 - "$STATE_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    message = json.load(source)

assert message["protocol"] == "omafox"
assert message["version"] == 1
assert message["action"] == "theme-set"
assert message["theme"] == "osaka-jade"
assert message["palette"]["mode"] == "dark"
PY
status_output=$("$SYSTEM_COMMAND" status)
[[ $status_output != *"Native host"* ]]
[[ $status_output != *Zen* ]]

"$SYSTEM_COMMAND" remove >/dev/null
[[ ! -e $USER_HOOK ]]
[[ ! -e $STATE_FILE ]]
[[ -z $(ls -A "$ZEN_PROFILE") ]]
[[ ! -d "$TEST_HOME/.local/state/omafire" ]]
[[ -x $SYSTEM_COMMAND ]]

echo "package.test.sh: ok"
