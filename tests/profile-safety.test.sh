#!/bin/bash
# Profile safety: profile-sync-daemon layouts, backups, the transactional
# payload swap, one run at a time, and running-browser notices.

set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$TEST_DIR")
TEST_ROOT=$(mktemp -d)
OMAFOX_BIN=${OMAFOX_BIN:-$PROJECT_DIR/build/omafox}
TEST_HOME="$TEST_ROOT/home"
MOCK_BIN="$TEST_ROOT/bin"
THEME_DIR="$TEST_ROOT/theme"
FF_ROOT="$TEST_HOME/.mozilla/firefox"
PSD_RUN="$TEST_ROOT/run/user/1000/psd"
LIVE="$FF_ROOT/live.default"            # psd: symlink into tmpfs
LIVE_TMPFS="$PSD_RUN/user-firefox-live.default"
OFFLINE="$FF_ROOT/offline.default"      # psd stopped: dangling symlink
PLAIN="$FF_ROOT/plain.default"          # ordinary directory
LISTED_COPY="$FF_ROOT/plain.default-backup"
PAYLOAD="$TEST_ROOT/package/firefox-chrome"
MARKER='/* OMAFOX FIREFOX BRIDGE MANAGED FILE */'
PREFS_BEGIN='// BEGIN OMAFOX FIREFOX BRIDGE'

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

tree_hash() {
  (cd "$1" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum | sha256sum)
}

mkdir -p "$TEST_HOME" "$MOCK_BIN" "$THEME_DIR" "$FF_ROOT" "$PSD_RUN" \
  "$LIVE_TMPFS/chrome" "$PLAIN/chrome" "$TEST_ROOT/package"
install -m 755 "$TEST_DIR/fixtures/bin/omarchy" "$MOCK_BIN/omarchy"
printf '#!/bin/sh\nexit 1\n' > "$MOCK_BIN/hyprctl"
# psd's resync unit, recorded instead of run.
printf '#!/bin/sh\necho "$*" >> "%s/systemctl.log"\n' "$TEST_ROOT" > "$MOCK_BIN/systemctl"
chmod 755 "$MOCK_BIN/hyprctl" "$MOCK_BIN/systemctl"
install -m 755 "$PROJECT_DIR/packaging/omafox-hook" "$TEST_ROOT/package/omafox-hook"
install -m 755 /dev/null "$TEST_ROOT/package/omafox-native-host"
install -m 644 "$PROJECT_DIR/packaging/org.omarchy.omafox.json" "$TEST_ROOT/package/manifest.json"
cp "$TEST_DIR/fixtures/colors.toml" "$THEME_DIR/colors.toml"
printf '%s\n' 'osaka-jade' > "$THEME_DIR/theme.name"

mkdir -p "$PAYLOAD/src"
printf '%s\n%s\n' "$MARKER" '@import "src/a.css";' > "$PAYLOAD/userChrome.css"
printf '/* content */\n' > "$PAYLOAD/userContent.css"
printf '/* a */\n' > "$PAYLOAD/src/a.css"

# The psd layout: live and offline profiles are symlinks; their on-disk
# copies sit beside them under psd's names and must never be touched.
ln -s "$LIVE_TMPFS" "$LIVE"
ln -s "$PSD_RUN/user-firefox-offline.default" "$OFFLINE"
for copy in live.default-backup live.default-back-ovfs \
    live.default-backup-crashrecovery-20260919_072227 offline.default-backup \
    plain.default-backup; do
  mkdir -p "$FF_ROOT/$copy/chrome"
  printf 'user_pref("psd.copy", "%s");\n' "$copy" > "$FF_ROOT/$copy/user.js"
