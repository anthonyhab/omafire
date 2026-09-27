PREFIX ?= /usr
DESTDIR ?=
BUILD_DIR ?= build
CC ?= cc
# Firefox's install directory (GreD), where its autoconfig is read from.
FIREFOX_DIR ?= $(PREFIX)/lib/firefox

CLI := $(BUILD_DIR)/omafox
NATIVE_HOST := $(BUILD_DIR)/omafox-native-host
PAYLOAD := $(BUILD_DIR)/firefox/chrome

CFLAGS += -std=c17 -Wall -Wextra -Wpedantic

# The one version source: VERSION (the release tag is v$(VERSION)).
VERSION := $(shell cat "$(dir $(lastword $(MAKEFILE_LIST)))VERSION")
CPPFLAGS += -DOMAFOX_VERSION='"$(VERSION)"'

.PHONY: all clean install payload

all: $(CLI) $(NATIVE_HOST) payload

$(CLI): omarchy/omafox.c VERSION | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -o $@ $< $(LDFLAGS)

$(NATIVE_HOST): omarchy/omafox-native-host.c | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -o $@ $< $(LDFLAGS)

$(BUILD_DIR):
	mkdir -p $@

install: all
	install -Dm755 $(CLI) "$(DESTDIR)$(PREFIX)/bin/omafox"
	install -Dm755 $(NATIVE_HOST) "$(DESTDIR)$(PREFIX)/lib/omafox/omafox-native-host"
	install -Dm644 packaging/org.omarchy.omafox.json "$(DESTDIR)$(PREFIX)/lib/mozilla/native-messaging-hosts/org.omarchy.omafox.json"
	install -Dm755 packaging/omafox-hook "$(DESTDIR)$(PREFIX)/share/omafox/hooks/omafox"
	install -Dm644 packaging/zen/omafox.css "$(DESTDIR)$(PREFIX)/share/omafox/zen/omafox.css"
	mkdir -p "$(DESTDIR)$(PREFIX)/share/omafox/firefox"
	rm -rf "$(DESTDIR)$(PREFIX)/share/omafox/firefox/chrome"
	cp -a $(PAYLOAD) "$(DESTDIR)$(PREFIX)/share/omafox/firefox/chrome"
	install -Dm644 chrome/omafox-prefs.js "$(DESTDIR)$(FIREFOX_DIR)/defaults/pref/omafox-prefs.js"
	install -Dm644 chrome/omafox.cfg "$(DESTDIR)$(FIREFOX_DIR)/omafox.cfg"
	install -Dm644 -t "$(DESTDIR)$(FIREFOX_DIR)/omafox" chrome/scripts/*.uc.js
	install -Dm644 packaging/extension/omafox.xpi "$(DESTDIR)$(FIREFOX_DIR)/omafox/omafox.xpi"
	install -Dm644 README.md "$(DESTDIR)$(PREFIX)/share/doc/omafox/README.md"
	install -Dm644 LICENSE "$(DESTDIR)$(PREFIX)/share/licenses/omafox/LICENSE"

# The Firefox payload, built from theme/ on every build: cheap, and never stale.
payload: | $(BUILD_DIR)
	scripts/build-payload.sh $(PAYLOAD)

clean:
	rm -rf "$(BUILD_DIR)"
