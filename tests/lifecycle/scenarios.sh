#!/bin/bash
# The §2 scenario matrix (docs/plans/firefox-156-release-readiness.md in the
# bundle), one function per row. Usage, from the repo root:
#   tests/lifecycle/build.sh                    stage the packages and fixture
#   tests/lifecycle/scenarios.sh [s1 s2 ...]    run rows (default: all)
# Evidence: $EVID/<row>/log.md, manifests, outputs and screenshots.

set -euo pipefail
. tests/lifecycle/env.sh

P_GEN=.mozilla/firefox/gen.default
P_PERS=.mozilla/firefox/personal.default
P_CHK=.mozilla/firefox/checkout.default
P_SPC=".mozilla/firefox/Profiles/My Profile.default"
P_ABS="elsewhere/abs profile"
CONFIGURED=("$P_GEN" "$P_PERS" "$P_SPC" "$P_ABS")   # payload profiles

blocks() { python3 "$REPO/tests/lifecycle/manifest.py" blocks "$1"; }
one_block_each() {
  local p f
  for p in "${CONFIGURED[@]}"; do
    for f in chrome/userChrome.css chrome/userContent.css user.js; do
      [[ $(blocks "$SB_HOME/$p/$f") == 1 ]] || { echo "$p/$f"; return 1; }
    done
  done
  [[ $(blocks "$SB_HOME/$P_CHK/user.js") == 1 ]]
}
payload_is() { diff -r "$1/usr/share/omafire/firefox/chrome" "$SB_HOME/$2/chrome/omafire"; }
no_leftovers() { [[ -z $(find "$SB_HOME" -name '.omafire.*' -print -quit) ]]; }
no_owned_files() {   # nothing omafire wrote is left in profile $1
  [[ -z $(find "$SB_HOME/$1" \( -name 'omafire*' -o -name '.omafire.*' \) -print -quit) ]] &&
    ! grep -qs 'OMAFIRE' "$SB_HOME/$1/user.js" "$SB_HOME/$1/chrome/userChrome.css" "$SB_HOME/$1/chrome/userContent.css"
}
identical() { cmp -s "$1" "$2"; }
not() { ! "$@"; }
no_owned_prefs() {   # prefs.js $1 has no omafire.* pref but the user's switches (ffKeptPrefs)
  ! grep 'user_pref("omafire\.' "$1" |
    grep -qv -e '"omafire.scripts"' -e '"omafire.scripts.disabled"' -e '"omafire.pseudo-state"'
}
same_tree() { diff -r "$1" "$2" >/dev/null; }
fresh() {
  ffstart "$1" "$2" "$3" "$SB_HOME/$4"
  expect "$1" "fresh Firefox ($2) still running after start" test "$FF_ALIVE" = yes
  if [[ $4 == "$P_PERS" ]]; then
    # The personal userChrome.css rule paints whenever stylesheets load;
    # customChrome.css only while the payload (which imports it) is in place.
    local need=1
    [[ -f $SB_HOME/$P_PERS/chrome/omafire/userChrome.css ]] && grep -q 'omafire/userChrome.css' "$SB_HOME/$P_PERS/chrome/userChrome.css" && need=2
    expect "$1" "fresh Firefox ($2): personal userChrome.css applied$( ((need == 2)) && echo ' and customChrome.css')" \
      python3 -c 'import re,sys; m=list(map(int, re.findall(r"=(\d+)", sys.argv[1]))); sys.exit(not (len(m) == 2 and m[0] >= 1600 and (int(sys.argv[2]) == 1 or m[1] >= 1600)))' "$FF_MARKS" "$need"
  fi
}
use_theme() {   # use_theme NAME: switch the sandbox's Omarchy theme
  local cur=$SB_HOME/.local/state/omarchy/current
  rm -rf "${cur:?}/theme"
  if [[ $1 == "$THEME_NAME" ]]; then cp -rL "$LIVE_THEME" "$cur/theme"
  else cp -rL "/usr/share/omarchy/themes/$1" "$cur/theme"; fi
  printf '%s\n' "$1" > "$cur/theme.name"
}

