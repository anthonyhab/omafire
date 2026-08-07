#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SANDBOX=$(mktemp -d)
trap 'rm -rf -- "$SANDBOX"' EXIT
THEME_DIR=$SANDBOX/output
GTK_DIR=$SANDBOX/.themes/Test/gtk-3.0
AUTOTHEMER=$ROOT_DIR/scripts/autothemer.sh
mkdir -p "$SANDBOX/bin" "$GTK_DIR" "$THEME_DIR"

cat > "$SANDBOX/bin/gsettings" <<'SH'
#!/usr/bin/env bash
case "${*: -1}" in
    gtk-theme) printf "'Test'\n" ;;
    color-scheme) printf "'prefer-dark'\n" ;;
    *) exit 1 ;;
esac
SH
chmod +x "$SANDBOX/bin/gsettings"

cat > "$GTK_DIR/gtk.css" <<'CSS'
.background { color: #111111; background-color: #fafafa; }
.background:backdrop { color: #222222; background-color: #eeeeee; }
.sidebar { background-color: #f0f0f0; }
.view { background-color: #ffffff; }
@define-color accent_color #7755cc;
CSS
cat > "$GTK_DIR/gtk-dark.css" <<'CSS'
.background { color: #f5f5f5; background-color: #181818; }
.background:backdrop { color: #dddddd; background-color: #202020; }
.sidebar { background-color: #1c1c1c; }
.view { background-color: #121212; }
@define-color accent_color #aa88ff;
CSS

HOME="$SANDBOX" PATH="$SANDBOX/bin:/usr/bin" FIREFOX_THEME_DIR="$THEME_DIR" \
    "$AUTOTHEMER" >/dev/null
OUTPUT=$THEME_DIR/generated-gtk-colors.css
grep -Fq -- '--gnome-window-background: #fafafa;' "$OUTPUT"
grep -Fq -- '--gnome-window-color: rgba(17, 17, 17, 0.8);' "$OUTPUT"
grep -Fq -- '--gnome-window-background: #181818;' "$OUTPUT"
grep -Fq -- '--gnome-sidebar-background: #1c1c1c;' "$OUTPUT"

# Invalid extraction must not replace the last-known-good generated palette.
cp "$OUTPUT" "$SANDBOX/expected.css"
sed -i 's/color: #f5f5f5/color: rgb(245, 245, 245)/' "$GTK_DIR/gtk-dark.css"
if HOME="$SANDBOX" PATH="$SANDBOX/bin:/usr/bin" FIREFOX_THEME_DIR="$THEME_DIR" \
    "$AUTOTHEMER" >/dev/null 2>&1; then
    printf '%s\n' 'invalid GTK text color unexpectedly succeeded' >&2
    exit 1
fi
cmp -s "$SANDBOX/expected.css" "$OUTPUT"

printf '%s\n' 'autothemer integration test passed'
