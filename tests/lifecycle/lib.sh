# Lifecycle harness (omafire-v2z.1): runs the staged package's omafire in a
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
  # is test-launch's private headless sway.
  if [[ -n ${SB_WAYLAND:-} ]]; then
    extra+=(--setenv XDG_RUNTIME_DIR "$SB_WAYLAND" --setenv WAYLAND_DISPLAY wayland-1
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
  bwrap --ro-bind / / --dev /dev --proc /proc \
    --tmpfs /run/user --tmpfs /home \
    --bind "$SCR" "$SCR" \
    --ro-bind "$pkg/usr/bin/omafire" /usr/bin/omafire \
    --ro-bind "$pkg/usr/share/omafire" /usr/share/omafire \
    --ro-bind "$pkg/usr/lib/omafire" /usr/lib/omafire \
    --ro-bind "$pkg/usr/lib/mozilla/native-messaging-hosts/org.omarchy.omafox.json" \
      /usr/lib/mozilla/native-messaging-hosts/org.omarchy.omafox.json \
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
LC_RT=/tmp/test-launch-rt-$UID
lc_sway() { swaymsg -s "$(ls "$LC_RT"/sway-ipc.*.sock | head -1)" "$@"; }

# lc_output: a headless output of our own in test-launch's sway (as fxlab
# does), so no other session's window lands in our screenshots.
lc_output() {
  [[ -n ${LC_OUTPUT:-} ]] && return
  test-launch true >/dev/null 2>&1 || true   # starts the session if needed
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
  local rt=$LC_RT pidfile=$SCR/ff.pid alive=no
  mkdir -p "$dir"
  rm -f "$pidfile"
  lc_output
  SB_WAYLAND=$rt sandbox "$pkg" sh -c 'firefox --no-remote --profile "$1" about:blank & echo $! > "$2"; wait' \
    sh "$profile" "$pidfile" > "$dir/ff-$label.log" 2>&1 &
  local runner=$! i
  for i in $(seq 50); do [[ -s $pidfile ]] && break; sleep 0.1; done
  [[ -s $pidfile ]] && lc_sway "assign [pid=$(cat "$pidfile")] workspace $LC_WORKSPACE" >/dev/null
  sleep 3
  [[ -s $pidfile ]] && lc_sway "[pid=$(cat "$pidfile")] move container to workspace $LC_WORKSPACE" >/dev/null 2>&1
  sleep "${FF_SETTLE:-12}"
  if [[ -f $pidfile ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then alive=yes; fi
  XDG_RUNTIME_DIR=$rt WAYLAND_DISPLAY=wayland-1 grim -o "$LC_OUTPUT" "$dir/ff-$label.png" 2>/dev/null || true
  [[ -f $pidfile ]] && kill -TERM "$(cat "$pidfile")" 2>/dev/null
  wait "$runner" 2>/dev/null || true
  local addon=no
  grep -q 'omafire' "$profile/extensions.json" 2>/dev/null && addon=yes
  FF_ALIVE=$alive
  # Personal CSS markers: #ff00ff from userChrome.css, #00ff00 from
  # customChrome.css (the personal fixture's sentinel rules).
  local marks
  marks=$(python3 -c 'import sys; from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); px = list(im.getdata())
m = sum(1 for r, g, b in px if r > 180 and g < 70 and b > 180)
gr = sum(1 for r, g, b in px if r < 70 and g > 120 and b < 70)
print("magenta(userChrome)=%d green(customChrome)=%d" % (m, gr))' "$dir/ff-$label.png" 2>/dev/null)
  FF_MARKS=$marks
  {
    printf '\n#### fresh Firefox: %s\n\n' "$label"
    printf -- '- profile: %s\n- package loader: %s\n' "${profile#"$SCR"/}" "${SB_LOADER:-${pkg##*/}}"
    printf -- '- running after %ss: %s\n- Omafire extension in extensions.json: %s\n' "${FF_SETTLE:-12}" "$alive" "$addon"
    printf -- '- personal CSS pixels: %s\n- screenshot: %s\n' "$marks" "$dir/ff-$label.png"
  } >> "$dir/log.md"
}
