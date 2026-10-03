#!/bin/bash
# §2 "Interrupted operation": failures injected at the write boundaries of
# setup, upgrade, remove and sync (enumerated from cmd/omafire, listed in
# BOUNDARIES below), each in a fresh copy of the fixture. strace -P scopes an
# injection to the syscalls that touch one path, so each case hits exactly
# its boundary; the trace line that was hit is logged.
#   kill   SIGKILL on entry: the process dies before the syscall runs
#   after  the syscall completes, then the process is SIGKILLed (delay_exit
#          holds it there)
#   ERRNO  the syscall fails with that errno
# After each injection: status, leftovers, then the same command again
# (recovery) compared with an uninterrupted run.
# Usage: tests/lifecycle/interrupt.sh [CASE...]; PKG=... overrides the package.

set -euo pipefail
. tests/lifecycle/env.sh
PKG=${PKG:-$PKG_HEAD}
S=${S:-s6-interrupt}
P=.mozilla/firefox/personal.default
G=.mozilla/firefox/gen.default
LOCK=.local/state/omafire/lock

# name|prestate|command|mode|syscalls|target (relative to HOME)|what the boundary is
BOUNDARIES='
c01|none|setup|EIO|flock|'$LOCK'|run lock (acquireLock)
c02|none|setup|hookfail|-|-|omarchy hook install fails (first external step)
c03|none|setup|EACCES|mkdirat|'$G'/chrome|create chrome/ in a profile without one
c04|none|setup|kill|renameat|'$G'/chrome/omafire|first payload install: staged tree renamed into place
c05|none|setup|EIO|renameat|'$G'/chrome/omafire|first payload install: rename fails
c06|none|setup|kill|renameat|'$P'/chrome/userChrome.css|userChrome.css managed block (after its backup)
c07|none|setup|EIO|renameat|'$P'/chrome/userChrome.css|userChrome.css rename fails
c08|none|setup|after|renameat|'$P'/chrome/userChrome.css|between userChrome.css and userContent.css
c09|none|setup|kill|renameat|'$P'/user.js|user.js bootstrap prefs block
c10|none|setup|kill|renameat|'$P'/chrome/omafire-palette.css|generated palette (setup'"'"'s sync)
c11|none|setup|kill|renameat|.local/state/omafire/theme.json|theme.json for the extension (last write)
c12|none|setup|EIO|symlinkat|.config/omarchy/plugins/omafire|shell plugin link
c13|none|setup|efbig|-|-|payload file write fails (RLIMIT_FSIZE 4 KiB: EFBIG mid-copy)
u01|prev|setup|EIO|renameat2|'$P'/chrome/omafire|upgrade: atomic payload exchange fails (two-rename fallback)
u02|prev|setup|psd|renameat2,renameat|'$P'/chrome/omafire|upgrade: no exchange and EXDEV rename (psd fuse-overlayfs path)
u03|prev|setup|fallback-after|renameat2,renameat|'$P'/chrome/omafire|upgrade fallback: killed between old-out and new-in renames
u04|prev|setup|psd-kill|renameat2,renameat,unlinkat|'$P'/chrome/omafire/userContent.css|upgrade psd path: killed while deleting the old payload
u05|prev|setup|kill|renameat2|'$P'/chrome/omafire|upgrade: killed at the payload exchange
r01|head|remove|kill|renameat|'$P'/chrome/userChrome.css|remove: userChrome.css block removal
r02|head|remove|kill|unlinkat|'$G'/user.js|remove: user.js holding only our block is deleted
r03|head|remove|kill|unlinkat|'$P'/chrome/omafire/userContent.css|remove: killed while deleting the payload
r04|head|remove|kill|unlinkat|.config/omarchy/hooks/theme-set.d/omafire|remove: theme hook unlink
y01|theme|sync|kill|renameat|'$P'/user.js|sync: user.js palette prefs
y02|theme|sync|EIO|renameat|'$P'/chrome/omafire-palette.css|sync: palette rename fails
y03|theme|sync|kill|renameat|.local/state/omafire/theme.json|sync: theme.json (after every profile)
'

# A reference: the uninterrupted result of the same command.
reference() {   # reference PRESTATE COMMAND -> $SCR/ref-PRESTATE-COMMAND/home
  local ref=$SCR/ref-$1-$2
  [[ -d $ref ]] && return
  local keep=$SB_HOME
  instance "ref-$1-$2"; prestate "$1"; sandbox "$PKG" omafire "$2" >/dev/null 2>&1 || true
  rm -rf "${ref:?}"; mv "$SCR/runs/ref-$1-$2" "$ref"
  SB_HOME=$keep
}
prestate() {
  case $1 in
    none) ;;
    prev) sandbox "$PKG_PREV" omafire setup >/dev/null 2>&1 ;;
    head) sandbox "$PKG" omafire setup >/dev/null 2>&1 ;;
    theme)
      sandbox "$PKG" omafire setup >/dev/null 2>&1
      rm -rf "${SB_HOME:?}/.local/state/omarchy/current/theme"
      cp -rL /usr/share/omarchy/themes/catppuccin-latte "$SB_HOME/.local/state/omarchy/current/theme"
      echo catppuccin-latte > "$SB_HOME/.local/state/omarchy/current/theme.name" ;;
  esac
}
# Files whose recovered content must equal the uninterrupted run's.
same_as_reference() {
  local ref=$1/home f
  for f in "$P/user.js" "$P/chrome/userChrome.css" "$P/chrome/userContent.css" "$P/chrome/omafire-palette.css" \
      "$G/user.js" "$G/chrome/userChrome.css" .local/state/omafire/theme.json; do
    if [[ -e $ref/$f || -e $SB_HOME/$f ]]; then
      cmp -s "$ref/$f" "$SB_HOME/$f" || { echo "differs: $f"; return 1; }
    fi
  done
  if [[ -d $ref/$P/chrome/omafire ]]; then diff -r "$ref/$P/chrome/omafire" "$SB_HOME/$P/chrome/omafire" >/dev/null; fi
}
leftovers() { (cd "$SB_HOME" && find . -name '.omafire.*' | sort | sed 's|/\.omafire\.\([a-z]*\)\.[0-9]*|/.omafire.\1.*|; s|/\.omafire\.[0-9]*$|/.omafire.<tmp>|' | uniq -c); }

