# shellcheck shell=bash
# Sourced: FF, OP_* and FF_* are results for the scenario scripts to read.
# shellcheck disable=SC2034
# Lifecycle harness: runs the staged package's omafire in a
# bubblewrap sandbox where / is read-only and only the scratch root is
# writable, so no run can reach the live home, profile or psd mount.
# Not part of tests/run.sh: it needs bwrap, strace, makepkg and Firefox.

: "${SCR:?SCR (scratch root) must be set}"
SB_HOME=${SB_HOME:-$SCR/home}
FF=$SB_HOME/.mozilla/firefox
MOCK=$SCR/mockbin

# sandbox PKG CMD...: run CMD with the staged package PKG (an extracted
# package root) bound over the system's omafire paths.
sandbox() {
  local pkg=$1; shift
  local extra=()
  # A browser start: the staged package's Firefox loader replaces the
  # host's (SB_LOADER=none: no loader, as after pacman -R), and the display
  # is test-launch's private headless sway. SB_WAYLAND is its socket, the
  # only thing of the user's runtime dir the sandbox gets (/run/user is a
  # tmpfs in it): bound into a runtime dir of the sandbox's own, on that
  # tmpfs so the socket path stays within sun_path's 108 bytes.
  if [[ -n ${SB_WAYLAND:-} ]]; then
    extra+=(--perms 0700 --dir /run/user/lc --bind "$SB_WAYLAND" "/run/user/lc/${SB_WAYLAND##*/}"
      --setenv XDG_RUNTIME_DIR /run/user/lc --setenv WAYLAND_DISPLAY "${SB_WAYLAND##*/}"
      --setenv MOZ_ENABLE_WAYLAND 1)
  fi
  if [[ ${SB_LOADER:-} == none ]]; then
    extra+=(--ro-bind /dev/null /usr/lib/firefox/defaults/pref/omafire-prefs.js
      --ro-bind /dev/null /usr/lib/firefox/omafire.cfg)
  elif [[ -n ${SB_WAYLAND:-} ]]; then
    extra+=(--ro-bind "$pkg/usr/lib/firefox/omafire.cfg" /usr/lib/firefox/omafire.cfg
      --ro-bind "$pkg/usr/lib/firefox/omafire" /usr/lib/firefox/omafire
      --ro-bind "$pkg/usr/lib/firefox/defaults/pref/omafire-prefs.js"
        /usr/lib/firefox/defaults/pref/omafire-prefs.js)
  fi
  # Releases before 0.7 ship the native host; setup refuses without it.
  local host=usr/lib/mozilla/native-messaging-hosts/org.omarchy.omafox.json
  if [[ -e $pkg/usr/lib/omafire ]]; then
    extra+=(--ro-bind "$pkg/usr/lib/omafire" /usr/lib/omafire)
  fi
  if [[ -e $pkg/$host ]]; then
    extra+=(--ro-bind "$pkg/$host" "/$host")
  fi
  # bwrap binds only onto paths the read-only host root has, and can't
  # create one under root-owned /usr. On a host whose own package no longer
  # has those, /usr is an overlay (before any bind under it) whose upper
  # layer, ours, already holds the mount points.
  local root=(--ro-bind / /)
  if [[ -e $pkg/usr/lib/omafire && ! -d /usr/lib/omafire ]] || [[ -e $pkg/$host && ! -e /$host ]]; then
    local ovl=$SCR/usr-overlay up=${host#usr/}
    rm -rf "$ovl" && mkdir -p "$ovl/upper/lib/omafire" "$ovl/upper/${up%/*}" "$ovl/work"
    : > "$ovl/upper/$up"
    root+=(--overlay-src /usr --overlay "$ovl/upper" "$ovl/work" /usr)
  fi
  bwrap "${root[@]}" --dev /dev --proc /proc \
    --tmpfs /run/user --tmpfs /home \
    --bind "$SCR" "$SCR" \
    --ro-bind "$pkg/usr/bin/omafire" /usr/bin/omafire \
    --ro-bind "$pkg/usr/share/omafire" /usr/share/omafire \
    --clearenv --setenv HOME "$SB_HOME" --setenv USER "$USER" \
    --setenv PATH "$MOCK:/usr/bin" --setenv LANG C.UTF-8 \
    --setenv XDG_RUNTIME_DIR /run/user/nobody --setenv TMPDIR "$SCR/tmp" \
    "${extra[@]}" --chdir "$SB_HOME" -- "$@"
}

# op SCENARIO LABEL PKG CMD...: run CMD in the sandbox around manifests,
# appending the command, exit status, output and manifest diff to
# $EVID/SCENARIO/log.md. Sets OP_RC and OP_PRESERVED (0 when the diff found
# no violation).
op() {
  local scenario=$1 label=$2 pkg=$3; shift 3
  local dir=$EVID/$scenario n
  mkdir -p "$dir"
  n=$(printf '%02d' $(( $(find "$dir" -maxdepth 1 -name '*.before.json' | wc -l) + 1 )))
  python3 "$REPO/tests/lifecycle/manifest.py" snap "$SB_HOME" "$dir/$n-$label.before.json"
  set +e
  sandbox "$pkg" "$@" > "$dir/$n-$label.out" 2>&1
  OP_RC=$?
  set -e
  python3 "$REPO/tests/lifecycle/manifest.py" snap "$SB_HOME" "$dir/$n-$label.after.json"
  python3 "$REPO/tests/lifecycle/manifest.py" diff "$dir/$n-$label.before.json" "$dir/$n-$label.after.json" \
    > "$dir/$n-$label.diff" 2>&1
  OP_PRESERVED=$?
  OP_DIFF=$dir/$n-$label.diff OP_OUT=$dir/$n-$label.out
  {
    printf '\n### %s %s\n\n' "$n" "$label"
    printf '```\n$ %s    # package: %s, HOME=%s\nexit %s\n' "$*" "${pkg##*/}" "${SB_HOME#"$SCR"/}" "$OP_RC"
    cat "$dir/$n-$label.out"
    printf -- '--- manifest diff (%s)\n' "$n-$label.diff"
    grep -v '(firefox/backup churn)' "$dir/$n-$label.diff" | grep -v -e '^PRESERVED' -e 'VIOLATION' | head -40 || true
    grep -e '^PRESERVED' -e 'VIOLATION' "$dir/$n-$label.diff" || true
    printf '```\n'
  } >> "$dir/log.md"
}

# expect SCENARIO WHAT CMD...: record a check in the scenario log; failures
# are counted, not fatal, so every row gets its evidence.
CHECKS_FAILED=0
expect() {
  local scenario=$1 what=$2; shift 2
  if "$@" >/dev/null 2>&1; then
    printf -- '- PASS: %s\n' "$what" >> "$EVID/$scenario/log.md"
  else
    printf -- '- FAIL: %s\n' "$what" >> "$EVID/$scenario/log.md"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
    echo "FAIL [$scenario]: $what" >&2
  fi
}
note() { mkdir -p "$EVID/$1"; printf '%s\n' "$2" >> "$EVID/$1/log.md"; }

# ffstart SCENARIO LABEL PKG PROFILE: a fresh Firefox on PROFILE in the
# sandbox, shown on test-launch's headless output; screenshot after it
# settles, then a TERM quit. Records whether it stayed up, whether the
# packaged loader installed the Omafire extension, and the screenshot.
# test-launch's headless display, from the record it keeps of it; refused
# when it names the desktop's Wayland socket.
LC_ENV=${XDG_STATE_HOME:-$HOME/.local/state}/test-launch/display/env.json
lc_display() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$LC_ENV" "$1"
}
lc_sway() { swaymsg -s "$(lc_display SWAYSOCK)" "$@"; }
lc_wayland() {
  local wl; wl=$(lc_display WAYLAND_DISPLAY) || return 1
  if [[ $wl == "${WAYLAND_DISPLAY:-}" && ${SWAYSOCK:-} != "$(lc_display SWAYSOCK)" ]]; then
    echo "refusing: test-launch's display is the desktop's ($wl)" >&2; return 1
  fi
  printf '%s\n' "$wl"
}

