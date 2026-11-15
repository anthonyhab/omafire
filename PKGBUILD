# Maintainer: habibe
# Omafire: the Firefox theme and toolkit for Omarchy. Grew out of
# https://github.com/cover/omafox (MIT), whose name it carried until 0.3.0.

pkgname=omafire
pkgver=0.7.8
pkgrel=1
pkgdesc="The Firefox theme and toolkit for Omarchy: a themed, live-synced Firefox with settings, keys and profile-safe setup"
arch=('x86_64' 'aarch64')
url="https://github.com/anthonyhab/omafire"
license=('MIT')
depends=('glibc')
makedepends=('git' 'go')
# tests/run.sh: syntax checks, the node suites.
checkdepends=('nodejs' 'python' 'shellcheck')
# Stands in for omafox, which it grew from (/usr/bin/omafox stays as a
# forwarding shim so omafox's theme hook keeps working until `omafire setup`
# replaces it), and replaces only its own earlier name: omafox is upstream's
# package, and replaces= would have pacman swap it out on any system that
# syncs a repo carrying this one. Installing omafire over omafox asks.
provides=('omafox' 'omarchy-firefox')
conflicts=('omafox' 'omarchy-firefox')
replaces=('omarchy-firefox')
# Guarded removal of an older unpackaged loader; setup instructions.
install=omafire.install
# No separate -debug package in releases.
options=('!debug')
optdepends=(
  'hyprland: window rounding for the Firefox theme geometry'
  'firefox: supported browser'
)
# Firefox gets a chrome script loader (autoconfig: omafire.cfg) with the
# settings panel, keybindings, live palette and new tab, for each profile
# `omafire setup` marks. setup wires everything else.
# Builds the tag v$pkgver from the public GitHub repository; the same tag
# on Forgejo is what CI gated and published (.forgejo/workflows/release.yml). pkgver must equal VERSION
# (tests/run.sh checks). For a development build of the working tree, use
# `make` and `make install`, not this file.
source=("omafire::git+https://github.com/anthonyhab/omafire.git#tag=v${pkgver}")
sha256sums=('SKIP')

prepare() {
  cd omafire
  go mod download
}

build() {
  cd omafire
  make
}

check() {
  cd omafire
  ./tests/run.sh
}

package() {
  cd omafire
  make DESTDIR="$pkgdir" PREFIX=/usr install
}
