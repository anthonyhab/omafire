#!/bin/bash
# The shell panel's Service in a headless quickshell (tests/shell/service.qml)
# against a fake omafire: missing binary -> unavailable; a warning, then the
# settings line clears it; a refused set, then a successful one clears it.
# Skipped where quickshell isn't installed.
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if ! command -v qs > /dev/null; then
  echo "shell-service.test.sh: skipped (no quickshell)"
  exit 0
fi
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

cat > "$TEST_ROOT/omafire" <<'SH'
#!/bin/bash
case $1 in
  watch)
    echo "omafire: config.json: broken; keeping the last settings" >&2
    sleep 1
    echo '{"glass": false, "new-tab": true}'
    exec sleep 60 ;;
  set)
    if [[ $2 == nope ]]; then echo "omafire: unknown setting nope" >&2; exit 1; fi ;;
  status) echo '{}' ;;
esac
SH
chmod 755 "$TEST_ROOT/omafire"

mkdir "$TEST_ROOT/config"
cp "$TEST_DIR/shell/service.qml" "$TEST_ROOT/config/shell.qml"
cp "$TEST_DIR/../shell/omafire/Service.qml" "$TEST_ROOT/config/"
out=$(cd "$TEST_ROOT" && env -u WAYLAND_DISPLAY FAKE_OMAFIRE="$TEST_ROOT/omafire" QT_QPA_PLATFORM=offscreen \
  timeout 30 qs -p "$TEST_ROOT/config" 2>&1 || true)
if [[ $out != *"SVC ok"* ]]; then
  grep -E 'SVC|rror|warn' <<< "$out" >&2 || printf '%s\n' "$out" | tail -20 >&2
  exit 1
fi
echo "shell-service.test.sh: ok"
