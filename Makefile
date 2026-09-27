PREFIX ?= /usr
DESTDIR ?=
BUILD_DIR ?= build
GO ?= go
# Arch's Go packaging flags; the environment may override them.
GOFLAGS ?= -buildmode=pie -trimpath -mod=readonly -modcacherw
export GOFLAGS
# Firefox's install directory (GreD), where its autoconfig is read from.
FIREFOX_DIR ?= $(PREFIX)/lib/firefox

CLI := $(BUILD_DIR)/omafire
NATIVE_HOST := $(BUILD_DIR)/omafire-native-host
PAYLOAD := $(BUILD_DIR)/firefox/chrome

# The one version source: VERSION (the release tag is v$(VERSION)).
VERSION := $(shell cat "$(dir $(lastword $(MAKEFILE_LIST)))VERSION")

# Go decides what to rebuild from its own cache, so these always run.
.PHONY: all clean install payload $(CLI) $(NATIVE_HOST)

all: $(CLI) $(NATIVE_HOST) payload

$(CLI): | $(BUILD_DIR)
	$(GO) build -ldflags "-X main.version=$(VERSION)" -o $@ ./cmd/omafire

$(NATIVE_HOST): | $(BUILD_DIR)
	$(GO) build -o $@ ./cmd/omafire-native-host

$(BUILD_DIR):
	mkdir -p $@

install: all
	install -Dm755 $(CLI) "$(DESTDIR)$(PREFIX)/bin/omafire"
	install -Dm755 packaging/omafox-shim "$(DESTDIR)$(PREFIX)/bin/omafox"
	install -Dm755 $(NATIVE_HOST) "$(DESTDIR)$(PREFIX)/lib/omafire/omafire-native-host"
	install -Dm644 packaging/org.omarchy.omafox.json "$(DESTDIR)$(PREFIX)/lib/mozilla/native-messaging-hosts/org.omarchy.omafox.json"
	install -Dm755 packaging/omafire-hook "$(DESTDIR)$(PREFIX)/share/omafire/hooks/omafire"
	install -Dm644 packaging/zen/omafire.css "$(DESTDIR)$(PREFIX)/share/omafire/zen/omafire.css"
	mkdir -p "$(DESTDIR)$(PREFIX)/share/omafire/firefox"
	rm -rf "$(DESTDIR)$(PREFIX)/share/omafire/firefox/chrome"
	cp -a $(PAYLOAD) "$(DESTDIR)$(PREFIX)/share/omafire/firefox/chrome"
	install -Dm644 chrome/omafire-prefs.js "$(DESTDIR)$(FIREFOX_DIR)/defaults/pref/omafire-prefs.js"
	install -Dm644 chrome/omafire.cfg "$(DESTDIR)$(FIREFOX_DIR)/omafire.cfg"
	install -Dm644 -t "$(DESTDIR)$(FIREFOX_DIR)/omafire" chrome/scripts/*.uc.js
	install -Dm644 packaging/extension/omafire.xpi "$(DESTDIR)$(FIREFOX_DIR)/omafire/omafire.xpi"
	install -Dm644 README.md "$(DESTDIR)$(PREFIX)/share/doc/omafire/README.md"
	install -Dm644 LICENSE "$(DESTDIR)$(PREFIX)/share/licenses/omafire/LICENSE"

# The Firefox payload, built from theme/ on every build: cheap, and never stale.
payload: | $(BUILD_DIR)
	scripts/build-payload.sh $(PAYLOAD)

clean:
	rm -rf "$(BUILD_DIR)"
