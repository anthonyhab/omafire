#!/bin/bash
# Launcher stress sweep: every layout's launcher with long-
# titled switch-to-tab results, measured by geometry.js and states.js.
# Needs a browser, so it is not part of tests/run.sh. Against a running
# fxlab host session of this worktree:
#
#   export FXLAB_STATE=$(mktemp -d)
#   fxlab up --port <free> --output new --theme $PWD/theme --scripts $PWD/chrome \
#     [--pref ui.textScaleFactor=125]
#   tests/launcher/sweep.sh --size 900x700 OUTDIR
#
# Runs uidensity 0 and 1; writes <layout>.json/.png and <layout>.states.json/
# .png per density under OUTDIR; exits 1 if any cell fails.
set -uo pipefail

FXLAB=${FXLAB:-$HOME/Projects/omarchy-firefox-bundle/tools/fxlab}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SIZE=
if [[ ${1:-} == --size ]]; then SIZE=$2; shift 2; fi
OUT=${1:?usage: sweep.sh [--size WxH] OUTDIR}
mkdir -p "$OUT"
F() { "$FXLAB" "$@"; }

# Only a session this caller started: the default state dir may be another
# agent's, and the sweep rewrites prefs and opens tabs in it.
[[ -n ${FXLAB_STATE:-} ]] || { echo "sweep.sh: set FXLAB_STATE to your own fxlab session" >&2; exit 2; }
mode=$(F status | python3 -c 'import json,sys; print(json.load(sys.stdin).get("mode", ""))') || exit 2
[[ $mode == host || $mode == vm ]] || { echo "sweep.sh: session mode '$mode' is not host or vm" >&2; exit 2; }

# fxlab up has no window size: resize its headless output directly.
if [[ -n $SIZE ]]; then
  output=$(python3 -c 'import json,os,sys; print(json.load(open(os.environ["FXLAB_STATE"] + "/session.json"))["output"])')
  rt=/tmp/test-launch-rt-$(id -u)
  XDG_RUNTIME_DIR=$rt WAYLAND_DISPLAY=wayland-1 swaymsg -s "$(find "$rt" -maxdepth 1 -name 'sway-ipc.*.sock' -print -quit)" \
    output "$output" mode "$SIZE" >/dev/null
  F settle 1000 >/dev/null
fi

# Long-titled fixture pages over http (file:// pages get no switch-to-tab).
fixtures=$(mktemp -d)
for i in $(seq 1 12); do
  printf '<!doctype html><title>Fixture %s: an extraordinarily long page title that keeps going well past any reasonable width for a result row in the launcher</title><h1>fixture %s</h1>' \
    "$i" "$i" > "$fixtures/p$i.html"
done
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$fixtures" >/dev/null 2>&1 &
server=$!
trap 'kill $server; rm -rf "$fixtures"' EXIT
sleep 0.5
# The shipped user.js turns open-tab suggestions off; the sweep needs them.
F eval 'Services.prefs.setBoolPref("browser.urlbar.suggest.openpage", true)' >/dev/null
open=$(F eval 'gBrowser.tabs.filter(t => t.linkedBrowser.currentURI.spec.includes("/p")).length')
if (( open < 12 )); then
  for i in $(seq 1 12); do F open "http://127.0.0.1:$port/p$i.html" >/dev/null; done
fi

