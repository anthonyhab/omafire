#!/bin/bash
# Stage the packages the lifecycle rows install (HEAD and the previous
# release tag, each built by makepkg from this repository into scratch, the
# way AGENTS.md says to package unreleased HEAD) and the pristine fixture.
# Usage: build.sh [head] [prev] [rel] [fixture] (default: all). PREV_TAG overrides the previous release (default v0.6.6).

set -euo pipefail
. tests/lifecycle/env.sh
PREV_TAG=${PREV_TAG:-v0.6.6}

stage() {   # stage NAME FRAGMENT PKGVER
  local d=$SCR/build/$1
  rm -rf "${d:?}" "${SCR:?}/pkg-$1"; mkdir -p "$d" "$SCR/pkg-$1"
  sed -e "s|^source=.*|source=(\"omafire::git+file://$REPO$2\")|" -e "s|^pkgver=.*|pkgver=$3|" \
    "$REPO/PKGBUILD" > "$d/PKGBUILD"
  cp "$REPO/omafire.install" "$d/"
  (cd "$d" && BUILDDIR=$d/b PKGDEST=$d SRCDEST=$d/src makepkg --nocheck --nodeps -f > "$d/makepkg.log" 2>&1)
  bsdtar -xf "$d"/*.pkg.tar.zst -C "$SCR/pkg-$1"
  rm -rf "${d:?}/b" "${d:?}/src"
  echo "staged $1: $(ls "$d"/*.pkg.tar.zst) ($("$SCR/pkg-$1/usr/bin/omafire" version))"
}
want=${*:-head prev rel fixture}
[[ " $want " == *" head "* ]] && stage head "#commit=$(git -C "$REPO" rev-parse HEAD)" "$(cat "$REPO/VERSION")"
[[ " $want " == *" prev "* ]] && stage v066 "#tag=$PREV_TAG" "${PREV_TAG#v}"
# The release the user runs now: the before-fix side of a fix found here.
[[ " $want " == *" rel "* ]] && stage rel "#tag=v$(cat "$REPO/VERSION")" "$(cat "$REPO/VERSION")"
[[ " $want " == *" fixture "* ]] || exit 0

mkdir -p "$MOCK"
cat > "$MOCK/hyprctl" <<'SH'
#!/bin/sh
# Hyprland stand-in: fixed geometry, so sync writes omafire-radius.css.
case $2 in
  decoration:rounding) echo '{"option":"decoration:rounding","int":8,"set":true}' ;;
  general:border_size) echo '{"option":"general:border_size","int":2,"set":true}' ;;
  general:col.active_border) echo '{"option":"general:col.active_border","gradient":"ff8a8a8d ff8a8a8d 0deg","set":true}' ;;
  general:col.inactive_border) echo '{"option":"general:col.inactive_border","gradient":"ff333333 ff333333 0deg","set":true}' ;;
  *) exit 1 ;;
esac
SH
chmod 755 "$MOCK/hyprctl"
rm -rf "${SCR:?}/fixture"
SB_HOME=$SCR/fixture/home make_fixture "$SCR/fixture"
echo "fixture: $SCR/fixture"
