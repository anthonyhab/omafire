#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
FIREFOX_BIN=${FIREFOX_BIN:-$(command -v firefox || true)}
PROFILE_DIR=${PROFILE_DIR:-}
SKIP_PROFILE_INSTALL=${SKIP_PROFILE_INSTALL:-0}

if [[ -z "$FIREFOX_BIN" ]]; then
    printf '%s\n' 'firefox was not found; set FIREFOX_BIN explicitly.' >&2
    exit 1
fi

if [[ -z "${FIREFOX_DIR:-}" ]]; then
    resolved_firefox=$(readlink -f -- "$FIREFOX_BIN")
    candidate_dir=$(dirname -- "$resolved_firefox")
    if [[ -d "$candidate_dir/defaults/pref" ]]; then
        FIREFOX_DIR=$candidate_dir
    elif [[ -d /usr/lib/firefox/defaults/pref ]]; then
        # Debian/Arch launchers are often shell wrappers, so readlink points
        # at /usr/bin rather than the actual Firefox installation.
        FIREFOX_DIR=/usr/lib/firefox
    else
        printf '%s\n' 'Could not locate Firefox installation; set FIREFOX_DIR explicitly.' >&2
        exit 1
    fi
fi

PREF_DIR="$FIREFOX_DIR/defaults/pref"
AUTOCONFIG="$PREF_DIR/autoconfig.js"
CONFIG="$FIREFOX_DIR/mozilla.cfg"
STAMP=$(date +%Y%m%d-%H%M%S)

if [[ ! -d "$PREF_DIR" ]]; then
    printf 'Firefox preference directory not found: %s\n' "$PREF_DIR" >&2
    exit 1
fi

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    printf '%s\n' 'Run this script as root, for example:' >&2
    printf '  sudo %q\n' "$0" >&2
    exit 1
fi

for required_file in \
    "$ROOT_DIR/configuration/autoconfig.js" \
    "$ROOT_DIR/configuration/mozilla.cfg" \
    "$ROOT_DIR/favicon-contrast.uc.js"; do
    if [[ ! -f "$required_file" ]]; then
        printf 'Required file not found: %s\n' "$required_file" >&2
        exit 1
    fi
done

if [[ -z "$PROFILE_DIR" ]] && [[ -f "$ROOT_DIR/../prefs.js" ]]; then
    PROFILE_DIR=$(dirname -- "$ROOT_DIR")
fi

PROFILE_CHROME=""
if [[ -n "$PROFILE_DIR" ]]; then
    PROFILE_CHROME="$PROFILE_DIR/chrome"
elif [[ "$SKIP_PROFILE_INSTALL" != 1 ]]; then
    printf '%s\n' 'The active profile is unknown. Run from its chrome directory, set PROFILE_DIR, or use SKIP_PROFILE_INSTALL=1 only when the script is already installed there.' >&2
    exit 1
fi

backup_if_different() {
    local source=$1
    local target=$2

    if [[ -e "$target" ]] && ! cmp -s "$source" "$target"; then
        local backup="${target}.pi-backup-${STAMP}"
        cp -a -- "$target" "$backup"
        printf 'Backed up %s to %s\n' "$target" "$backup"
    fi
}

backup_if_different "$ROOT_DIR/configuration/autoconfig.js" "$AUTOCONFIG"
backup_if_different "$ROOT_DIR/configuration/mozilla.cfg" "$CONFIG"
if [[ -n "$PROFILE_CHROME" ]]; then
    backup_if_different "$ROOT_DIR/favicon-contrast.uc.js" "$PROFILE_CHROME/favicon-contrast.uc.js"
fi

install -m 0644 "$ROOT_DIR/configuration/autoconfig.js" "$AUTOCONFIG"
install -m 0644 "$ROOT_DIR/configuration/mozilla.cfg" "$CONFIG"

if [[ -n "$PROFILE_CHROME" ]]; then
    mkdir -p "$PROFILE_CHROME"
    profile_script="$PROFILE_CHROME/favicon-contrast.uc.js"
    if [[ "$(realpath -- "$ROOT_DIR/favicon-contrast.uc.js")" != "$(realpath -- "$profile_script" 2>/dev/null || true)" ]]; then
        install -m 0644 "$ROOT_DIR/favicon-contrast.uc.js" "$profile_script"
    fi
    printf 'Installed profile script in %s\n' "$PROFILE_CHROME"
else
    printf '%s\n' 'Skipped profile script installation; the existing active-profile copy will be used.'
fi

printf 'Installed favicon contrast autoconfig in %s\n' "$FIREFOX_DIR"
printf '%s\n' 'Restart Firefox to load it.'