# ------------------------------------------------------------- clean setup
s1() {
  local s=s1-clean; instance $s
  note $s "# S1 Clean setup: every fixture profile, staged HEAD package"
  op $s status-before "$PKG_HEAD" omafire status
  op $s setup "$PKG_HEAD" omafire setup
  expect $s "setup exits 0" test "$OP_RC" = 0
  expect $s "sentinels, modes and user-owned content preserved" test "$OP_PRESERVED" = 0
  expect $s "exactly one managed block per managed file" one_block_each
  local p
  for p in "${CONFIGURED[@]}"; do
    expect $s "payload in $p is the packaged one (one copy)" payload_is "$PKG_HEAD" "$p"
  done
  expect $s "checkout profile: no payload copied into the checkout" test ! -e "$SB_HOME/src/omafire-theme/omafire"
  expect $s "checkout: git sees no change (generated files are ignored)" \
    test -z "$(git -C "$SB_HOME/src/omafire-theme" status --porcelain)"
  expect $s "psd copy listed in profiles.ini untouched" \
    test -z "$(grep 'personal.default-backup' "$OP_DIFF")"
  expect $s "no staging leftovers" no_leftovers
  expect $s "user.js mode 0640 kept" test "$(stat -c %a "$SB_HOME/$P_PERS/user.js")" = 640
  expect $s "userChrome.css mode 0644 kept" test "$(stat -c %a "$SB_HOME/$P_PERS/chrome/userChrome.css")" = 644
  op $s status-after "$PKG_HEAD" omafire status
  expect $s "status reports configured for every payload profile" \
    test "$(grep -c '(configured)' "$OP_OUT")" = 4
  fresh $s generated "$PKG_HEAD" "$P_GEN"
  fresh $s personal "$PKG_HEAD" "$P_PERS"
  fresh $s checkout "$PKG_HEAD" "$P_CHK"
  fresh $s spaced "$PKG_HEAD" "$P_SPC"
  fresh $s absolute "$PKG_HEAD" "$P_ABS"
}

# ------------------------------------------------------ repeated setup/sync
s2() {
  local s=s2-repeat; instance $s
  note $s "# S2 Repeated setup/sync: no duplicate blocks, no drift"
  op $s setup-1 "$PKG_HEAD" omafire setup
  cp "$SB_HOME/$P_PERS/user.js" "$SCR/s2-userjs-1"
  cp "$SB_HOME/$P_PERS/chrome/omafire-palette.css" "$SCR/s2-palette-1"
  op $s setup-2 "$PKG_HEAD" omafire setup
  expect $s "second setup changes nothing" test -z "$(grep -v -e churn -e PRESERVED "$OP_DIFF")"
  op $s sync-1 "$PKG_HEAD" omafire sync
  op $s sync-2 "$PKG_HEAD" omafire sync
  expect $s "repeated sync changes nothing" test -z "$(grep -v -e churn -e PRESERVED "$OP_DIFF")"
  use_theme catppuccin-latte
  op $s sync-other-theme "$PKG_HEAD" omafire sync
  expect $s "theme change: user-owned content preserved" test "$OP_PRESERVED" = 0
  expect $s "theme change rewrote the palette" not identical "$SCR/s2-palette-1" "$SB_HOME/$P_PERS/chrome/omafire-palette.css"
  use_theme "$THEME_NAME"
  op $s sync-back "$PKG_HEAD" omafire sync
  expect $s "theme back: user.js byte-identical to the first setup (no drift)" identical "$SCR/s2-userjs-1" "$SB_HOME/$P_PERS/user.js"
  expect $s "theme back: palette byte-identical to the first setup" identical "$SCR/s2-palette-1" "$SB_HOME/$P_PERS/chrome/omafire-palette.css"
  # The user edits around the managed blocks, then setup runs again.
  printf '/* SENTINEL edit after setup */\n#urlbar { color: red; }\n' >> "$SB_HOME/$P_PERS/chrome/userChrome.css"
  printf 'user_pref("sentinel.after", 2);\n' >> "$SB_HOME/$P_PERS/user.js"
  op $s setup-after-user-edits "$PKG_HEAD" omafire setup
  expect $s "setup after user edits: user-owned content preserved" test "$OP_PRESERVED" = 0
  expect $s "exactly one managed block per managed file" one_block_each
  expect $s "user's later user.js line still last-but-block order" grep -q 'sentinel.after' "$SB_HOME/$P_PERS/user.js"
  fresh $s personal "$PKG_HEAD" "$P_PERS"
}

