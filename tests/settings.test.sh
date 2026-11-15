#!/bin/bash
# omafire get/set/reset/watch and ~/.config/omafire/config.json.

set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname "$TEST_DIR")
TEST_ROOT=$(mktemp -d)
OMAFIRE_BIN=${OMAFIRE_BIN:-$PROJECT_DIR/build/omafire}
WATCH_PID=

cleanup() {
  exec 3>&- 2>/dev/null || true
  [[ -z $WATCH_PID ]] || kill "$WATCH_PID" 2>/dev/null || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

export HOME="$TEST_ROOT/home"
unset XDG_CONFIG_HOME OMAFIRE_CONFIG OMAFIRE_BACKGROUND
# Nor the host's installed shell plugin.
export OMAFIRE_SHELL_PLUGIN_SOURCE="$HOME/no-shell-plugin"
CONFIG="$HOME/.config/omafire/config.json"
mkdir -p "$HOME"

fails() {
  local expected=$1 output
  shift
  if output=$("$OMAFIRE_BIN" "$@" 2>&1); then
    echo "omafire $* unexpectedly succeeded" >&2
    exit 1
  fi
  [[ $output == *"$expected"* ]] || { echo "omafire $*: $output" >&2; exit 1; }
}

# No file: every default, and nothing written.
[[ $("$OMAFIRE_BIN" get glass) == false ]]
[[ $("$OMAFIRE_BIN" get opacity) == 0.85 ]]
[[ $("$OMAFIRE_BIN" get | head -n1) == toolbar=top ]]
[[ ! -e $CONFIG ]]
[[ $("$OMAFIRE_BIN" status) == *"Settings: $CONFIG (defaults, no file)"* ]]

# set: validated, all or nothing, sparse, schema order.
"$OMAFIRE_BIN" set opacity 0.7 glass on toolbar line
[[ $(cat "$CONFIG") == $'{\n  "toolbar": "line",\n  "glass": true,\n  "opacity": 0.7\n}' ]]
[[ $(stat -c %a "$HOME/.config/omafire") == 700 ]]
fails "opacity must be a number from 0.5 to 1" set glass off opacity 0.2
[[ $("$OMAFIRE_BIN" get glass) == true ]]
fails "toolbar must be one of top, sidebar, line" set toolbar bottom
fails "unknown setting: nope" set nope 1
fails "usage: omafire set" set glass
[[ $("$OMAFIRE_BIN" status) == *"Settings: $CONFIG (3 set)"* ]]

# get --json is the watch line.
json=$("$OMAFIRE_BIN" get --json)
python3 - "$json" "$PROJECT_DIR/config/schema.json" <<'PY'
import json, sys
values = json.loads(sys.argv[1])
schema = json.load(open(sys.argv[2]))["settings"]
assert list(values) == [s["key"] for s in schema], values
assert values["glass"] is True and values["opacity"] == 0.7 and values["tabs"] == "horizontal"
PY

# --if-missing only seeds.
"$OMAFIRE_BIN" set --if-missing glass off
[[ $("$OMAFIRE_BIN" get glass) == true ]]

# reset leaves the file.
"$OMAFIRE_BIN" reset glass toolbar
[[ $(cat "$CONFIG") == $'{\n  "opacity": 0.7\n}' ]]

# The toolbar and tabs stay a pair the theme styles: what a set names wins.
rm -f "$CONFIG"
"$OMAFIRE_BIN" set toolbar sidebar
[[ $("$OMAFIRE_BIN" get tabs) == vertical ]]
"$OMAFIRE_BIN" set tabs horizontal
[[ $("$OMAFIRE_BIN" get toolbar) == top && $("$OMAFIRE_BIN" get tabs) == horizontal ]]
"$OMAFIRE_BIN" set toolbar line tabs vertical
[[ $("$OMAFIRE_BIN" get toolbar) == top && $("$OMAFIRE_BIN" get tabs) == vertical ]]
"$OMAFIRE_BIN" set toolbar line
[[ $("$OMAFIRE_BIN" get tabs) == horizontal ]]
"$OMAFIRE_BIN" set toolbar sidebar
"$OMAFIRE_BIN" reset tabs
[[ $("$OMAFIRE_BIN" get toolbar) == top ]]
rm "$CONFIG"

# Bad values fall back with a warning; unknown keys survive a set.
printf '{"glass": "yes", "later": 1}\n' > "$CONFIG"
[[ $("$OMAFIRE_BIN" get glass 2>/dev/null) == false ]]
[[ $("$OMAFIRE_BIN" get glass 2>&1 >/dev/null) == *"glass must be true or false, using the default"* ]]
"$OMAFIRE_BIN" set tabs vertical 2>/dev/null
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d == {"tabs": "vertical", "glass": "yes", "later": 1}, d' "$CONFIG"

# A file that is not JSON is never overwritten.
printf 'not json\n' > "$CONFIG"
fails "invalid character" set glass on
[[ $(cat "$CONFIG") == 'not json' ]]
rm "$CONFIG"

# XDG_CONFIG_HOME moves it.
XDG_CONFIG_HOME="$TEST_ROOT/xdg" "$OMAFIRE_BIN" set glass on
[[ -f $TEST_ROOT/xdg/omafire/config.json && ! -e $CONFIG ]]

# watch: a line at start and per effective change; a broken file is skipped;
# a sync's new theme.json is a "palette" line; the end of stdin (a pipe)
# ends it.
mkfifo "$TEST_ROOT/in"
mkdir -p "$HOME/.local/state/omafire" "$HOME/.local/state/omarchy/current"
"$OMAFIRE_BIN" watch < "$TEST_ROOT/in" > "$TEST_ROOT/out" 2> "$TEST_ROOT/err" &
WATCH_PID=$!
exec 3> "$TEST_ROOT/in"

lines() {
  local want=$1
  for _ in $(seq 50); do
    [[ $(wc -l < "$TEST_ROOT/out") -ge $want ]] && return
    sleep 0.05
  done
  echo "watch: wanted $want lines, got:" >&2
  cat "$TEST_ROOT/out" "$TEST_ROOT/err" >&2
  exit 1
}
lines 1
"$OMAFIRE_BIN" set glass on
lines 2
"$OMAFIRE_BIN" set glass on             # no change, no line
cp "$CONFIG" "$TEST_ROOT/good.json"
printf 'broken' > "$CONFIG"
sleep 0.2
[[ $(wc -l < "$TEST_ROOT/out") == 2 && -s "$TEST_ROOT/err" ]]
cp "$TEST_ROOT/good.json" "$CONFIG"     # fixed, same settings: the line again,
lines 3                                 # so a reader showing the error clears it
[[ $(sed -n 3p "$TEST_ROOT/out") == "$(sed -n 2p "$TEST_ROOT/out")" ]]
printf '{"glass": true, "opacity": 0.9}\n' > "$CONFIG"
lines 4
rm -r "$HOME/.config/omafire"           # gone: defaults
lines 5
"$OMAFIRE_BIN" set tabs vertical        # a new directory is still watched
lines 6
printf '{}\n' > "$TEST_ROOT/theme.json"
mv "$TEST_ROOT/theme.json" "$HOME/.local/state/omafire/theme.json"
lines 7
ln -sfn "$TEST_ROOT/in" "$HOME/.local/state/omarchy/current/background"
lines 8
exec 3>&-
for _ in $(seq 50); do
  kill -0 "$WATCH_PID" 2>/dev/null || break
  sleep 0.05
done
if kill -0 "$WATCH_PID" 2>/dev/null; then
  echo "watch outlived its stdin" >&2
  exit 1
fi
wait "$WATCH_PID"
WATCH_PID=
python3 - "$TEST_ROOT/out" <<'PY'
import json, sys
lines = open(sys.argv[1]).read().splitlines()
assert lines[-2:] == ["palette", "wallpaper"], lines
del lines[-2:]
got = [json.loads(l) for l in lines]
want = [(False, 0.85, "horizontal"), (True, 0.85, "horizontal"), (True, 0.85, "horizontal"), (True, 0.9, "horizontal"),
        (False, 0.85, "horizontal"), (False, 0.85, "vertical")]
assert [(g["glass"], g["opacity"], g["tabs"]) for g in got] == want, got
PY
[[ $(cat "$TEST_ROOT/err") == *"keeping the last settings"* ]]

# Every pref the schema drives is one the theme or the chrome scripts read,
# so a rename on either side fails here.
python3 - "$PROJECT_DIR" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
text = "".join(p.read_text() for d in ("theme/src", "chrome/scripts")
               for p in (root / d).rglob("*") if p.is_file() and p.suffix in (".css", ".js"))
for s in json.load(open(root / "config/schema.json"))["settings"]:
    for pref in s["prefs"]:
        assert f'"{pref["name"]}"' in text, f'{s["key"]}: {pref["name"]} is read nowhere'
PY

# The README's settings table lists exactly the schema's settings, in order,
# with their defaults.
python3 - "$PROJECT_DIR" <<'PY'
import json, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
rows = re.findall(r"^\| `([a-z-]+)` \|.*\| `([^`]*)` \|$", (root / "README.md").read_text(), re.M)
def shown(v):
    return str(v).lower() if isinstance(v, bool) else str(v)
want = [(s["key"], shown(s["default"])) for s in json.load(open(root / "config/schema.json"))["settings"]]
assert rows == want, f"README settings table {rows} != schema {want}"
PY

echo "settings.test.sh: ok"