failed=0
cell() { # name layout vertical zen launcher [extra prefs js]
  local name=$1
  F js - >/dev/null <<JS
gURLBar.view.close(); gURLBar.handleRevert(); gBrowser.selectedBrowser.focus();
gBrowser.selectedTab = gBrowser.tabs.at(-1);
const P = Services.prefs;
P.setStringPref("omafire.layout", "$2"); P.setBoolPref("sidebar.verticalTabs", $3);
P.setBoolPref("omafire.zen-mode", $4); P.setBoolPref("omafire.zen-mode-active", $4);
P.setBoolPref("omafire.compact", false); P.setBoolPref("sidebar.position_start", true);
${6:-}
if ("$5") P.setStringPref("omafire.launcher", "$5"); else P.clearUserPref("omafire.launcher");
JS
  F hover 450,"$(F eval 'innerHeight - 10')" >/dev/null 2>&1
  F settle 700 >/dev/null
  # Real Ctrl+L and typing; the query falls back to gURLBar.search when
  # wtype drops the keystrokes (it does, intermittently, in host mode).
  F key ctrl+l >/dev/null && F settle 300 >/dev/null && F type Fixture >/dev/null && F settle 900 >/dev/null
  local ready='gURLBar.value == "Fixture" && gURLBar.hasAttribute("popover-open") && document.querySelectorAll("#urlbar .urlbarView-row[type=switchtab]").length > 3'
  if [[ $(F eval "$ready") != true ]]; then
    F eval 'gURLBar.search("Fixture")' >/dev/null
    F settle 900 >/dev/null
  fi
  F js "$HERE/geometry.js" > "$OUT/$name.json"
  F shot "$OUT/$name.png" >/dev/null
  # Keyboard-select row 3; hover row 5 with the real pointer, arriving from
  # above. The virtual pointer often leaves nothing in :hover (an upward
  # move always does), so after three tries row 5's :hover is forced
  # (InspectorUtils), still checking the CSS, not the input path.
  F key Down >/dev/null; F key Down >/dev/null; F key Down >/dev/null
  local hover=forced row5='#urlbar .urlbarView-row:nth-child(5)'
  for _ in 1 2 3; do
    F hover '.urlbarView-row:nth-child(1)' >/dev/null 2>&1; F settle 150 >/dev/null
    F hover '.urlbarView-row:nth-child(5)' >/dev/null 2>&1; F settle 300 >/dev/null
    if [[ $(F eval "document.querySelector('$row5').matches(':hover')") == true ]]; then
      hover=pointer
      break
    fi
  done
  [[ $hover == forced ]] && F state "$row5" hover >/dev/null
  F js "$HERE/states.js" > "$OUT/$name.states.json"
  [[ $hover == forced ]] && F state "$row5" none >/dev/null
  F shot "$OUT/$name.states.png" >/dev/null
  python3 - "$OUT/$name.json" "$OUT/$name.states.json" "$name" "$hover" <<'PY' || failed=1
import json, sys
g, s = (json.load(open(p)) for p in sys.argv[1:3])
fails = g["fail"] + s["fail"]
print(f'{sys.argv[3]:<18} css {g["vw"]}x{g["vh"]} dpr {g["dpr"]} text {g["textScale"]}% d{g["density"]}'
      f' card {g["card"]} results {g["viewBg"]} column {g["column"]}'
      f' last {g.get("lastRow")} hover:{sys.argv[4]} {"FAIL " + "; ".join(fails) if fails else "ok"}')
sys.exit(1 if fails else 0)
PY
}

for density in 0 1; do
  F eval "Services.prefs.setIntPref('browser.uidensity', $density)" >/dev/null
  OUT_BASE=$OUT; OUT=$OUT_BASE/d$density; mkdir -p "$OUT"
  cell top              top     false false ""
  cell top-vertical     top     true  false ""
  cell sidebar-drop     sidebar true  false ""
  cell sidebar-center   sidebar true  false center
  cell zen-drop         top     true  true  ""
  cell zen-center       top     true  true  center
  cell zen-drop-tabbar  top     false true  ""
  cell compact-drop     sidebar true  false ""     'P.setBoolPref("omafire.compact", true);'
  cell compact-center   sidebar true  false center 'P.setBoolPref("omafire.compact", true);'
  cell end-drop         sidebar true  false ""     'P.setBoolPref("sidebar.position_start", false);'
  cell end-center       sidebar true  false center 'P.setBoolPref("sidebar.position_start", false);'
  cell end-compact-drop sidebar true  false ""     'P.setBoolPref("sidebar.position_start", false); P.setBoolPref("omafire.compact", true);'
  OUT=$OUT_BASE
done
exit $failed