# ------------------------------------------------------------------ upgrade
s3() {
  local s=s3-upgrade; instance $s
  note $s "# S3 Upgrade: v0.6.6 (git tag, staged with makepkg) to HEAD"
  op $s setup-v066 "$PKG_PREV" omafire setup
  expect $s "v0.6.6 setup exits 0" test "$OP_RC" = 0
  expect $s "payload is v0.6.6's" payload_is "$PKG_PREV" "$P_PERS"
  fresh $s personal-v066 "$PKG_PREV" "$P_PERS"
  # pacman -U of the new package runs no user command: the next theme hook
  # (sync) runs the new binary against the old payload, and brings it up to
  # the package's.
  op $s status-head-before-sync "$PKG_HEAD" omafire status
  expect $s "status says outdated after the upgrade" grep -q '(outdated)' "$OP_OUT"
  op $s sync-head-before-setup "$PKG_HEAD" omafire sync
  expect $s "sync after upgrade, before setup: preserved" test "$OP_PRESERVED" = 0
  expect $s "sync after upgrade brings the payload to HEAD's" payload_is "$PKG_HEAD" "$P_PERS"
  op $s status-head-after-sync "$PKG_HEAD" omafire status
  expect $s "status no longer says outdated after sync" not grep -q '(outdated)' "$OP_OUT"
  op $s setup-head "$PKG_HEAD" omafire setup
  expect $s "setup after upgrade exits 0" test "$OP_RC" = 0
  expect $s "upgrade preserved sentinels and user-owned content" test "$OP_PRESERVED" = 0
  local p
  for p in "${CONFIGURED[@]}"; do
    expect $s "payload in $p is HEAD's" payload_is "$PKG_HEAD" "$p"
  done
  expect $s "exactly one managed block per managed file" one_block_each
  expect $s "no staging leftovers" no_leftovers
  op $s status-head "$PKG_HEAD" omafire status
  expect $s "status configured after setup" test "$(grep -c '(configured)' "$OP_OUT")" = 4
  fresh $s personal-head "$PKG_HEAD" "$P_PERS"
}

# --------------------------------------------------- checkout-backed profile
s4() {
  local s=s4-checkout; instance $s
  note $s "# S4 Checkout-backed: symlinked checkout (in S1) and a chrome/ checkout an older release installed into"
  # A profile whose chrome/ is a plain-directory checkout that an older
  # omafire treated as a payload profile: a payload copy inside and full
  # import blocks.
  local c=$SB_HOME/.mozilla/firefox/oldcheckout.default
  mkdir -p "$c"
  git -C "$REPO" archive --prefix=chrome/ HEAD:theme | tar -x -C "$c"
  cp -a "$PKG_PREV/usr/share/omafire/firefox/chrome" "$c/chrome/omafire"
  printf '/* BEGIN OMAFIRE FIREFOX BRIDGE */\n@import url("omafire/userContent.css");\n\n/* END OMAFIRE FIREFOX BRIDGE */\n/* SENTINEL checkout content */\n' > "$c/chrome/userContent.css"
  printf 'user_pref("sentinel.oldcheckout", 1);\n' > "$c/user.js"
  printf '\n[Profile7]\nName=oldcheckout\nIsRelative=1\nPath=oldcheckout.default\n' >> "$FF/profiles.ini"
  rm -rf "${SCR:?}/s4-checkout-before"; cp -a "$SB_HOME/src/omafire-theme" "$SCR/s4-checkout-before"
  op $s status-before "$PKG_HEAD" omafire status
  expect $s "status flags the old checkout as outdated" grep -q 'oldcheckout.default (theme checkout, outdated)' "$OP_OUT"
  op $s setup "$PKG_HEAD" omafire setup
  expect $s "setup exits 0" test "$OP_RC" = 0
  expect $s "preserved" test "$OP_PRESERVED" = 0
  expect $s "old payload copy removed from the checkout" test ! -e "$c/chrome/omafire"
  expect $s "checkout userContent keeps its own lines, block gone" \
    test "$(cat "$c/chrome/userContent.css")" = '/* SENTINEL checkout content */'
  expect $s "checkout userChrome keeps the narrowed palette block only" \
    test "$(blocks "$c/chrome/userChrome.css")" = 1
  expect $s "symlinked checkout: tracked files unchanged" \
    diff -r -x 'omafire-*.css' -x .git "$SCR/s4-checkout-before" "$SB_HOME/src/omafire-theme"
  op $s setup-again "$PKG_HEAD" omafire setup
  expect $s "second setup changes nothing" test -z "$(grep -v -e churn -e PRESERVED "$OP_DIFF")"
  op $s status-after "$PKG_HEAD" omafire status
  expect $s "status: theme checkout" grep -q 'oldcheckout.default (theme checkout)$' "$OP_OUT"
  fresh $s oldcheckout "$PKG_HEAD" .mozilla/firefox/oldcheckout.default
}

