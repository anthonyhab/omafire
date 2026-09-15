# Maintainer: habibe
# Fork of https://github.com/cover/omafox with the C CLI port and the
# Firefox userChrome bridge (palette-accurate first paint).

pkgname=omafox
pkgver=1.1.0
pkgrel=1
pkgdesc="Keeps Firefox and Zen Browser in sync with the current Omarchy theme"
arch=('x86_64' 'aarch64')
url="https://github.com/cover/omafox"
license=('MIT')
depends=('glibc')
optdepends=(
  'firefox: supported browser'
  'zen-browser: supported browser'
)
# The signed @omafox WebExtension is installed from AMO inside the browser;
# pacman cannot deploy extensions. `omafox setup` wires everything else.
source=("omafox::git+file://${PWD}")
# When published, point source at the canonical git remote instead:
# source=("git+https://git.hab.rip/habibe/omafox.git#tag=v${pkgver}")
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
