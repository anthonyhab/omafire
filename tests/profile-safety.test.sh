#!/bin/bash
# Profile safety: profile-sync-daemon layouts, backups, the transactional
# payload swap, one run at a time, and running-browser notices.

set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$TEST_DIR")
TEST_ROOT=$(mktemp -d)
OMAFIRE_BIN=${OMAFIRE_BIN:-$PROJECT_DIR/build/omafire}
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
MARKER='/* OMAFIRE FIREFOX BRIDGE MANAGED FILE */'
PREFS_BEGIN='// BEGIN OMAFIRE FIREFOX BRIDGE'

cleanup() {
  if [[ -n ${OVL_MOUNT:-} ]] && mountpoint -q "$OVL_MOUNT"; then
    fusermount3 -u "$OVL_MOUNT" 2>/dev/null || fusermount -u "$OVL_MOUNT" 2>/dev/null || true
  fi
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
install -m 755 "$PROJECT_DIR/packaging/omafire-hook" "$TEST_ROOT/package/omafire-hook"
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
# Settings follow XDG_CONFIG_HOME; never the caller's.
unset XDG_CONFIG_HOME OMAFIRE_CONFIG
# Nor the host's installed shell plugin.
export OMAFIRE_SHELL_PLUGIN_SOURCE="$HOME/no-shell-plugin"
export PATH="$MOCK_BIN:$PATH"
export OMAFIRE_THEME_DIR="$THEME_DIR"
export OMAFIRE_THEME_NAME_FILE="$THEME_DIR/theme.name"
export OMAFIRE_HOOK_SOURCE="$TEST_ROOT/package/omafire-hook"
export OMAFIRE_FIREFOX_ROOT="$FF_ROOT"
export OMAFIRE_FIREFOX_PAYLOAD_SOURCE="$PAYLOAD"
unset OMAFIRE_PSD_RESYNC

# ---- psd: write through the live symlink only ---------------------------
out=$("$OMAFIRE_BIN" setup 2>&1)
[[ $out == *"Configured Firefox profile: $LIVE"* ]]
[[ $out == *"Configured Firefox profile: $PLAIN"* ]]
[[ $out == *"Skipped offline Firefox profile"*"$OFFLINE"* ]]
[[ $out == *"Skipped Firefox profile-sync-daemon copy"*"$LISTED_COPY"* ]]
[[ $out == *"Asked profile-sync-daemon to write the changes to disk."* ]]
grep -qx -- '--user start psd-resync.service' "$TEST_ROOT/systemctl.log"
[[ -f "$LIVE_TMPFS/chrome/omafire/userChrome.css" ]]
grep -Fq "$PREFS_BEGIN" "$LIVE_TMPFS/user.js"
grep -Fq 'user_pref("my.own", 1);' "$LIVE_TMPFS/user.js"
grep -Fqx 'user_pref("omafire.managed", true);' "$LIVE_TMPFS/user.js"
# Nothing created behind the dangling link, no psd copy changed.
[[ -L $OFFLINE && ! -e $OFFLINE ]]
[[ ! -e "$PSD_RUN/user-firefox-offline.default" ]]
after_copies=$(for d in "$FF_ROOT"/*-back*; do tree_hash "$d"; done)
[[ $before_copies == "$after_copies" ]]

# ---- backups: the user's own files, outside the profile -----------------
backup_sets=("$TEST_HOME/.local/state/omafire/backups/"*-setup-*)
[[ ${#backup_sets[@]} -eq 1 ]]
cmp "$TEST_ROOT/original-live-user.js" "${backup_sets[0]}$LIVE/user.js"
[[ -f "${backup_sets[0]}$LIVE/chrome/userChrome.css" ]]
[[ $out == *"Backed up the files it changed to ${backup_sets[0]}"* ]]
# A second setup changes nothing, so it backs nothing up.
out=$("$OMAFIRE_BIN" setup 2>&1)
[[ $out != *"Backed up"* ]]
[[ $(find "$TEST_HOME/.local/state/omafire/backups" -mindepth 1 -maxdepth 1 | wc -l) -eq 1 ]]

# ---- payload: swapped whole, stale files and leftovers gone -------------
printf '/* stale */\n' > "$PLAIN/chrome/omafire/src/stale.css"
mkdir -p "$PLAIN/chrome/.omafire.new.abc123"
cp "$PAYLOAD/userChrome.css" "$PLAIN/chrome/.omafire.new.abc123/"
mkdir -p "$PLAIN/chrome/.omafire.new.notours"
printf 'x\n' > "$PLAIN/chrome/.omafire.new.notours/keep"
printf '/* b */\n' > "$PAYLOAD/src/b.css"
"$OMAFIRE_BIN" setup >/dev/null 2>&1
[[ ! -e "$PLAIN/chrome/omafire/src/stale.css" ]]
[[ -f "$PLAIN/chrome/omafire/src/b.css" ]]
[[ ! -e "$PLAIN/chrome/.omafire.new.abc123" ]]
[[ -f "$PLAIN/chrome/.omafire.new.notours/keep" ]]   # not ours: kept
rm -rf "$PLAIN/chrome/.omafire.new.notours"
[[ -z $(find "$PLAIN/chrome" "$LIVE_TMPFS/chrome" -maxdepth 1 -name '.omafire.*') ]]

# An unreadable payload file fails the install and leaves the old payload.
before_payload=$(tree_hash "$PLAIN/chrome/omafire")
printf '/* c */\n' > "$PAYLOAD/src/c.css"
chmod 000 "$PAYLOAD/src/c.css"
if [[ $(id -u) -ne 0 ]]; then
  if "$OMAFIRE_BIN" setup >/dev/null 2>&1; then
    echo "setup succeeded with an unreadable payload file" >&2
    exit 1
  fi
  [[ $before_payload == "$(tree_hash "$PLAIN/chrome/omafire")" ]]
  [[ -z $(find "$PLAIN/chrome" -maxdepth 1 -name '.omafire.*') ]]
fi
chmod 644 "$PAYLOAD/src/c.css"
rm "$PAYLOAD/src/c.css"

# ---- one run at a time: parallel setups and syncs never double a block --
pids=()
for _ in 1 2 3 4; do
  "$OMAFIRE_BIN" setup >/dev/null 2>&1 & pids+=($!)
  "$OMAFIRE_BIN" sync >/dev/null 2>&1 & pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
for profile in "$LIVE_TMPFS" "$PLAIN"; do
  [[ $(grep -cFx "$PREFS_BEGIN" "$profile/user.js") -eq 1 ]]
  [[ $(grep -cF 'omafire/userChrome.css' "$profile/chrome/userChrome.css") -eq 1 ]]
done
grep -Fq 'user_pref("my.own", 1);' "$LIVE_TMPFS/user.js"

# ---- a running browser is named, not refused -----------------------------
ln -s "host:+$$" "$PLAIN/lock"
printf '/* d */\n' > "$PAYLOAD/src/d.css"
out=$("$OMAFIRE_BIN" setup 2>&1)
[[ $out == *"Configured Firefox profile: $PLAIN"*"Firefox is running with this profile"* ]]
rm "$PLAIN/lock"

# An owned payload left unreadable (0311: its marker still opens) is listed
# and replaced whole, never left behind without its marker.
chmod 311 "$PLAIN/chrome/omafire" "$PLAIN/chrome/omafire/src"
"$OMAFIRE_BIN" setup >/dev/null 2>&1
[[ $(tree_hash "$PLAIN/chrome/omafire") == "$(tree_hash "$PAYLOAD")" ]]
[[ -z $(find "$PLAIN/chrome" -maxdepth 1 -name '.omafire.*') ]]

# ---- psd's fuse-overlayfs: a payload in the lower layer can't be renamed --
# (EXDEV), so the swap falls back to removing our tree and moving the new
# one in. Needs FUSE; skipped where there is none (CI containers).
if command -v fuse-overlayfs >/dev/null && [[ -w /dev/fuse ]]; then
  OVL_LOWER="$TEST_ROOT/ovl-lower" OVL_MOUNT="$PSD_RUN/user-firefox-ovl.default"
  mkdir -p "$OVL_LOWER/chrome" "$TEST_ROOT/ovl-upper" "$TEST_ROOT/ovl-work" "$OVL_MOUNT"
  cp -r "$PLAIN/chrome/omafire" "$OVL_LOWER/chrome/omafire"   # an owned, older payload
  printf '/* stale */\n' > "$OVL_LOWER/chrome/omafire/src/stale.css"
  fuse-overlayfs -o "lowerdir=$OVL_LOWER,upperdir=$TEST_ROOT/ovl-upper,workdir=$TEST_ROOT/ovl-work" "$OVL_MOUNT"
  ln -s "$OVL_MOUNT" "$FF_ROOT/ovl.default"
  printf '\n[Profile4]\nName=ovl\nIsRelative=1\nPath=ovl.default\n' >> "$FF_ROOT/profiles.ini"
  out=$("$OMAFIRE_BIN" setup 2>&1) || { echo "$out"; exit 1; }
  [[ $out == *"Configured Firefox profile: $FF_ROOT/ovl.default"* ]]
  [[ $(tree_hash "$OVL_MOUNT/chrome/omafire") == "$(tree_hash "$PAYLOAD")" ]]
  [[ ! -e "$OVL_MOUNT/chrome/omafire/src/stale.css" ]]
  [[ -z $(find "$OVL_MOUNT/chrome" -maxdepth 1 -name '.omafire.*') ]]
fi

# ---- remove: through the same guards; backups outlive it ----------------
# A profile setup never configured: its prefs.js holds prefs of the names
# the bridge owns, set by the user, and remove leaves it byte for byte.
MINE="$FF_ROOT/mine.default"
mkdir -p "$MINE"
printf '%s\n' '// Mozilla User Preferences' 'user_pref("browser.anchor_color", "#ff8800");' \
  'user_pref("layout.css.prefers-color-scheme.content-override", 0);' 'user_pref("keep", 1);' > "$MINE/prefs.js"
cp "$MINE/prefs.js" "$TEST_ROOT/original-mine-prefs.js"
printf '\n[Profile9]\nName=mine\nIsRelative=1\nPath=mine.default\n' >> "$FF_ROOT/profiles.ini"
: > "$TEST_ROOT/systemctl.log"
chmod 311 "$PLAIN/chrome/omafire"   # and remove finishes such a payload too
out=$("$OMAFIRE_BIN" remove 2>&1)
[[ $out == *"Removed Firefox profile bridge: $LIVE"* ]]
[[ $out == *"Asked profile-sync-daemon"* ]]
cmp "$TEST_ROOT/original-live-user.js" "$LIVE_TMPFS/user.js"
cmp "$TEST_ROOT/original-mine-prefs.js" "$MINE/prefs.js"
[[ $out != *"$MINE"* ]]
[[ ! -e "$LIVE_TMPFS/chrome/omafire" && ! -e "$PLAIN/chrome/omafire" ]]
[[ ! -e "$TEST_HOME/.local/state/omafire/lock" ]]
[[ -d "$TEST_HOME/.local/state/omafire/backups" ]]
after_copies=$(for d in "$FF_ROOT"/*-back*; do tree_hash "$d"; done)
[[ $before_copies == "$after_copies" ]]

# ---- setup with a profile it must skip: the rest is still finished ------
# One profile can't take the palette (its palette file is a directory); the
# other is psd's and holds the user's own userChrome.css. Setup fails at the
# end, not inside its sync: the set it backed up is restorable, and psd is
# still asked to resync. (It used to exit before both.)
SKIP_ROOT="$TEST_ROOT/skip-ff"
SKIP_TMPFS="$PSD_RUN/user-firefox-mine2.default"
mkdir -p "$SKIP_ROOT/bad.default/chrome/omafire-palette.css" "$SKIP_TMPFS/chrome"
ln -s "$SKIP_TMPFS" "$SKIP_ROOT/mine2.default"
printf '%s\n' '/* my own rule */' > "$SKIP_TMPFS/chrome/userChrome.css"
cp "$SKIP_TMPFS/chrome/userChrome.css" "$TEST_ROOT/original-mine2-userChrome.css"
printf '[Profile0]\nName=bad\nIsRelative=1\nPath=bad.default\n\n[Profile1]\nName=mine2\nIsRelative=1\nPath=mine2.default\n' > "$SKIP_ROOT/profiles.ini"
: > "$TEST_ROOT/systemctl.log"
rm -rf "$TEST_HOME/.local/state/omafire/backups"
status=0
out=$(OMAFIRE_FIREFOX_ROOT="$SKIP_ROOT" "$OMAFIRE_BIN" setup 2>&1) || status=$?
[[ $status == 1 ]]
[[ $out == *"Configured Firefox profile: $SKIP_ROOT/mine2.default"* ]]
[[ $out == *"1 Firefox profile(s) skipped; fix them and run omafire setup again"* ]]
[[ $out == *"Backed up the files it changed to"* ]]
[[ $out == *"Asked profile-sync-daemon to write the changes to disk."* ]]
grep -q 'psd-resync' "$TEST_ROOT/systemctl.log"
set_dir=$(find "$TEST_HOME/.local/state/omafire/backups" -mindepth 1 -maxdepth 1 -type d -name '*-setup-*')
[[ -f "$set_dir/.wrote" ]]
out=$(OMAFIRE_FIREFOX_ROOT="$SKIP_ROOT" "$OMAFIRE_BIN" restore 2>&1)
[[ $out == *"Restored $SKIP_ROOT/mine2.default/chrome/userChrome.css"* || $out == *"Restored $SKIP_TMPFS/chrome/userChrome.css"* ]]
cmp "$TEST_ROOT/original-mine2-userChrome.css" "$SKIP_TMPFS/chrome/userChrome.css"

echo "profile-safety.test.sh: ok"
