#!/bin/bash
# Upgrade from omafox (<= 0.2.0): profiles, the hook and the state directory
# it left are moved to omafire's names by one setup, with the user's own
# content untouched; remove then finds both generations. Zen profiles, which
# omafire no longer supports, are left exactly as they are.

set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$TEST_DIR")
TEST_ROOT=$(mktemp -d)
OMAFIRE_BIN=${OMAFIRE_BIN:-$PROJECT_DIR/build/omafire}
TEST_HOME="$TEST_ROOT/home"
MOCK_BIN="$TEST_ROOT/bin"
THEME_DIR="$TEST_ROOT/theme"
FF_ROOT="$TEST_HOME/.mozilla/firefox"
PLAIN="$FF_ROOT/plain.default"            # ordinary profile, omafox payload
CHECKOUT="$FF_ROOT/checkout.default"      # chrome/ is a theme checkout
OLD_CHECKOUT="$FF_ROOT/old-checkout.default"  # an older theme revision
ZEN_ROOT="$TEST_HOME/.config/zen"
ZEN="$ZEN_ROOT/Profiles/default"
PAYLOAD="$TEST_ROOT/package/firefox-chrome"
HOOKS="$TEST_HOME/.config/omarchy/hooks/theme-set.d"
OLD_STATE="$TEST_HOME/.local/state/omafox"
NEW_STATE="$TEST_HOME/.local/state/omafire"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

# `! cmd` never fails a set -e script; this does.
refute() {
  if "$@"; then
    echo "unexpectedly true: $*" >&2
    exit 1
  fi
}

mkdir -p "$TEST_HOME" "$MOCK_BIN" "$THEME_DIR" "$PAYLOAD/src" \
  "$PLAIN/chrome/omarchy-firefox/src" "$CHECKOUT/chrome/src" \
  "$OLD_CHECKOUT/chrome/src" "$ZEN/chrome" "$HOOKS" "$OLD_STATE/backups/20260927-setup-1"
install -m 755 "$TEST_DIR/fixtures/bin/omarchy" "$MOCK_BIN/omarchy"
printf '#!/bin/sh\nexit 1\n' > "$MOCK_BIN/hyprctl"
chmod 755 "$MOCK_BIN/hyprctl"
cp "$TEST_DIR/fixtures/colors.toml" "$THEME_DIR/colors.toml"
printf '%s\n' 'osaka-jade' > "$THEME_DIR/theme.name"

# The package as omafire ships it.
install -m 755 "$PROJECT_DIR/packaging/omafire-hook" "$TEST_ROOT/package/omafire"
install -m 755 /dev/null "$TEST_ROOT/package/omafire-native-host"
install -m 644 "$PROJECT_DIR/packaging/org.omarchy.omafox.json" "$TEST_ROOT/package/manifest.json"
printf '%s\n%s\n' '/* OMAFIRE FIREFOX BRIDGE MANAGED FILE */' '@import "src/a.css";' \
  > "$PAYLOAD/userChrome.css"
printf '/* content */\n' > "$PAYLOAD/userContent.css"
printf '/* a */\n' > "$PAYLOAD/src/a.css"

# ---- what omafox 0.2.0 left ----------------------------------------------
old_palette='/* OMAFOX GENERATED PALETTE — written by omafox sync; do not edit. */'
old_content='/* OMAFOX GENERATED CONTENT PALETTE — written by omafox sync; do not edit. */'
old_radius='/* OMAFOX GENERATED GEOMETRY — written by omafox sync; do not edit. */'
old_generated() {
  printf '%s\n:root {}\n' "$old_palette" > "$1/omafox-palette.css"
  printf '%s\n:root {}\n' "$old_content" > "$1/omafox-content-palette.css"
  printf '%s\n:root {}\n' "$old_radius" > "$1/omarchy-radius.css"
}

# Ordinary profile.
cat > "$PLAIN/chrome/userChrome.css" <<'EOF'
/* BEGIN OMAFOX FIREFOX BRIDGE */
@import url("omarchy-firefox/userChrome.css");
@import url("omafox-palette.css");

/* END OMAFOX FIREFOX BRIDGE */
/* my rule */
EOF
cat > "$PLAIN/chrome/userContent.css" <<'EOF'
/* BEGIN OMAFOX FIREFOX BRIDGE */
@import url("omarchy-firefox/userContent.css");

