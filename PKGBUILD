# Maintainer: habibe
# Fork of https://github.com/cover/omafox with the C CLI port and the
# Firefox userChrome bridge (palette-accurate first paint).

pkgname=omafox
pkgver=0.1.0
pkgrel=1
pkgdesc="Keeps Firefox and Zen Browser in sync with the current Omarchy theme"
arch=('x86_64' 'aarch64')
url="https://github.com/cover/omafox"
license=('MIT')
depends=('glibc')
# No separate -debug package in releases.
options=('!debug')
optdepends=(
  'hyprland: window rounding for the Firefox theme geometry'
  'firefox: supported browser'
  'zen-browser: supported browser'
)
# The signed @omafox WebExtension is installed from AMO inside the browser;
# pacman cannot deploy extensions. `omafox setup` wires everything else.
# Releases build the Forgejo tag v$pkgver, which Forgejo CI gated and
# published (.forgejo/workflows/release.yml). pkgver must equal VERSION
# (tests/run.sh checks). For a development build of the working tree, use
# `make` and `make install`, not this file.
source=("omafox::git+ssh://git@git.hab.rip/habibe/omafox.git#tag=v${pkgver}")
sha256sums=('SKIP')

build() {
  cd "$pkgname"
  make
}

check() {
  cd "$pkgname"
  ./tests/run.sh
}

package() {
  cd "$pkgname"
  make DESTDIR="$pkgdir" PREFIX=/usr install
}