# ------------------------------------------------------------ invalid input
# invalid CASE BREAK FIX: break the instance, run setup (and sync), expect a
# refusal that changed no profile, then fix and expect setup to succeed.
invalid() {
  local s=s5-invalid c=$1 break_cmd=$2 fix_cmd=$3 cmd=${4:-setup}
  instance "$s-$c"
  note $s "## $c"
  eval "$break_cmd"
  op $s "$c-$cmd" "$PKG_HEAD" omafire $cmd
  expect $s "$c: $cmd exits nonzero" test "$OP_RC" != 0
  expect $s "$c: sentinels and user content preserved" test "$OP_PRESERVED" = 0
  expect $s "$c: no profile file changed" \
    test -z "$(grep -e '.mozilla/' -e 'elsewhere/' -e 'src/' "$OP_DIFF" | grep -v churn)"
  eval "$fix_cmd"
  op $s "$c-fixed" "$PKG_HEAD" omafire setup
  expect $s "$c: after the fix, setup exits 0" test "$OP_RC" = 0
  expect $s "$c: after the fix, preserved" test "$OP_PRESERVED" = 0
}
s5() {
  local s=s5-invalid
  mkdir -p "$EVID/$s"; : > "$EVID/$s/log.md"
  note $s "# S5 Invalid input: each case breaks one input, then fixes it"
  local T='$SB_HOME/.local/state/omarchy/current/theme'
  invalid missing-palette "mv $T/colors.toml $SCR/colors.toml.aside" "mv $SCR/colors.toml.aside $T/colors.toml"
  invalid missing-theme-dir "mv $T $SCR/theme.aside" "mv $SCR/theme.aside $T"
  # A palette with no valid colour is refused, changing nothing.
  invalid malformed-palette "cp $T/colors.toml $SCR/colors.ok; printf 'this is [not toml\nbackground = \"#zzzzzz\"\n' > $T/colors.toml" \
    "cp $SCR/colors.ok $T/colors.toml"
  invalid malformed-palette-sync "printf 'garbage\n' > $T/colors.toml" "cp $LIVE_THEME/colors.toml $T/colors.toml" sync
  invalid duplicate-begin-marker \
    "printf '/* BEGIN OMAFIRE FIREFOX BRIDGE */\n/* BEGIN OMAFIRE FIREFOX BRIDGE */\n/* END OMAFIRE FIREFOX BRIDGE */\n' >> \"\$SB_HOME/$P_SPC/chrome/userChrome.css\"" \
    "sed -i '/OMAFIRE FIREFOX BRIDGE/d' \"\$SB_HOME/$P_SPC/chrome/userChrome.css\""
  invalid end-before-begin \
    "printf '// END OMAFIRE FIREFOX BRIDGE\nuser_pref(\"x\", 1);\n// BEGIN OMAFIRE FIREFOX BRIDGE\n' >> \"\$SB_HOME/$P_PERS/user.js\"" \
    "sed -i '/OMAFIRE FIREFOX BRIDGE/d' \"\$SB_HOME/$P_PERS/user.js\""
  invalid unmanaged-payload-dir \
    "mkdir -p \"\$SB_HOME/$P_PERS/chrome/omafire\"; echo '/* SENTINEL mine */' > \"\$SB_HOME/$P_PERS/chrome/omafire/userChrome.css\"" \
    "mv \"\$SB_HOME/$P_PERS/chrome/omafire\" \"\$SB_HOME/$P_PERS/chrome/my-omafire\""
  invalid symlinked-userjs \
    "mv \"\$SB_HOME/$P_PERS/user.js\" \"\$SB_HOME/$P_PERS/user-real.js\"; ln -s user-real.js \"\$SB_HOME/$P_PERS/user.js\"" \
    "rm \"\$SB_HOME/$P_PERS/user.js\"; mv \"\$SB_HOME/$P_PERS/user-real.js\" \"\$SB_HOME/$P_PERS/user.js\""
  invalid oversized-userjs \
    "head -c 5000000 /dev/zero | tr '\\0' '/' >> \"\$SB_HOME/$P_PERS/user.js\"" \
    "truncate -s 0 \"\$SB_HOME/$P_PERS/user.js\"; printf '// SENTINEL personal user.js\n' > \"\$SB_HOME/$P_PERS/user.js\""
  invalid chrome-is-a-file \
    "printf 'sentinel file\n' > \"\$SB_HOME/$P_GEN/chrome\"" "rm \"\$SB_HOME/$P_GEN/chrome\""
  invalid no-omarchy "ln -s /bin/false $MOCK/omarchy" "rm $MOCK/omarchy"
  fresh $s after-fixes "$PKG_HEAD" "$P_PERS"
  # Missing profile source: no profiles.ini at all; setup is a no-op there.
  instance "$s-no-profiles-ini"; note $s "## no-profiles-ini"
  rm "$FF/profiles.ini"
  op $s no-profiles-ini-setup "$PKG_HEAD" omafire setup
  # (2c7af23: an error naming the profiles.ini it looked for, not a
  # silent success; the hook stays, so setup after Firefox's first start
  # finishes the job)
  expect $s "no-profiles-ini: setup exits 1, names profiles.ini and configures no profile" \
    test "$OP_RC" = 1 -a -n "$(grep 'no Firefox profile found (.*profiles.ini)' "$OP_OUT")" \
      -a -z "$(grep 'Configured Firefox' "$OP_OUT")"
  # Usage errors.
  instance "$s-usage"; note $s "## usage"
  op $s usage-extra-arg "$PKG_HEAD" omafire setup now
  expect $s "extra argument refused (exit 1)" test "$OP_RC" = 1
  op $s usage-unknown "$PKG_HEAD" omafire uninstall
  expect $s "unknown command refused (exit 1)" test "$OP_RC" = 1
  op $s usage-option "$PKG_HEAD" omafire --force
  expect $s "unknown option refused (exit 1)" test "$OP_RC" = 1
}