# lc_output: a headless output of our own in test-launch's sway (as fxlab
# does), so no other session's window lands in our screenshots.
lc_output() {
  [[ -n ${LC_OUTPUT:-} ]] && return
  test-launch -- true >/dev/null 2>&1 || true   # starts the display if needed
  local before
  before=$(lc_sway -t get_outputs | python3 -c 'import json,sys; print(" ".join(o["name"] for o in json.load(sys.stdin)))')
  lc_sway create_output >/dev/null
  LC_OUTPUT=$(lc_sway -t get_outputs | python3 -c 'import json,sys; b=sys.argv[1].split(); print([o["name"] for o in json.load(sys.stdin) if o["name"] not in b][0])' "$before")
  lc_sway "output $LC_OUTPUT mode 1600x1000" >/dev/null
  LC_WORKSPACE=$(lc_sway -t get_outputs | python3 -c 'import json,sys; print([o["current_workspace"] for o in json.load(sys.stdin) if o["name"]==sys.argv[1]][0])' "$LC_OUTPUT")
}
lc_output_done() { [[ -n ${LC_OUTPUT:-} ]] && lc_sway "output $LC_OUTPUT unplug" >/dev/null; LC_OUTPUT=; }

ffstart() {
  local scenario=$1 label=$2 pkg=$3 profile=$4 dir=$EVID/$1
  local pidfile=$SCR/ff.pid alive=no wl
  mkdir -p "$dir"
  rm -f "$pidfile"
  lc_output
  wl=$(lc_wayland) || return 1
  SB_WAYLAND=$XDG_RUNTIME_DIR/$wl sandbox "$pkg" sh -c 'firefox --no-remote --profile "$1" about:blank & echo $! > "$2"; wait' \
    sh "$profile" "$pidfile" > "$dir/ff-$label.log" 2>&1 &
  local runner=$!
  for _ in $(seq 50); do [[ -s $pidfile ]] && break; sleep 0.1; done
  [[ -s $pidfile ]] && lc_sway "assign [pid=$(cat "$pidfile")] workspace $LC_WORKSPACE" >/dev/null || true
  sleep 3
  [[ -s $pidfile ]] && lc_sway "[pid=$(cat "$pidfile")] move container to workspace $LC_WORKSPACE" >/dev/null 2>&1 || true
  sleep "${FF_SETTLE:-12}"
  if [[ -f $pidfile ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then alive=yes; fi
  WAYLAND_DISPLAY=$wl grim -o "$LC_OUTPUT" "$dir/ff-$label.png" 2>/dev/null || true
  [[ -f $pidfile ]] && kill -TERM "$(cat "$pidfile")" 2>/dev/null || true
  wait "$runner" 2>/dev/null || true
  local addon=no
  grep -q 'omafire' "$profile/extensions.json" 2>/dev/null && addon=yes
  FF_ALIVE=$alive
  # Personal CSS markers: #ff00ff from userChrome.css, #00ff00 from
  # customChrome.css (the personal fixture's sentinel rules).
  local marks
  # (raw RGB from ImageMagick: no Python imaging library needed)
  marks=$(magick "$dir/ff-$label.png" -depth 8 rgb:- 2>/dev/null | python3 -c 'import sys
b = sys.stdin.buffer.read(); px = list(zip(b[0::3], b[1::3], b[2::3]))
if not px: sys.exit(1)
m = sum(1 for r, g, b in px if r > 180 and g < 70 and b > 180)
gr = sum(1 for r, g, b in px if r < 70 and g > 120 and b < 70)
print("magenta(userChrome)=%d green(customChrome)=%d" % (m, gr))') || marks="(no screenshot)"
  FF_MARKS=$marks
  {
    printf '\n#### fresh Firefox: %s\n\n' "$label"
    printf -- '- profile: %s\n- package loader: %s\n' "${profile#"$SCR"/}" "${SB_LOADER:-${pkg##*/}}"
    printf -- '- running after %ss: %s\n- Omafire extension in extensions.json: %s\n' "${FF_SETTLE:-12}" "$alive" "$addon"
    printf -- '- personal CSS pixels: %s\n- screenshot: %s\n' "$marks" "$dir/ff-$label.png"
  } >> "$dir/log.md"
}