inject() {
  local id=$1 pre=$2 cmd=$3 mode=$4 calls=$5 target=$6 what=$7
  instance "$S-$id"; prestate "$pre"
  local abs=$SB_HOME/$target trace=$SCR/strace/$S-$id.strace
  mkdir -p "$SCR/strace"; rm -f "$trace"
  local st=(strace -f -qq -e signal=none -o "$trace")
  [[ $target != - ]] && st+=(-P "$abs")
  [[ $calls != - ]] && st+=(-e "trace=$calls")
  note $S ""
  note $S "## $id: $what"
  note $S "Boundary: \`$calls\` on \`$target\`; injection: $mode; before: $pre."
  case $mode in
    kill) op $S "$id-inject" "$PKG" "${st[@]}" -e "inject=$calls:signal=KILL" omafire "$cmd" ;;
    after|fallback-after)
      local inj=(-e "inject=$calls:delay_exit=8000000")
      [[ $mode == fallback-after ]] && inj=(-e inject=renameat2:error=EIO -e inject=renameat:delay_exit=8000000)
      op $S "$id-inject" "$PKG" bash -c '"$@" & s=$!; sleep 5
        pkill -KILL -x -P "$s" omafire; wait "$s"; exit $?' sh "${st[@]}" "${inj[@]}" omafire "$cmd" ;;
    psd) op $S "$id-inject" "$PKG" "${st[@]}" -e inject=renameat2:error=EINVAL -e inject=renameat:error=EXDEV:when=1 omafire "$cmd" ;;
    psd-kill)
      # The exchange and rename fail on the payload; the kill lands on the
      # old payload's userContent.css while it is being deleted.
      st=(strace -f -qq -e signal=none -o "$trace" -P "$SB_HOME/$P/chrome/omafire" -P "$abs" -e "trace=$calls")
      op $S "$id-inject" "$PKG" "${st[@]}" -e inject=renameat2:error=EINVAL -e inject=renameat:error=EXDEV \
        -e inject=unlinkat:signal=KILL omafire "$cmd" ;;
    hookfail)
      printf '#!/bin/sh\n[ "$1" = hook ] && exit 1\nexec /usr/bin/omarchy "$@"\n' > "$MOCK/omarchy"; chmod 755 "$MOCK/omarchy"
      op $S "$id-inject" "$PKG" omafire "$cmd"
      rm -f "$MOCK/omarchy" ;;
    efbig) op $S "$id-inject" "$PKG" bash -c 'ulimit -f 4; exec omafire "$1"' sh "$cmd" ;;
    *) op $S "$id-inject" "$PKG" "${st[@]}" -e "inject=$calls:error=$mode" omafire "$cmd" ;;
  esac
  local rc=$OP_RC preserved=$OP_PRESERVED
  [[ -f $trace ]] && sed "s|$SCR/runs/[^/]*/home/||g" "$trace" > "$EVID/$S/$id.strace"
  if [[ -s $trace ]]; then
    note $S "Hit: \`$(grep -m1 -E 'INJECTED|= \?|DELAYED|killed' "$trace" | sed "s|$SCR/runs/[^/]*/home/||g" | cut -c1-220)\`"
  fi
  expect $S "$id: interrupted run kept sentinels and user-owned content" test "$preserved" = 0
  note $S "Leftovers: $(leftovers | tr '\n' ';' | sed 's/;$//')"
  op $S "$id-status" "$PKG" omafire status
  STATE_LINE=$(grep -e 'personal.default (' "$OP_OUT" | sed 's|.*(|(|')
  note $S "State after: personal.default $STATE_LINE"
  # A browser on the interrupted state, then on the recovered one.
  local fresh=0
  [[ " ${FRESH_IDS:-c08 u03 r03 y01} " == *" $id "* ]] && fresh=1
  if ((fresh)); then
    ffstart $S "$id-interrupted" "$PKG" "$SB_HOME/$P"
    expect $S "$id: Firefox starts on the interrupted state" test "$FF_ALIVE" = yes
  fi
  op $S "$id-recover" "$PKG" omafire "$cmd"
  expect $S "$id: rerunning \`omafire $cmd\` recovers (exit 0)" test "$OP_RC" = 0
  expect $S "$id: recovery kept sentinels and user-owned content" test "$OP_PRESERVED" = 0
  expect $S "$id: no leftovers after recovery" test -z "$(find "$SB_HOME" -name '.omafire.*' -print -quit)"
  reference "$pre" "$cmd"
  expect $S "$id: recovered files equal the uninterrupted run's" same_as_reference "$SCR/ref-$pre-$cmd"
  if ((fresh)); then
    ffstart $S "$id-recovered" "$PKG" "$SB_HOME/$P"
    expect $S "$id: Firefox starts on the recovered state" test "$FF_ALIVE" = yes
  fi
  RESULTS+=("| $id | $what | $mode | $rc | $STATE_LINE | $OP_RC |")
}

mkdir -p "$EVID/$S"
want=" $* "
RESULTS=()
[[ $# -eq 0 ]] && { rm -f "${EVID:?}/${S:?}"/*; rm -rf "${SCR:?}"/ref-*; }
: >> "$EVID/$S/log.md"
note $S "# S6 Interrupted operation (package: ${PKG##*/})"
while IFS='|' read -r id pre cmd mode calls target what; do
  [[ -z $id ]] && continue
  [[ $# -gt 0 && $want != *" $id "* ]] && continue
  inject "$id" "$pre" "$cmd" "$mode" "$calls" "$target" "$what"
done <<< "$BOUNDARIES"
{
  echo
  echo "| case | boundary | injection | exit | state after (personal) | recovery exit |"
  echo "| --- | --- | --- | --- | --- | --- |"
  printf '%s\n' "${RESULTS[@]}"
} >> "$EVID/$S/log.md"
lc_output_done || true
echo "checks failed: $CHECKS_FAILED"
