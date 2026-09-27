#!/bin/bash

set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$TEST_DIR")
TEST_ROOT=$(mktemp -d)
OMAFIRE_BIN=${OMAFIRE_BIN:-$(dirname "$TEST_DIR")/build/omafire}
TEST_HOME="$TEST_ROOT/home"
MOCK_BIN="$TEST_ROOT/bin"
THEME_DIR="$TEST_ROOT/theme"
FF_ROOT="$TEST_HOME/.mozilla/firefox"
RELATIVE_PROFILE="$FF_ROOT/profiles/default-release"
ABSOLUTE_PROFILE="$TEST_ROOT/external Firefox profile"
MISSING_PROFILE="$FF_ROOT/profiles/missing"
CHECKOUT_PROFILE="$FF_ROOT/profiles/checkout"
NATIVE_HOST="$TEST_ROOT/package/omafire-native-host"
NATIVE_MANIFEST="$TEST_ROOT/package/org.omarchy.omafox.json"
HOOK_SOURCE="$TEST_ROOT/package/omafire-hook"
FF_PAYLOAD_SOURCE="$TEST_ROOT/package/firefox-chrome"
FF_BRIDGE_MARKER='/* OMAFIRE FIREFOX BRIDGE MANAGED FILE */'
CSS_BEGIN='/* BEGIN OMAFIRE FIREFOX BRIDGE */'
CSS_END='/* END OMAFIRE FIREFOX BRIDGE */'
PREFS_BEGIN='// BEGIN OMAFIRE FIREFOX BRIDGE'
PREFS_END='// END OMAFIRE FIREFOX BRIDGE'

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

assert_not_contains() {
  local needle=$1 target=$2
  if grep -Fq "$needle" "$target"; then
    echo "unexpected text in $target: $needle" >&2
    exit 1
  fi
}

mkdir -p \
  "$TEST_HOME" "$MOCK_BIN" "$THEME_DIR" "$FF_ROOT/profiles" \
  "$RELATIVE_PROFILE/chrome" "$ABSOLUTE_PROFILE" "$(dirname "$NATIVE_HOST")"
install -m 755 "$TEST_DIR/fixtures/bin/omarchy" "$MOCK_BIN/omarchy"
# Hermetic Hyprland: sync reads decoration:rounding for the radius file.
cat > "$MOCK_BIN/hyprctl" <<'EOF'
#!/bin/sh
case $2 in
  decoration:rounding) echo '{"option":"decoration:rounding","int":9,"set":true}' ;;
  general:border_size) echo '{"option":"general:border_size","int":2,"set":true}' ;;
  general:col.active_border) echo '{"option":"general:col.active_border","gradient":"ffe68e0d 0deg","set":true}' ;;
  general:col.inactive_border) echo '{"option":"general:col.inactive_border","gradient":"aa595959 0deg","set":true}' ;;
  *) exit 1 ;;
esac
EOF
chmod 755 "$MOCK_BIN/hyprctl"
install -m 755 "$PROJECT_DIR/packaging/omafire-hook" "$HOOK_SOURCE"
install -m 755 /dev/null "$NATIVE_HOST"
install -m 644 "$PROJECT_DIR/packaging/org.omarchy.omafox.json" "$NATIVE_MANIFEST"
cp "$TEST_DIR/fixtures/colors.toml" "$THEME_DIR/colors.toml"
printf '%s\n' 'osaka-jade' > "$THEME_DIR/theme.name"

# Minimal packaged payload: entry marker + a managed stylesheet.
mkdir -p "$FF_PAYLOAD_SOURCE/theme"
printf '%s\n%s\n' "$FF_BRIDGE_MARKER" '@import "theme/parts/x.css";' \
  > "$FF_PAYLOAD_SOURCE/userChrome.css"
printf '/* payload content css */\n' > "$FF_PAYLOAD_SOURCE/userContent.css"
printf '/* payload part */\n' > "$FF_PAYLOAD_SOURCE/theme/x.css"

cat > "$FF_ROOT/profiles.ini" <<EOF
[Profile0]
Name=default-release
IsRelative=1
Path=profiles/default-release

[Profile1]
Name=external
IsRelative=0
Path=$ABSOLUTE_PROFILE