/* END OMAFOX FIREFOX BRIDGE */
/* my content rule */
EOF
cat > "$PLAIN/user.js" <<'EOF'
user_pref("my.own", 1);
// BEGIN OMAFOX FIREFOX BRIDGE
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
user_pref("omarchy.omafox", true);
// END OMAFOX FIREFOX BRIDGE
EOF
printf '%s\n' '/* OMAFOX FIREFOX BRIDGE MANAGED FILE */' > "$PLAIN/chrome/omarchy-firefox/userChrome.css"
old_generated "$PLAIN/chrome"

# A checkout of the current theme (imports the new names) and one of an
# older revision (still imports omafox's).
for c in "$CHECKOUT" "$OLD_CHECKOUT"; do
  printf ':root {}\n' > "$c/chrome/src/tokens.css"
  printf '%s\n' 'user_pref("my.own", 2);' > "$c/user.js"
  old_generated "$c/chrome"
done
printf '@import url("omafire-palette.css");\n@import url("omafire-radius.css");\n' \
  > "$CHECKOUT/chrome/userChrome.css"
printf '@import url("omafox-palette.css");\n@import url("omarchy-radius.css");\n' \
  > "$OLD_CHECKOUT/chrome/userChrome.css"

# Zen.
printf '%s\n' '/* OMAFOX ZEN BRIDGE MANAGED FILE */' > "$ZEN/chrome/omafox.css"
cat > "$ZEN/chrome/userChrome.css" <<'EOF'
/* BEGIN OMAFOX ZEN BRIDGE */
@import url("omafox.css");

/* END OMAFOX ZEN BRIDGE */
/* my zen rule */
EOF
cat > "$ZEN/user.js" <<'EOF'
// BEGIN OMAFOX ZEN BRIDGE
user_pref("zen.theme.disable-lightweight", false);
// END OMAFOX ZEN BRIDGE
user_pref("my.zen", 1);
EOF

# The hook and the state directory, with a backup set to keep.
install -m 755 /dev/stdin "$HOOKS/omafox" <<'EOF'
#!/bin/bash
if [[ -x /usr/bin/omafox ]]; then
  OMAFOX_SKIP_VERSION_CHECK=1 exec /usr/bin/omafox sync
fi
exit 0
EOF
# The same hook renamed by a user to run first, and an unrelated one.
cp "$HOOKS/omafox" "$HOOKS/00-omafox"
printf '#!/bin/sh\nexec true\n' > "$HOOKS/10-mine"
printf '{"theme":"old"}\n' > "$OLD_STATE/theme.json"
printf 'kept\n' > "$OLD_STATE/backups/20260927-setup-1/user.js"

cat > "$FF_ROOT/profiles.ini" <<'EOF'
[Profile0]
Name=plain
IsRelative=1
Path=plain.default

[Profile1]
Name=checkout
IsRelative=1
Path=checkout.default

[Profile2]
Name=old-checkout
IsRelative=1
Path=old-checkout.default
EOF
printf '[Profile0]\nName=default\nIsRelative=1\nPath=Profiles/default\n' > "$ZEN_ROOT/profiles.ini"
zen_tree() { (cd "$ZEN_ROOT" && find . -type f -exec sha256sum {} + | sort); }
zen_before=$(zen_tree)

export HOME="$TEST_HOME"
# Settings follow XDG_CONFIG_HOME; never the caller's.
unset XDG_CONFIG_HOME OMAFIRE_CONFIG
# Nor the host's installed shell plugin.
export OMAFIRE_SHELL_PLUGIN_SOURCE="$HOME/no-shell-plugin"
export PATH="$MOCK_BIN:$PATH"
export OMAFIRE_THEME_DIR="$THEME_DIR"
export OMAFIRE_THEME_NAME_FILE="$THEME_DIR/theme.name"
export OMAFIRE_NATIVE_HOST_PATH="$TEST_ROOT/package/omafire-native-host"
export OMAFIRE_NATIVE_MANIFEST_PATH="$TEST_ROOT/package/manifest.json"
export OMAFIRE_HOOK_SOURCE="$TEST_ROOT/package/omafire"
export OMAFIRE_FIREFOX_ROOT="$FF_ROOT"
export OMAFIRE_FIREFOX_PAYLOAD_SOURCE="$PAYLOAD"
export OMAFIRE_PSD_RESYNC=0

# ---- before setup: status names the old setup --------------------------
out=$("$OMAFIRE_BIN" status 2>&1)
[[ $out == *"outdated (set up by omafox; run omafire setup)"* ]]

