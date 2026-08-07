#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SANDBOX=$(mktemp -d)
trap 'rm -rf -- "$SANDBOX"' EXIT
FIREFOX_DIR=$SANDBOX/firefox
PROFILE_DIR=$SANDBOX/profile
INSTALLER=$ROOT_DIR/scripts/install-favicon-contrast.sh

mkdir -p "$FIREFOX_DIR/defaults/pref" "$PROFILE_DIR/chrome"
printf 'user_pref("test", true);\n' > "$PROFILE_DIR/prefs.js"

"$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" --dry-run >/dev/null
"$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" >/dev/null
cmp -s "$ROOT_DIR/configuration/autoconfig.js" "$FIREFOX_DIR/defaults/pref/autoconfig.js"
cmp -s "$ROOT_DIR/configuration/mozilla.cfg" "$FIREFOX_DIR/mozilla.cfg"
cmp -s "$ROOT_DIR/favicon-contrast.uc.js" "$FIREFOX_DIR/omarchy/favicon-contrast.uc.js"
test -f "$PROFILE_DIR/chrome/.omarchy-favicon-contrast-enabled"
test ! -f "$PROFILE_DIR/chrome/favicon-contrast.uc.js"

# Reinstall is idempotent, and one exact legacy payload is migratable.
"$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" >/dev/null
cat > "$FIREFOX_DIR/defaults/pref/autoconfig.js" <<'LEGACY'
// Firefox autoconfig bootstrap for favicon-contrast.uc.js.
pref("general.config.filename", "mozilla.cfg");
pref("general.config.obscure_value", 0);
// The loader needs access to the profile's chrome directory.
pref("general.config.sandbox_enabled", false);
LEGACY
"$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" >/dev/null
cmp -s "$ROOT_DIR/configuration/autoconfig.js" "$FIREFOX_DIR/defaults/pref/autoconfig.js"

# A recognized header with local policy is modified, not an owned upgrade.
printf '%s\n' 'pref("organization.local", true);' >> "$FIREFOX_DIR/defaults/pref/autoconfig.js"
if "$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" >/dev/null 2>&1; then
    printf '%s\n' 'modified recognized autoconfig was unexpectedly replaced' >&2
    exit 1
fi
grep -Fq 'organization.local' "$FIREFOX_DIR/defaults/pref/autoconfig.js"
cp "$ROOT_DIR/configuration/autoconfig.js" "$FIREFOX_DIR/defaults/pref/autoconfig.js"

# Unknown global policy is also never overwritten.
printf '%s\n' '// foreign policy' > "$FIREFOX_DIR/mozilla.cfg"
if "$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" >/dev/null 2>&1; then
    printf '%s\n' 'conflicting autoconfig was unexpectedly replaced' >&2
    exit 1
fi
grep -Fqx '// foreign policy' "$FIREFOX_DIR/mozilla.cfg"
cp "$ROOT_DIR/configuration/mozilla.cfg" "$FIREFOX_DIR/mozilla.cfg"

"$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" --uninstall >/dev/null
test ! -e "$PROFILE_DIR/chrome/.omarchy-favicon-contrast-enabled"
test -f "$FIREFOX_DIR/omarchy/favicon-contrast.uc.js"

"$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" >/dev/null
"$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" \
    --uninstall --purge --dry-run >/dev/null
"$INSTALLER" --profile "$PROFILE_DIR" --firefox-dir "$FIREFOX_DIR" \
    --uninstall --purge >/dev/null
test ! -e "$PROFILE_DIR/chrome/.omarchy-favicon-contrast-enabled"
test ! -e "$FIREFOX_DIR/defaults/pref/autoconfig.js"
test ! -e "$FIREFOX_DIR/mozilla.cfg"
test ! -e "$FIREFOX_DIR/omarchy/favicon-contrast.uc.js"

printf '%s\n' 'favicon installer integration test passed'