# --------------------------------------------------------- multiple profiles
s7() {
  local s=s7-multi; instance $s
  note $s "# S7 Multiple profiles: partial failure, accurate report, idempotent retry"
  chmod 555 "$SB_HOME/$P_SPC/chrome"
  op $s setup-one-unwritable "$PKG_HEAD" omafire setup
  expect $s "setup exits nonzero" test "$OP_RC" != 0
  expect $s "preserved" test "$OP_PRESERVED" = 0
  expect $s "profiles before the failing one are reported configured" \
    grep -q "Configured Firefox profile: .*personal.default" "$OP_OUT"
  expect $s "the failing profile is named in the error" grep -q "My Profile.default" "$OP_OUT"
  op $s status-partial "$PKG_HEAD" omafire status
  chmod 755 "$SB_HOME/$P_SPC/chrome"
  op $s setup-retry "$PKG_HEAD" omafire setup
  expect $s "retry exits 0" test "$OP_RC" = 0
  expect $s "retry leaves the already-configured profiles' files unchanged" \
    test -z "$(grep -e 'gen.default/' -e 'personal.default/' "$OP_DIFF" | grep -v -e churn -e omafire-palette -e omafire-content-palette -e omafire-radius -e '/user.js ')"
  expect $s "exactly one managed block per managed file" one_block_each
  # A profile the user broke after setup: does sync still reach the others?
  # (user.js: the one managed file sync validates and rewrites.)
  printf '// END OMAFIRE FIREFOX BRIDGE\n' >> "$SB_HOME/$P_PERS/user.js"
  use_theme catppuccin-latte
  op $s sync-one-malformed "$PKG_HEAD" omafire sync
  expect $s "sync with one malformed profile: exits nonzero, naming the skipped profile" \
    bash -c 'test "$1" != 0 && grep -q "skipped Firefox profile .*personal.default" "$2"' _ "$OP_RC" "$OP_OUT"
  expect $s "sync with one malformed profile: later profiles still get the new palette" \
    grep -q 'My Profile.default/chrome/omafire-palette.css' "$OP_DIFF"
  expect $s "sync with one malformed profile: theme.json still updated for the extension" \
    grep -q 'theme.json' "$OP_DIFF"
  sed -i '$d' "$SB_HOME/$P_PERS/user.js"
  op $s sync-fixed "$PKG_HEAD" omafire sync
  fresh $s spaced "$PKG_HEAD" "$P_SPC"
}

