#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SANDBOX=$(mktemp -d)
trap 'rm -rf -- "$SANDBOX"' EXIT
SOURCE=$SANDBOX/source
FIREFOX_HOME=$SANDBOX/firefox
PROFILE=$FIREFOX_HOME/test.default
TARGET=$PROFILE/chrome/firefox-gnome-theme

mkdir -p "$SOURCE/scripts" "$SOURCE/configuration" "$PROFILE/chrome" "$TARGET"
cp "$ROOT_DIR/scripts/install.sh" "$SOURCE/scripts/install.sh"
cp "$ROOT_DIR/scripts/generate-omarchy-radius.sh" "$SOURCE/scripts/generate-omarchy-radius.sh"
printf '%s\n' 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);' > "$SOURCE/configuration/user.js"
printf '%s\n' '@import "omarchy-chrome.css";' > "$SOURCE/userChrome.css"
printf '%s\n' '/* content entrypoint */' > "$SOURCE/userContent.css"
printf '%s\n' '/* maintained */' > "$SOURCE/omarchy-chrome.css"
printf '%s\n' 'customChrome.css' 'customContent.css' 'generated-gtk-colors.css' 'omarchy-radius.css' '.omarchy-favicon-contrast-enabled' > "$SOURCE/.gitignore"
chmod +x "$SOURCE/scripts/"*.sh

git -C "$SOURCE" init --quiet
git -C "$SOURCE" add .
# Ignored/local source state must never enter the installed payload.
printf '%s\n' 'SOURCE OVERRIDE' > "$SOURCE/customChrome.css"
printf '%s\n' 'SOURCE GENERATED' > "$SOURCE/generated-gtk-colors.css"
printf '%s\n' 'SOURCE RADIUS' > "$SOURCE/omarchy-radius.css"
printf '%s\n' 'SOURCE MARKER' > "$SOURCE/.omarchy-favicon-contrast-enabled"

# Existing destination-owned state must survive an update byte-for-byte.
printf '%s\n' 'DESTINATION OVERRIDE' > "$TARGET/customChrome.css"
printf '%s\n' 'DESTINATION CONTENT' > "$TARGET/customContent.css"
printf '%s\n' 'DESTINATION GENERATED' > "$TARGET/generated-gtk-colors.css"
printf '%s\n' 'DESTINATION MARKER' > "$TARGET/.omarchy-favicon-contrast-enabled"
printf '%s\n' '/* unrelated profile rule */' > "$PROFILE/chrome/userChrome.css"
printf '%s\n' '/* unrelated content rule */' > "$PROFILE/chrome/userContent.css"
printf '%s\n' 'user_pref("organization.unrelated", true);' > "$PROFILE/user.js"
printf '%s\n' 'ORIGINAL BACKUP' > "$PROFILE/user.js.bak"
cat > "$FIREFOX_HOME/profiles.ini" <<'INI'
[Profile0]
Name=test
IsRelative=1
Path=test.default
Default=1
INI

"$SOURCE/scripts/install.sh" -f "$FIREFOX_HOME" -p test.default >/dev/null

grep -Fqx 'DESTINATION OVERRIDE' "$TARGET/customChrome.css"
grep -Fqx 'DESTINATION CONTENT' "$TARGET/customContent.css"
grep -Fqx 'DESTINATION GENERATED' "$TARGET/generated-gtk-colors.css"
grep -Fqx 'DESTINATION MARKER' "$TARGET/.omarchy-favicon-contrast-enabled"
test -f "$TARGET/omarchy-chrome.css"
test -f "$TARGET/configuration/user.js"
test ! -e "$TARGET/.git"
test ! -e "$TARGET/omarchy-radius.css"
grep -Fq 'firefox-gnome-theme/userChrome.css' "$PROFILE/chrome/userChrome.css"
grep -Fq 'unrelated profile rule' "$PROFILE/chrome/userChrome.css"
grep -Fq 'organization.unrelated' "$PROFILE/user.js"
grep -Fq 'toolkit.legacyUserProfileCustomizations.stylesheets' "$PROFILE/user.js"
grep -Fqx 'ORIGINAL BACKUP' "$PROFILE/user.js.bak"
grep -Fq 'organization.unrelated' "$PROFILE/user.js.bak.1"

# Release archives have no Git index; the exclusion-aware fallback is safe too.
rm -rf -- "$SOURCE/.git"
printf '%s\n' '/* maintained fallback update */' > "$SOURCE/omarchy-chrome.css"
"$SOURCE/scripts/install.sh" -f "$FIREFOX_HOME" -p test.default >/dev/null
grep -Fqx '/* maintained fallback update */' "$TARGET/omarchy-chrome.css"
grep -Fqx 'DESTINATION OVERRIDE' "$TARGET/customChrome.css"

# Running the installed copy is a no-op payload update, not a self-copy error.
"$TARGET/scripts/install.sh" -f "$FIREFOX_HOME" -p test.default >/dev/null

grep -Fqx 'DESTINATION OVERRIDE' "$TARGET/customChrome.css"
grep -Fq 'unrelated profile rule' "$PROFILE/chrome/userChrome.css"
grep -Fqx 'ORIGINAL BACKUP' "$PROFILE/user.js.bak"
test -f "$PROFILE/user.js.bak.3"

# The generator must write beside the nested entrypoint that imports it.
mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/hyprctl" <<'SH'
#!/usr/bin/env bash
exit 1
SH
chmod +x "$SANDBOX/bin/hyprctl"
PATH="$SANDBOX/bin:/usr/bin" FIREFOX_PROFILE_DIR="$PROFILE" \
    "$TARGET/scripts/generate-omarchy-radius.sh"
test -f "$TARGET/omarchy-radius.css"
test ! -e "$PROFILE/chrome/omarchy-radius.css"

printf '%s\n' 'theme installer preservation test passed'
