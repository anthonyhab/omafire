#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SANDBOX=$(mktemp -d)
trap 'rm -rf -- "$SANDBOX"' EXIT
PROFILE_DIR=$SANDBOX/profile
CSS=$PROFILE_DIR/chrome/omarchy-radius.css
GENERATOR=$ROOT_DIR/scripts/generate-omarchy-radius.sh

mkdir -p "$PROFILE_DIR/chrome" "$SANDBOX/bin"
cat > "$SANDBOX/bin/hyprctl" <<'SH'
#!/usr/bin/env bash
case "$2" in
    decoration:rounding) printf '%s\n' '{"set":true,"int":9}' ;;
    general:border_size) printf '%s\n' '{"set":true,"int":3}' ;;
    general:col.active_border) printf '%s\n' '{"set":true,"gradient":"rgba(ff8800ff) rgba(8844ffff) 45deg"}' ;;
    general:col.inactive_border) printf '%s\n' '{"set":true,"str":"0xff303030"}' ;;
    *) exit 1 ;;
esac
SH
chmod +x "$SANDBOX/bin/hyprctl"

PATH="$SANDBOX/bin:/usr/bin" FIREFOX_PROFILE_DIR="$PROFILE_DIR" "$GENERATOR"
grep -Fq -- '--omarchy-radius-container: 9.0px;' "$CSS"
grep -Fq -- '--omarchy-border-width: 3px;' "$CSS"
grep -Fq -- 'linear-gradient(45deg, #ff8800ff, #8844ffff)' "$CSS"
grep -Fq -- '--omarchy-border-inactive-color: #303030ff;' "$CSS"
first_mtime=$(stat -c %Y "$CSS")
sleep 1
PATH="$SANDBOX/bin:/usr/bin" FIREFOX_PROFILE_DIR="$PROFILE_DIR" "$GENERATOR"
[[ $first_mtime == "$(stat -c %Y "$CSS")" ]]

cat > "$SANDBOX/settings.json" <<'JSON'
{"general":{"radiusRatio":0.5,"iRadiusRatio":0.25}}
JSON
cat > "$SANDBOX/bin/hyprctl" <<'SH'
#!/usr/bin/env bash
exit 1
SH
chmod +x "$SANDBOX/bin/hyprctl"
PATH="$SANDBOX/bin:/usr/bin" \
    FIREFOX_PROFILE_DIR="$PROFILE_DIR" \
    OMARCHY_FIREFOX_SETTINGS_PATH="$SANDBOX/settings.json" \
    "$GENERATOR"
grep -Fq -- '--omarchy-radius-container: 10.0px;' "$CSS"
grep -Fq -- '--omarchy-radius-input: 3.5px;' "$CSS"
grep -Fq -- '--omarchy-border-width: 0px;' "$CSS"

printf '%s\n' 'radius generator integration test passed'