# ------------------------------------------------------- concurrent requests
s8() {
  local s=s8-concurrent; instance $s
  note $s "# S8 Concurrent requests: 20 syncs and 3 setups at once, theme flipping"
  op $s setup "$PKG_HEAD" omafire setup
  rm -rf "${SCR:?}/s8-serial"; cp -a "$SB_HOME" "$SCR/s8-serial"
  op $s burst "$PKG_HEAD" bash -c '
    pids=()
    for i in $(seq 20); do omafire sync >/dev/null 2>&1 & pids+=($!); done
    for i in 1 2 3; do omafire setup >/dev/null 2>&1 & pids+=($!); done
    fails=0; for p in "${pids[@]}"; do wait "$p" || fails=$((fails + 1)); done
    echo "runs: ${#pids[@]}, nonzero exits: $fails"'
  expect $s "every concurrent run exits 0" grep -q 'nonzero exits: 0' "$OP_OUT"
  expect $s "preserved" test "$OP_PRESERVED" = 0
  expect $s "exactly one managed block per managed file" one_block_each
  expect $s "no staging or temp leftovers" no_leftovers
  local p f
  for p in "${CONFIGURED[@]}"; do
    for f in user.js chrome/userChrome.css chrome/userContent.css chrome/omafire-palette.css; do
      expect $s "$p/$f identical to the serial result" identical "$SCR/s8-serial/${p#./}/$f" "$SB_HOME/$p/$f"
    done
  done
  # The lock is what serialises them: a held lock makes sync wait.
  op $s lock-held "$PKG_HEAD" bash -c '
    flock "$HOME/.local/state/omafire/lock" sleep 3 & sleep 0.5
    start=$(date +%s.%N); omafire sync; end=$(date +%s.%N); wait
    python3 -c "import sys; print(\"sync waited %.1fs for the held lock\" % (float(sys.argv[2]) - float(sys.argv[1])))" "$start" "$end"'
  expect $s "sync waits for a held lock" grep -Eq 'waited (2\.[5-9]|[3-9])' "$OP_OUT"
  fresh $s personal "$PKG_HEAD" "$P_PERS"
}

# ------------------------------------------------------------------ removal
s9() {
  local s=s9-removal; instance $s
  note $s "# S9 Removal: omafire remove, then the package gone (loader hidden)"
  local orig=$SCR/s9-orig; rm -rf "${orig:?}"; cp -a "$SB_HOME" "$orig"
  op $s setup "$PKG_HEAD" omafire setup
  fresh $s personal-configured "$PKG_HEAD" "$P_PERS"
  op $s remove "$PKG_HEAD" omafire remove
  expect $s "remove exits 0" test "$OP_RC" = 0
  expect $s "remove preserved sentinels and user-owned content" test "$OP_PRESERVED" = 0
  local p
  for p in "${CONFIGURED[@]}"; do
    expect $s "$p: no omafire file or block left" no_owned_files "$p"
  done
  for p in chrome/userChrome.css chrome/userContent.css chrome/customChrome.css user.js sentinel.txt; do
    expect $s "personal $p byte-identical to before setup" identical "$orig/$P_PERS/$p" "$SB_HOME/$P_PERS/$p"
  done
  expect $s "theme hook removed, the user's own hook kept" \
    test ! -e "$SB_HOME/.config/omarchy/hooks/theme-set.d/omafire" -a -e "$SB_HOME/.config/omarchy/hooks/theme-set.d/10-mine"
  expect $s "theme state removed, backups kept" \
    test ! -e "$SB_HOME/.local/state/omafire/theme.json" -a -d "$SB_HOME/.local/state/omafire/backups"
  expect $s "checkout untouched by remove apart from generated files" \
    test -z "$(git -C "$SB_HOME/src/omafire-theme" status --porcelain)"
  note $s "Leftovers in the personal profile after remove (Firefox-owned):"
  note $s "$(printf '```\n'; grep -h -e omafire -e 'browser.display' -e 'ui.accentcolor' -e legacyUserProfile "$SB_HOME/$P_PERS/prefs.js" | head -20; ls "$SB_HOME/$P_PERS/extensions" 2>&1; printf '```')"
  expect $s "prefs.js no longer marks the profile omafire-managed" \
    not grep -q '"omafire.managed", true' "$SB_HOME/$P_PERS/prefs.js"
  expect $s "prefs.js keeps no omafire.* pref but the scripts switches" \
    no_owned_prefs "$SB_HOME/$P_PERS/prefs.js"
  op $s remove-again "$PKG_HEAD" omafire remove
  expect $s "second remove exits 0 and changes nothing" \
    test "$OP_RC" = 0 -a -z "$(grep -v -e churn -e PRESERVED "$OP_DIFF")"
  # Package still installed (loader present), profile no longer set up.
  fresh $s personal-removed-pkg-kept "$PKG_HEAD" "$P_PERS"
  # pacman -R emulated: the loader's files hidden from Firefox.
  SB_LOADER=none fresh $s personal-pkg-removed "$PKG_HEAD" "$P_PERS"
  SB_LOADER=none fresh $s generated-pkg-removed "$PKG_HEAD" "$P_GEN"
}

