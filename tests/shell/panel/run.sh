#!/bin/bash
# The bar panel (shell/omafire/Panel.qml) in a headless sway, driven by
# QtTest events against a fake omafire (probe.qml): hints drawn, a still
# pointer never takes the cursor when rows shift, delegates kept across a
# config change, the opacity slider from the glass floor, r only repairs
# what needs it. Manual, not in run.sh: needs sway, grim, quickshell and the
# Omarchy shell (/usr/share/omarchy/shell). Screenshots land in $1.
#
#   tests/shell/panel/run.sh [shot dir]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
shell=${OMARCHY_SHELL:-/usr/share/omarchy/shell}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
shots=$(realpath -m "${1:-$work/shots}")
mkdir -p "$work/config/omafire" "$work/state" "$shots"
cp -r "$shell"/{Commons,Ui,services} "$work/config/"
cp "$here"/../../../shell/omafire/*.{qml,js} "$work/config/omafire/"
cp "$here/probe.qml" "$work/config/shell.qml"
# the schema's defaults, and a status where every profile is fine
python3 - "$here/../../../config/schema.json" "$work/state" <<'PY'
import json, sys
schema, state = sys.argv[1:]
cfg = {s["key"]: s["default"] for s in json.load(open(schema))["settings"]}
json.dump(cfg, open(state + "/config.json", "w"))
json.dump({"version": "0", "theme": "probe", "hook": {"path": "", "present": True},
           "firefox": {"detected": True, "profiles": [{"path": "/p/a.default", "status": "configured", "ok": True}]},
           "keyConflicts": {}, "glassFloor": 0.7}, open(state + "/status.json", "w"))
PY
: > "$work/state/calls"
cat > "$work/sway.conf" <<CONF
output HEADLESS-1 mode 1600x1000@60Hz
default_border none
exec env FAKE_OMAFIRE=$here/fake-omafire FAKE_STATE=$work/state SHOT_DIR=$shots QT_QPA_PLATFORM=wayland qs -p $work/config > $work/qs.log 2>&1; swaymsg exit
CONF
env -u WAYLAND_DISPLAY -u DISPLAY -u HYPRLAND_INSTANCE_SIGNATURE WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 \
  timeout -k 5 60 sway -c "$work/sway.conf" > "$work/sway.log" 2>&1 || true
results=$(grep -a 'PH ' "$work/qs.log" | sed 's/^.*PH /PH /' || true)
printf '%s\n' "$results"
if [[ $results != *"PH done"* ]] || grep -q ' FAIL' <<< "$results"; then
  grep -a 'ERROR\|TypeError' "$work/qs.log" | head -10 >&2 || true
  exit 1
fi
echo "panel probe: ok"