# ---- one setup moves everything ------------------------------------------
out=$("$OMAFIRE_BIN" setup 2>&1)
[[ $out == *"Removed the omafox hook: $HOOKS/omafox"* ]]
[[ $out == *"Removed the omafox hook: $HOOKS/00-omafox"* ]]
[[ -f "$HOOKS/10-mine" ]]

# No omafox marker survives anywhere; each file has exactly one new block.
refute grep -rq 'OMAFOX' "$PLAIN/user.js" "$PLAIN/chrome/userChrome.css" \
  "$PLAIN/chrome/userContent.css"
for f in "$PLAIN/chrome/userChrome.css" "$PLAIN/chrome/userContent.css"; do
  [[ $(grep -cFx '/* BEGIN OMAFIRE FIREFOX BRIDGE */' "$f") -eq 1 ]]
done
[[ $(grep -cFx '// BEGIN OMAFIRE FIREFOX BRIDGE' "$PLAIN/user.js") -eq 1 ]]
grep -Fqx 'user_pref("omafire.managed", true);' "$PLAIN/user.js"
refute grep -Fq 'omarchy.omafox' "$PLAIN/user.js"
grep -Fq '@import url("omafire/userChrome.css");' "$PLAIN/chrome/userChrome.css"

# The user's own lines, untouched.
grep -Fqx '/* my rule */' "$PLAIN/chrome/userChrome.css"
grep -Fqx '/* my content rule */' "$PLAIN/chrome/userContent.css"
grep -Fqx 'user_pref("my.own", 1);' "$PLAIN/user.js"

# Payload and generated files: the new ones in, omafox's out.
[[ -f "$PLAIN/chrome/omafire/userChrome.css" ]]
[[ ! -e "$PLAIN/chrome/omarchy-firefox" ]]
for f in omafire-palette.css omafire-content-palette.css; do   # radius needs hyprctl
  [[ -f "$PLAIN/chrome/$f" && -f "$CHECKOUT/chrome/$f" ]]
done
for f in omafox-palette.css omafox-content-palette.css omarchy-radius.css; do
  [[ ! -e "$PLAIN/chrome/$f" ]]
  [[ ! -e "$CHECKOUT/chrome/$f" ]]
done
# An older checkout still imports two of omafox's files: those stay.
[[ -f "$OLD_CHECKOUT/chrome/omafox-palette.css" ]]
[[ -f "$OLD_CHECKOUT/chrome/omarchy-radius.css" ]]
[[ ! -e "$OLD_CHECKOUT/chrome/omafox-content-palette.css" ]]

# Zen: untouched.
[[ $(zen_tree) == "$zen_before" ]]

# Hook and state.
[[ -x "$HOOKS/omafire" && ! -e "$HOOKS/omafox" && ! -e "$HOOKS/00-omafox" ]]
[[ ! -e $OLD_STATE ]]
[[ $(cat "$NEW_STATE/backups/20260927-setup-1/user.js") == kept ]]
[[ -f "$NEW_STATE/theme.json" ]]

out=$("$OMAFIRE_BIN" status 2>&1)
[[ $out != *"set up by omafox"* ]]

# ---- a second setup changes nothing --------------------------------------
sets=$(find "$NEW_STATE/backups" -mindepth 1 -maxdepth 1 | wc -l)
before=$(cat "$PLAIN/user.js" "$PLAIN/chrome/userChrome.css" | sha256sum)
"$OMAFIRE_BIN" setup >/dev/null 2>&1
[[ $(find "$NEW_STATE/backups" -mindepth 1 -maxdepth 1 | wc -l) -eq $sets ]]
[[ $before == "$(cat "$PLAIN/user.js" "$PLAIN/chrome/userChrome.css" | sha256sum)" ]]

# ---- remove finds omafox's leftovers too ---------------------------------
old_generated "$PLAIN/chrome"
mkdir -p "$PLAIN/chrome/omarchy-firefox"
printf '%s\n' '/* OMAFOX FIREFOX BRIDGE MANAGED FILE */' > "$PLAIN/chrome/omarchy-firefox/userChrome.css"
"$OMAFIRE_BIN" remove >/dev/null 2>&1
[[ $(cat "$PLAIN/chrome/userChrome.css") == '/* my rule */' ]]
[[ $(cat "$PLAIN/user.js") == 'user_pref("my.own", 1);' ]]
[[ -z $(find "$PLAIN/chrome" -maxdepth 1 -name 'omafox*' -o -maxdepth 1 -name 'omarchy-*' -o -maxdepth 1 -name 'omafire*') ]]
[[ $(zen_tree) == "$zen_before" ]]

echo "upgrade.test.sh: ok"
