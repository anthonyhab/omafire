# Maintainer: habibe
# Omafire: the Firefox theme and toolkit for Omarchy. Grew out of
# https://github.com/cover/omafox (MIT), whose name it carried until 0.3.0.

pkgname=omafire
pkgver=0.7.6
pkgrel=1
pkgdesc="The Firefox theme and toolkit for Omarchy: a themed, live-synced Firefox with settings, keys and profile-safe setup"
arch=('x86_64' 'aarch64')
url="https://git.hab.rip/habibe/omafire"
license=('MIT')
depends=('glibc')
makedepends=('git' 'go')
# tests/run.sh: syntax checks, the node suites.
checkdepends=('nodejs' 'python' 'shellcheck')
# Replaces its earlier names; /usr/bin/omafox stays as a forwarding shim
# so omafox's theme hook keeps working until `omafire setup` replaces it.
provides=('omafox' 'omarchy-firefox')
conflicts=('omafox' 'omarchy-firefox')
replaces=('omafox' 'omarchy-firefox')
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
# Releases build the Forgejo tag v$pkgver, which Forgejo CI gated and
# published (.forgejo/workflows/release.yml). pkgver must equal VERSION
# (tests/run.sh checks). For a development build of the working tree, use
# `make` and `make install`, not this file.
source=("omafire::git+ssh://git@git.hab.rip/habibe/omafire.git#tag=v${pkgver}")
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