[Profile2]
Name=duplicate
IsRelative=1
Path=profiles/default-release

[Profile3]
Name=missing
IsRelative=1
Path=profiles/missing

[Profile4]
Name=checkout
IsRelative=1
Path=profiles/checkout
EOF

# A theme checkout as chrome/ (the development layout), still carrying what
# an earlier release installed into it: a payload copy and import blocks.
mkdir -p "$CHECKOUT_PROFILE/chrome/omafire" "$CHECKOUT_PROFILE/chrome/src"
printf '%s\n' '/* checkout tokens */' > "$CHECKOUT_PROFILE/chrome/src/tokens.css"
printf '%s\n' '@import "omafire-radius.css";' "$CSS_BEGIN" \
  '@import url("omafire/userChrome.css");' '@import url("omafire-palette.css");' \
  "$CSS_END" '@import "src/tokens.css";' \
  > "$CHECKOUT_PROFILE/chrome/userChrome.css"
printf '%s\n' "$CSS_BEGIN" '@import url("omafire/userContent.css");' \
  "$CSS_END" '/* checkout content */' > "$CHECKOUT_PROFILE/chrome/userContent.css"
cp "$FF_PAYLOAD_SOURCE/userChrome.css" "$CHECKOUT_PROFILE/chrome/omafire/"

printf '%s\n' '/* my own chrome rule */' > "$RELATIVE_PROFILE/chrome/userChrome.css"
printf '%s\n' '/* my own content rule */' > "$RELATIVE_PROFILE/chrome/userContent.css"
printf '%s\n' 'user_pref("example.existing", true);' > "$RELATIVE_PROFILE/user.js"
chmod 640 "$RELATIVE_PROFILE/chrome/userChrome.css"
chmod 604 "$RELATIVE_PROFILE/user.js"
cp "$RELATIVE_PROFILE/chrome/userChrome.css" "$TEST_ROOT/original-userChrome.css"
cp "$RELATIVE_PROFILE/chrome/userContent.css" "$TEST_ROOT/original-userContent.css"
cp "$RELATIVE_PROFILE/user.js" "$TEST_ROOT/original-user.js"

export HOME="$TEST_HOME"
# Settings follow XDG_CONFIG_HOME; never the caller's.
unset XDG_CONFIG_HOME OMAFIRE_CONFIG
# Nor the host's installed shell plugin.
export OMAFIRE_SHELL_PLUGIN_SOURCE="$HOME/no-shell-plugin"
export PATH="$MOCK_BIN:$PATH"
export OMAFIRE_THEME_DIR="$THEME_DIR"
export OMAFIRE_THEME_NAME_FILE="$THEME_DIR/theme.name"
export OMAFIRE_NATIVE_HOST_PATH="$NATIVE_HOST"
export OMAFIRE_NATIVE_MANIFEST_PATH="$NATIVE_MANIFEST"
export OMAFIRE_HOOK_SOURCE="$HOOK_SOURCE"
export OMAFIRE_FIREFOX_ROOT="$FF_ROOT"
export OMAFIRE_FIREFOX_PAYLOAD_SOURCE="$FF_PAYLOAD_SOURCE"
export OMAFIRE_ZEN_PROFILES_FILE="$TEST_ROOT/missing-zen-profiles.ini"

# The shell plugin (DEC-30): linked and enabled once by setup.
export OMAFIRE_SHELL_PLUGIN_SOURCE="$TEST_ROOT/share/shell/omafire"
mkdir -p "$OMAFIRE_SHELL_PLUGIN_SOURCE"
PLUGIN_LINK="$TEST_HOME/.config/omarchy/plugins/omafire"
PLUGIN_LOG="$TEST_HOME/omarchy-plugin.log"

initial_status=$("$OMAFIRE_BIN" status)
[[ $initial_status == *"Shell plugin: $PLUGIN_LINK (not linked)"* ]]
[[ $initial_status == *"Firefox profile: $RELATIVE_PROFILE (not configured)"* ]]
[[ $initial_status == *"Firefox profile: $ABSOLUTE_PROFILE (not configured)"* ]]
[[ $initial_status == *"Firefox profile: $MISSING_PROFILE (missing)"* ]]