done
before_copies=$(for d in "$FF_ROOT"/*-back*; do tree_hash "$d"; done)

printf '%s\n' 'user_pref("my.own", 1);' > "$LIVE_TMPFS/user.js"
printf '%s\n' '/* my rule */' > "$LIVE_TMPFS/chrome/userChrome.css"
cp "$LIVE_TMPFS/user.js" "$TEST_ROOT/original-live-user.js"

cat > "$FF_ROOT/profiles.ini" <<EOF
[Profile0]
Name=live
IsRelative=1
Path=live.default

[Profile1]
Name=offline
IsRelative=1
Path=offline.default

[Profile2]
Name=plain
IsRelative=1
Path=plain.default

[Profile3]
Name=listed-copy
IsRelative=1
Path=plain.default-backup
EOF

export HOME="$TEST_HOME"
export PATH="$MOCK_BIN:$PATH"
export OMAFOX_THEME_DIR="$THEME_DIR"
export OMAFOX_THEME_NAME_FILE="$THEME_DIR/theme.name"
export OMAFOX_NATIVE_HOST_PATH="$TEST_ROOT/package/omafox-native-host"
export OMAFOX_NATIVE_MANIFEST_PATH="$TEST_ROOT/package/manifest.json"
export OMAFOX_HOOK_SOURCE="$TEST_ROOT/package/omafox-hook"
export OMAFOX_FIREFOX_ROOT="$FF_ROOT"
export OMAFOX_FIREFOX_PAYLOAD_SOURCE="$PAYLOAD"
export OMAFOX_ZEN_PROFILES_FILE="$TEST_ROOT/missing-zen-profiles.ini"
unset OMAFOX_PSD_RESYNC

# ---- psd: write through the live symlink only ---------------------------
out=$("$OMAFOX_BIN" setup 2>&1)
[[ $out == *"Configured Firefox profile: $LIVE"* ]]
[[ $out == *"Configured Firefox profile: $PLAIN"* ]]
[[ $out == *"Skipped offline Firefox profile"*"$OFFLINE"* ]]
[[ $out == *"Skipped Firefox profile-sync-daemon copy"*"$LISTED_COPY"* ]]
[[ $out == *"Asked profile-sync-daemon to write the changes to disk."* ]]
grep -qx -- '--user start psd-resync.service' "$TEST_ROOT/systemctl.log"
[[ -f "$LIVE_TMPFS/chrome/omarchy-firefox/userChrome.css" ]]
grep -Fq "$PREFS_BEGIN" "$LIVE_TMPFS/user.js"
grep -Fq 'user_pref("my.own", 1);' "$LIVE_TMPFS/user.js"
grep -Fqx 'user_pref("omarchy.omafox", true);' "$LIVE_TMPFS/user.js"
# Nothing created behind the dangling link, no psd copy changed.
[[ -L $OFFLINE && ! -e $OFFLINE ]]
[[ ! -e "$PSD_RUN/user-firefox-offline.default" ]]
after_copies=$(for d in "$FF_ROOT"/*-back*; do tree_hash "$d"; done)
[[ $before_copies == "$after_copies" ]]

# ---- backups: the user's own files, outside the profile -----------------
backup_sets=("$TEST_HOME/.local/state/omafox/backups/"*-setup-*)
[[ ${#backup_sets[@]} -eq 1 ]]
cmp "$TEST_ROOT/original-live-user.js" "${backup_sets[0]}$LIVE/user.js"
[[ -f "${backup_sets[0]}$LIVE/chrome/userChrome.css" ]]
[[ $out == *"Backed up the files it changed to ${backup_sets[0]}"* ]]
# A second setup changes nothing, so it backs nothing up.
out=$("$OMAFOX_BIN" setup 2>&1)
[[ $out != *"Backed up"* ]]
[[ $(find "$TEST_HOME/.local/state/omafox/backups" -mindepth 1 -maxdepth 1 | wc -l) -eq 1 ]]

# ---- payload: swapped whole, stale files and leftovers gone -------------
printf '/* stale */\n' > "$PLAIN/chrome/omarchy-firefox/src/stale.css"
mkdir -p "$PLAIN/chrome/.omarchy-firefox.new.abc123"
cp "$PAYLOAD/userChrome.css" "$PLAIN/chrome/.omarchy-firefox.new.abc123/"
mkdir -p "$PLAIN/chrome/.omarchy-firefox.new.notours"
printf 'x\n' > "$PLAIN/chrome/.omarchy-firefox.new.notours/keep"
printf '/* b */\n' > "$PAYLOAD/src/b.css"
"$OMAFOX_BIN" setup >/dev/null 2>&1
[[ ! -e "$PLAIN/chrome/omarchy-firefox/src/stale.css" ]]
[[ -f "$PLAIN/chrome/omarchy-firefox/src/b.css" ]]
[[ ! -e "$PLAIN/chrome/.omarchy-firefox.new.abc123" ]]
[[ -f "$PLAIN/chrome/.omarchy-firefox.new.notours/keep" ]]   # not ours: kept
rm -rf "$PLAIN/chrome/.omarchy-firefox.new.notours"
[[ -z $(find "$PLAIN/chrome" "$LIVE_TMPFS/chrome" -maxdepth 1 -name '.omarchy-firefox.*') ]]

# An unreadable payload file fails the install and leaves the old payload.
before_payload=$(tree_hash "$PLAIN/chrome/omarchy-firefox")
printf '/* c */\n' > "$PAYLOAD/src/c.css"
chmod 000 "$PAYLOAD/src/c.css"
if [[ $(id -u) -ne 0 ]]; then
  if "$OMAFOX_BIN" setup >/dev/null 2>&1; then
    echo "setup succeeded with an unreadable payload file" >&2
    exit 1
  fi
  [[ $before_payload == "$(tree_hash "$PLAIN/chrome/omarchy-firefox")" ]]
  [[ -z $(find "$PLAIN/chrome" -maxdepth 1 -name '.omarchy-firefox.*') ]]
fi
chmod 644 "$PAYLOAD/src/c.css"
rm "$PAYLOAD/src/c.css"

# ---- one run at a time: parallel setups and syncs never double a block --
pids=()
for _ in 1 2 3 4; do
  "$OMAFOX_BIN" setup >/dev/null 2>&1 & pids+=($!)
  "$OMAFOX_BIN" sync >/dev/null 2>&1 & pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
for profile in "$LIVE_TMPFS" "$PLAIN"; do
  [[ $(grep -cFx "$PREFS_BEGIN" "$profile/user.js") -eq 1 ]]
  [[ $(grep -cF 'omarchy-firefox/userChrome.css' "$profile/chrome/userChrome.css") -eq 1 ]]
done
grep -Fq 'user_pref("my.own", 1);' "$LIVE_TMPFS/user.js"

# ---- a running browser is named, not refused -----------------------------
ln -s "host:+$$" "$PLAIN/lock"
printf '/* d */\n' > "$PAYLOAD/src/d.css"
out=$("$OMAFOX_BIN" setup 2>&1)
[[ $out == *"Configured Firefox profile: $PLAIN"*"Firefox is running with this profile"* ]]
rm "$PLAIN/lock"

# ---- remove: through the same guards; backups outlive it ----------------
: > "$TEST_ROOT/systemctl.log"
out=$("$OMAFOX_BIN" remove 2>&1)
[[ $out == *"Removed Firefox profile bridge: $LIVE"* ]]
[[ $out == *"Asked profile-sync-daemon"* ]]
cmp "$TEST_ROOT/original-live-user.js" "$LIVE_TMPFS/user.js"
[[ ! -e "$LIVE_TMPFS/chrome/omarchy-firefox" ]]
[[ ! -e "$TEST_HOME/.local/state/omafox/lock" ]]
[[ -d "$TEST_HOME/.local/state/omafox/backups" ]]
after_copies=$(for d in "$FF_ROOT"/*-back*; do tree_hash "$d"; done)
[[ $before_copies == "$after_copies" ]]

echo "profile-safety.test.sh: ok"
