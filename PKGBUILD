# Maintainer: habibe
# Fork of https://github.com/cover/omafox with the C CLI port and the
# Firefox userChrome bridge (palette-accurate first paint).

pkgname=omarchy-firefox
pkgver=0.2.0
pkgrel=1
pkgdesc="Keeps Firefox and Zen Browser in sync with the current Omarchy theme"
arch=('x86_64' 'aarch64')
url="https://github.com/cover/omafox"
license=('MIT')
depends=('glibc')
# The command and its files keep the omafox name.
provides=('omafox')
conflicts=('omafox')
# Guarded removal of an older unpackaged loader; setup instructions.
install=omarchy-firefox.install
# No separate -debug package in releases.
options=('!debug')
optdepends=(
  'hyprland: window rounding for the Firefox theme geometry'
  'firefox: supported browser'
  'zen-browser: supported browser'
)
# Firefox gets a chrome script loader (autoconfig: omafox.cfg) with the
# settings panel, keybindings and live palette, and the Mozilla-signed
# Omafox WebExtension beside it, which the loader installs into each
# profile `omafox setup` marks. setup wires everything else.
# Releases build the Forgejo tag v$pkgver, which Forgejo CI gated and
# published (.forgejo/workflows/release.yml). pkgver must equal VERSION
# (tests/run.sh checks). For a development build of the working tree, use
# `make` and `make install`, not this file.
source=("omafox::git+ssh://git@git.hab.rip/habibe/omafox.git#tag=v${pkgver}")
sha256sums=('SKIP')

build() {
  cd omafox
  make
}

check() {
  cd omafox
  ./tests/run.sh
}

package() {
  cd omafox
  make DESTDIR="$pkgdir" PREFIX=/usr install
}