setup_output=$("$OMAFIRE_BIN" setup 2>&1)
[[ $(grep -Fc "Configured Firefox profile: $RELATIVE_PROFILE" <<< "$setup_output") == 1 ]]
[[ $(grep -Fc "Configured Firefox profile: $ABSOLUTE_PROFILE" <<< "$setup_output") == 1 ]]
[[ $setup_output == *"Skipped missing Firefox profile: $MISSING_PROFILE"* ]]
[[ $setup_output == *"Restart Firefox once"* ]]
[[ $(readlink "$PLUGIN_LINK") == "$OMAFIRE_SHELL_PLUGIN_SOURCE" ]]
[[ $setup_output == *"Enabled it in the bar"* ]]
[[ $(cat "$PLUGIN_LOG") == "plugin enable omafire" ]]
[[ $("$OMAFIRE_BIN" status) == *"Shell plugin: $PLUGIN_LINK (linked)"* ]]
# A second setup leaves it alone: a user who disabled it keeps that.
"$OMAFIRE_BIN" setup >/dev/null 2>&1
[[ $(wc -l < "$PLUGIN_LOG") == 1 ]]

for profile in "$RELATIVE_PROFILE" "$ABSOLUTE_PROFILE"; do
  cmp "$FF_PAYLOAD_SOURCE/userChrome.css" "$profile/chrome/omafire/userChrome.css"
  cmp "$FF_PAYLOAD_SOURCE/theme/x.css" "$profile/chrome/omafire/theme/x.css"
  [[ $(grep -Fxc "$CSS_BEGIN" "$profile/chrome/userChrome.css") == 1 ]]
  [[ $(grep -Fxc "$CSS_END" "$profile/chrome/userChrome.css") == 1 ]]
  [[ $(grep -Fxc '@import url("omafire/userChrome.css");' "$profile/chrome/userChrome.css") == 1 ]]
  [[ $(grep -Fxc '@import url("omafire-palette.css");' "$profile/chrome/userChrome.css") == 1 ]]
  [[ $(grep -Fxc '@import url("omafire/userContent.css");' "$profile/chrome/userContent.css") == 1 ]]
  [[ $(grep -Fxc "$PREFS_BEGIN" "$profile/user.js") == 1 ]]
  [[ $(grep -Fxc "$PREFS_END" "$profile/user.js") == 1 ]]
  [[ $(grep -Fxc 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);' "$profile/user.js") == 1 ]]
  [[ $(sed -n '1p' "$profile/chrome/userChrome.css") == "$CSS_BEGIN" ]]
  # Generated first-paint palette landed via sync.
  grep -Fqx '/* OMAFIRE GENERATED PALETTE — written by omafire sync; do not edit. */' \
    "$profile/chrome/omafire-palette.css"
  grep -Fq -- '--omarchy-background: #111c18;' "$profile/chrome/omafire-palette.css"
  # Cold-start mirror of the lightweight theme, inert once it lands.
  grep -Fqx ':root:not([lwtheme]) {' "$profile/chrome/omafire-palette.css"
  grep -Fq -- '--tabpanel-background-color: #111c18 !important;' \
    "$profile/chrome/omafire-palette.css"
  grep -Fqx '  --omafire-radius-container: 9px;' "$profile/chrome/omafire-radius.css"
  grep -Fqx '  --omarchy-border-width: 2px;' "$profile/chrome/omafire-radius.css"
  grep -Fqx '  --omarchy-border-active-color: #e68e0dff;' "$profile/chrome/omafire-radius.css"
  grep -Fqx '  --omarchy-border-inactive-color: #595959aa;' "$profile/chrome/omafire-radius.css"
  # Native widgets (checkboxes, GTK focus rings) follow Hyprland's border.
  grep -Fqx 'user_pref("ui.accentcolor", "#e68e0d");' "$profile/user.js"
  grep -Fq 'user_pref("ui.accentcolortext", "#' "$profile/user.js"
  grep -Fqx 'user_pref("layout.css.prefers-color-scheme.content-override", 0);' \
    "$profile/user.js"
done

# The checkout keeps its own entrypoints and loses the shadowing payload,
# but still gets the prefs block and a live palette. Its marker pair stays
# where it stood, narrowed to the palette import (older omafire releases
# refresh the palette only while the markers exist).
[[ $(grep -Fc "Configured Firefox profile (theme checkout): $CHECKOUT_PROFILE" <<< "$setup_output") == 1 ]]
[[ ! -e $CHECKOUT_PROFILE/chrome/omafire ]]
printf '%s\n' '@import "omafire-radius.css";' "$CSS_BEGIN" \
  '@import "omafire-palette.css";' "$CSS_END" '@import "src/tokens.css";' \
  | cmp - "$CHECKOUT_PROFILE/chrome/userChrome.css"
cp "$CHECKOUT_PROFILE/chrome/userChrome.css" "$TEST_ROOT/checkout-userChrome.css"
printf '%s\n' '/* checkout content */' | cmp - "$CHECKOUT_PROFILE/chrome/userContent.css"
[[ $(grep -Fxc "$PREFS_BEGIN" "$CHECKOUT_PROFILE/user.js") == 1 ]]
grep -Fq -- '--omarchy-background: #111c18;' "$CHECKOUT_PROFILE/chrome/omafire-palette.css"
grep -Fq -- '--omarchy-background: #111c18;' "$CHECKOUT_PROFILE/chrome/omafire-content-palette.css"
grep -Fqx '  --omafire-radius-container: 9px;' "$CHECKOUT_PROFILE/chrome/omafire-radius.css"

[[ $(stat -c '%a' "$RELATIVE_PROFILE/chrome/userChrome.css") == 640 ]]
[[ $(stat -c '%a' "$RELATIVE_PROFILE/user.js") == 604 ]]
grep -Fqx '/* my own chrome rule */' "$RELATIVE_PROFILE/chrome/userChrome.css"
grep -Fqx '/* my own content rule */' "$RELATIVE_PROFILE/chrome/userContent.css"
grep -Fqx 'user_pref("example.existing", true);' "$RELATIVE_PROFILE/user.js"

configured_status=$("$OMAFIRE_BIN" status)
[[ $configured_status == *"Firefox profile: $RELATIVE_PROFILE (configured)"* ]]
[[ $configured_status == *"Firefox profile: $ABSOLUTE_PROFILE (configured)"* ]]
[[ $configured_status == *"Firefox profile: $CHECKOUT_PROFILE (theme checkout)"* ]]
# Setup is stable on a checkout: a second run leaves the tracked file alone.
"$OMAFIRE_BIN" setup >/dev/null 2>&1
cmp "$TEST_ROOT/checkout-userChrome.css" "$CHECKOUT_PROFILE/chrome/userChrome.css"

# Theme flip regenerates the palette CSS + flips the content override.
cp "$TEST_DIR/fixtures/minimal-colors.toml" "$THEME_DIR/colors.toml"
"$OMAFIRE_BIN" sync
grep -Fq -- '--omarchy-background: #FAFAFA;' "$RELATIVE_PROFILE/chrome/omafire-palette.css"
grep -Fqx 'user_pref("layout.css.prefers-color-scheme.content-override", 1);' \
  "$RELATIVE_PROFILE/user.js"
grep -Fqx '  color-scheme: light !important;' "$RELATIVE_PROFILE/chrome/omafire-palette.css"
grep -Fq -- '--omarchy-background: #FAFAFA;' "$CHECKOUT_PROFILE/chrome/omafire-palette.css"
cp "$TEST_DIR/fixtures/colors.toml" "$THEME_DIR/colors.toml"

# Setup is idempotent and refreshes a stale payload.
"$OMAFIRE_BIN" setup >/dev/null 2>&1
[[ $(grep -Fxc "$CSS_BEGIN" "$RELATIVE_PROFILE/chrome/userChrome.css") == 1 ]]
[[ $(grep -Fxc "$PREFS_BEGIN" "$RELATIVE_PROFILE/user.js") == 1 ]]
printf '%s\n' '/* package update */' >> "$FF_PAYLOAD_SOURCE/userChrome.css"
outdated_status=$("$OMAFIRE_BIN" status)
[[ $outdated_status == *"Firefox profile: $RELATIVE_PROFILE (outdated)"* ]]
"$OMAFIRE_BIN" setup >/dev/null 2>&1
cmp "$FF_PAYLOAD_SOURCE/userChrome.css" "$RELATIVE_PROFILE/chrome/omafire/userChrome.css"

# Removal preflights every profile and refuses to delete an unowned collision.
rm -rf "$ABSOLUTE_PROFILE/chrome/omafire"
mkdir -p "$ABSOLUTE_PROFILE/chrome/omafire"
printf '%s\n' '/* user-owned dir */' > "$ABSOLUTE_PROFILE/chrome/omafire/userChrome.css"
conflict_status=$("$OMAFIRE_BIN" status)
[[ $conflict_status == *"Firefox profile: $ABSOLUTE_PROFILE (conflict)"* ]]
if remove_error=$("$OMAFIRE_BIN" remove 2>&1); then
  echo "remove with an unmanaged Firefox payload unexpectedly succeeded" >&2
  exit 1
fi
[[ $remove_error == *"refusing to modify unmanaged Firefox payload"* ]]
grep -Fqx "$CSS_BEGIN" "$RELATIVE_PROFILE/chrome/userChrome.css"
grep -Fqx '/* user-owned dir */' "$ABSOLUTE_PROFILE/chrome/omafire/userChrome.css"
rm -rf "$ABSOLUTE_PROFILE/chrome/omafire"

"$OMAFIRE_BIN" remove >/dev/null
[[ ! -e $PLUGIN_LINK && ! -L $PLUGIN_LINK ]]
[[ $(tail -n1 "$PLUGIN_LOG") == "plugin disable omafire" ]]
# A plugin of the user's own at that path is never touched.
mkdir -p "$PLUGIN_LINK"
own_output=$("$OMAFIRE_BIN" setup 2>&1)
[[ $own_output == *"Left your own $PLUGIN_LINK alone"* ]]
[[ -d $PLUGIN_LINK && ! -L $PLUGIN_LINK ]]
"$OMAFIRE_BIN" remove >/dev/null
[[ -d $PLUGIN_LINK ]]
rmdir "$PLUGIN_LINK"
for profile in "$RELATIVE_PROFILE" "$ABSOLUTE_PROFILE"; do
  [[ ! -e $profile/chrome/omafire ]]
  [[ ! -e $profile/chrome/omafire-palette.css ]]
  if [[ -f $profile/chrome/userChrome.css ]]; then
    assert_not_contains "$CSS_BEGIN" "$profile/chrome/userChrome.css"
  fi
  if [[ -f $profile/user.js ]]; then
    assert_not_contains "$PREFS_BEGIN" "$profile/user.js"
  fi
done
[[ ! -e $CHECKOUT_PROFILE/chrome/omafire-palette.css ]]
[[ ! -e $CHECKOUT_PROFILE/chrome/omafire-radius.css ]]
grep -Fqx '/* checkout tokens */' "$CHECKOUT_PROFILE/chrome/src/tokens.css"
grep -Fqx '@import "src/tokens.css";' "$CHECKOUT_PROFILE/chrome/userChrome.css"
[[ ! -e $CHECKOUT_PROFILE/user.js ]]
cmp "$TEST_ROOT/original-userChrome.css" "$RELATIVE_PROFILE/chrome/userChrome.css"
cmp "$TEST_ROOT/original-userContent.css" "$RELATIVE_PROFILE/chrome/userContent.css"
cmp "$TEST_ROOT/original-user.js" "$RELATIVE_PROFILE/user.js"
[[ ! -e $ABSOLUTE_PROFILE/chrome/userChrome.css ]]
[[ ! -e $ABSOLUTE_PROFILE/chrome/userContent.css ]]
[[ ! -e $ABSOLUTE_PROFILE/user.js ]]

# A malformed managed block aborts before any detected profile is changed.
printf '%s\n' "$PREFS_BEGIN" > "$ABSOLUTE_PROFILE/user.js"
if malformed_error=$("$OMAFIRE_BIN" setup 2>&1); then
  echo "setup with malformed Firefox markers unexpectedly succeeded" >&2
  exit 1
fi
[[ $malformed_error == *"malformed Omafire markers"* ]]
[[ ! -e $RELATIVE_PROFILE/chrome/omafire ]]
assert_not_contains "$CSS_BEGIN" "$RELATIVE_PROFILE/chrome/userChrome.css"

echo "firefox-integration.test.sh: ok"