# ----------------------------------------------------------------- rollback
s10() {
  local s=s10-rollback; instance $s
  note $s "# S10 Rollback: HEAD back to v0.6.6 with newer user edits; backup-set restore"
  op $s setup-head "$PKG_HEAD" omafire setup
  # Newer, unrelated user edits after the managed state was written.
  printf '/* SENTINEL newer edit */\n#urlbar { color: red; }\n' >> "$SB_HOME/$P_PERS/chrome/userChrome.css"
  printf 'user_pref("sentinel.newer", 3);\n' >> "$SB_HOME/$P_PERS/user.js"
  printf '/* SENTINEL newer custom */\n' >> "$SB_HOME/$P_PERS/chrome/customChrome.css"
  op $s rollback-setup-v066 "$PKG_PREV" omafire setup
  expect $s "rollback (older package + setup) exits 0" test "$OP_RC" = 0
  expect $s "rollback preserved newer user edits" test "$OP_PRESERVED" = 0
  expect $s "newer userChrome edit still there" grep -q 'SENTINEL newer edit' "$SB_HOME/$P_PERS/chrome/userChrome.css"
  expect $s "newer user.js edit still there" grep -q 'sentinel.newer' "$SB_HOME/$P_PERS/user.js"
  local p
  for p in "${CONFIGURED[@]}"; do
    expect $s "payload in $p is v0.6.6's again" payload_is "$PKG_PREV" "$p"
  done
  expect $s "exactly one managed block per managed file" one_block_each
  fresh $s personal-rolled-back "$PKG_PREV" "$P_PERS"
  op $s roll-forward-head "$PKG_HEAD" omafire setup
  expect $s "roll forward preserved" test "$OP_PRESERVED" = 0
  expect $s "payload is HEAD's again" payload_is "$PKG_HEAD" "$P_PERS"

  # Backup-set restore: undo a setup on one file by copying it back.
  instance $s-backup
  op $s setup-for-backup "$PKG_HEAD" omafire setup
  local set
  set=$(ls -d "$SB_HOME/.local/state/omafire/backups/"*-setup-* | head -1)
  note $s "Backup set: ${set#"$SCR"/}"
  note $s "$(printf '```\n'; (cd "$set" && find . -type f | sort); printf '```')"
  local f=$SB_HOME/$P_PERS/chrome/userChrome.css
  expect $s "backup holds the pre-setup userChrome.css" identical "$SCR/fixture/home/$P_PERS/chrome/userChrome.css" "$set$f"
  cp "$set$f" "$f"
  expect $s "restored userChrome.css equals the pre-setup file" identical "$SCR/fixture/home/$P_PERS/chrome/userChrome.css" "$f"
  op $s status-after-restore "$PKG_HEAD" omafire status
  expect $s "status reports the restored profile as incomplete" grep -q 'personal.default (incomplete)' "$OP_OUT"
  fresh $s personal-restored "$PKG_HEAD" "$P_PERS"
}

rows=("$@")
[[ ${#rows[@]} -gt 0 ]] || rows=(s1 s2 s3 s4 s5 s7 s8 s9 s10)
for row in "${rows[@]}"; do
  rm -rf "${EVID:?}/$row"-*
  "$row"
done
lc_output_done || true
echo "checks failed: $CHECKS_FAILED"
