#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PROFILE_DIR=${FIREFOX_PROFILE_DIR:-${PROFILE_DIR:-}}
FIREFOX_DIR=${FIREFOX_DIR:-}
FIREFOX_BIN=${FIREFOX_BIN:-}
ACTION=install
PURGE=0
DRY_RUN=0

usage() {
    cat <<'EOF'
Usage: scripts/install-favicon-contrast.sh [options]

Options:
  --profile DIR      Firefox profile (or set FIREFOX_PROFILE_DIR)
  --firefox-dir DIR  Firefox application directory (or set FIREFOX_DIR)
  --uninstall        Disable the helper for the selected profile
  --purge            With --uninstall, also remove recognized global files
  --dry-run          Validate and print the plan without changing files
  -h, --help         Show this help

Run this script as the profile owner, not through sudo. It requests sudo only
for the application-owned Firefox files when that is necessary.
EOF
}

while (($#)); do
    case $1 in
        --profile)
            (($# >= 2)) || { printf '%s\n' '--profile requires a directory.' >&2; exit 2; }
            PROFILE_DIR=$2
            shift 2
            ;;
        --firefox-dir)
            (($# >= 2)) || { printf '%s\n' '--firefox-dir requires a directory.' >&2; exit 2; }
            FIREFOX_DIR=$2
            shift 2
            ;;
        --uninstall)
            ACTION=uninstall
            shift
            ;;
        --purge)
            PURGE=1
            shift
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown option: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if ((PURGE)) && [[ $ACTION != uninstall ]]; then
    printf '%s\n' '--purge requires --uninstall.' >&2
    exit 2
fi

if [[ ${EUID:-$(id -u)} -eq 0 && -n ${SUDO_USER:-} ]]; then
    printf '%s\n' 'Run this script without sudo; it writes the profile marker as you.' >&2
    exit 1
fi

resolve_profile_from_ini() {
    local ini=${HOME}/.mozilla/firefox/profiles.ini
    [[ -f $ini ]] || return 1
    python3 - "$ini" <<'PY'
import configparser
import sys
from pathlib import Path

ini = Path(sys.argv[1])
config = configparser.ConfigParser(interpolation=None)
config.read(ini)
base = ini.parent
candidates = []

for section in config.sections():
    if section.startswith("Install") and config.has_option(section, "Default"):
        candidates.append((config.get(section, "Default"), True))
for section in config.sections():
    if not section.startswith("Profile"):
        continue
    path = config.get(section, "Path", fallback="")
    relative = config.getboolean(section, "IsRelative", fallback=True)
    if config.getboolean(section, "Default", fallback=False):
        candidates.append((path, relative))
for section in config.sections():
    if section.startswith("Profile"):
        candidates.append((
            config.get(section, "Path", fallback=""),
            config.getboolean(section, "IsRelative", fallback=True),
        ))

seen = set()
for value, relative in candidates:
    if not value:
        continue
    path = (base / value) if relative else Path(value).expanduser()
    try:
        path = path.resolve(strict=True)
    except OSError:
        continue
    if path in seen or not path.is_dir():
        continue
    seen.add(path)
    print(path)
    break
PY
}

if [[ -z $PROFILE_DIR ]]; then
    if [[ $(basename -- "$PWD") == chrome && -f $PWD/../prefs.js ]]; then
        PROFILE_DIR=$(dirname -- "$PWD")
    elif [[ -f $PWD/prefs.js ]]; then
        PROFILE_DIR=$PWD
    else
        PROFILE_DIR=$(resolve_profile_from_ini || true)
    fi
fi

if [[ -z $PROFILE_DIR || ! -d $PROFILE_DIR ]]; then
    printf '%s\n' 'Could not locate a Firefox profile; use --profile or FIREFOX_PROFILE_DIR.' >&2
    exit 1
fi
PROFILE_DIR=$(realpath -e -- "$PROFILE_DIR")
if [[ ! -f $PROFILE_DIR/prefs.js ]]; then
    printf 'Not an initialized Firefox profile (prefs.js missing): %s\n' "$PROFILE_DIR" >&2
    exit 1
fi

if [[ -z $FIREFOX_DIR ]]; then
    if [[ -z $FIREFOX_BIN ]]; then
        FIREFOX_BIN=$(command -v firefox || true)
    fi
    if [[ -z $FIREFOX_BIN ]]; then
        printf '%s\n' 'firefox was not found; use --firefox-dir or FIREFOX_DIR.' >&2
        exit 1
    fi
    resolved_firefox=$(readlink -f -- "$FIREFOX_BIN")
    FIREFOX_DIR=$(dirname -- "$resolved_firefox")
fi
FIREFOX_DIR=$(realpath -e -- "$FIREFOX_DIR")
if [[ ! -d $FIREFOX_DIR/defaults/pref ]]; then
    printf 'Not a Firefox application directory: %s\n' "$FIREFOX_DIR" >&2
    printf '%s\n' 'Wrapper/Flatpak launchers require an explicit --firefox-dir.' >&2
    exit 1
fi

SOURCE_PREF=$ROOT_DIR/configuration/autoconfig.js
SOURCE_CONFIG=$ROOT_DIR/configuration/mozilla.cfg
SOURCE_HELPER=$ROOT_DIR/favicon-contrast.uc.js
TARGET_PREF=$FIREFOX_DIR/defaults/pref/autoconfig.js
TARGET_CONFIG=$FIREFOX_DIR/mozilla.cfg
TARGET_HELPER=$FIREFOX_DIR/omarchy/favicon-contrast.uc.js
PROFILE_CHROME=$PROFILE_DIR/chrome
MARKER=$PROFILE_CHROME/.omarchy-favicon-contrast-enabled

for source in "$SOURCE_PREF" "$SOURCE_CONFIG" "$SOURCE_HELPER"; do
    if [[ ! -f $source || -L $source ]]; then
        printf 'Required regular source file not found: %s\n' "$source" >&2
        exit 1
    fi
done

sha256_file() {
    local target=$1
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum -- "$target" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 -- "$target" | awk '{print $1}'
    else
        printf '%s\n' 'A SHA-256 utility is required to verify an existing install.' >&2
        return 1
    fi
}

# Exact SHA-256 payloads from the original profile-script release. Header
# matching is intentionally insufficient because local policy may retain it.
is_exact_legacy_install() {
    local kind=$1
    local target=$2
    local digest
    [[ -f $target && ! -L $target ]] || return 1
    digest=$(sha256_file "$target") || return 1
    case $kind in
        pref)
            [[ $digest == 867a3149c693469c41e6305696cfc17b41e1421a206e2a26ceacd225cd448888 ]]
            ;;
        config)
            [[ $digest == b7e660c466194db6a4731c7ac2b6a47e85d6664529c8107970b62847280d6b44 ]]
            ;;
        helper)
            [[ $digest == e691f665b4871e9a422dd273d91eebcce4d4c372e93099ea4f68579fe722561e ]]
            ;;
    esac
}

check_replaceable() {
    local kind=$1
    local source=$2
    local target=$3
    [[ ! -e $target ]] && return 0
    if [[ ! -f $target || -L $target ]]; then
        printf 'Refusing to replace non-regular target: %s\n' "$target" >&2
        return 1
    fi
    cmp -s -- "$source" "$target" && return 0
    if ! is_exact_legacy_install "$kind" "$target"; then
        printf 'Existing Firefox configuration is modified or unknown: %s\n' "$target" >&2
        printf '%s\n' 'Refusing to overwrite it. Merge the loader manually or use another Firefox installation.' >&2
        return 1
    fi
}

if [[ $ACTION == install ]]; then
    check_replaceable pref "$SOURCE_PREF" "$TARGET_PREF"
    check_replaceable config "$SOURCE_CONFIG" "$TARGET_CONFIG"
    check_replaceable helper "$SOURCE_HELPER" "$TARGET_HELPER"
fi

printf 'Profile: %s\nFirefox: %s\n' "$PROFILE_DIR" "$FIREFOX_DIR"

if [[ $ACTION == uninstall ]]; then
    if ((PURGE)); then
        for pair in \
            "pref:$SOURCE_PREF:$TARGET_PREF" \
            "config:$SOURCE_CONFIG:$TARGET_CONFIG" \
            "helper:$SOURCE_HELPER:$TARGET_HELPER"; do
            IFS=: read -r kind source target <<<"$pair"
            [[ ! -e $target ]] && continue
            if ! cmp -s -- "$source" "$target"; then
                printf 'Refusing to purge modified file: %s\n' "$target" >&2
                exit 1
            fi
        done
    fi

    if ((DRY_RUN)); then
        printf 'Would remove profile marker: %s\n' "$MARKER"
        if ((PURGE)); then
            printf 'Would remove recognized global files:\n  %s\n  %s\n  %s\n' \
                "$TARGET_HELPER" "$TARGET_CONFIG" "$TARGET_PREF"
        else
            printf '%s\n' 'Global files would remain for other opted-in profiles.'
        fi
        exit 0
    fi

    rm -f -- "$MARKER"
    printf 'Disabled favicon contrast for %s\n' "$PROFILE_DIR"
    if ((!PURGE)); then
        printf '%s\n' 'Global files remain available for other profiles; restart Firefox.'
        exit 0
    fi
fi

GLOBAL_WRITE=0
if [[ $ACTION == install ]]; then
    for pair in \
        "$SOURCE_PREF:$TARGET_PREF" \
        "$SOURCE_CONFIG:$TARGET_CONFIG" \
        "$SOURCE_HELPER:$TARGET_HELPER"; do
        IFS=: read -r source target <<<"$pair"
        if [[ ! -e $target ]] || ! cmp -s -- "$source" "$target"; then
            GLOBAL_WRITE=1
        fi
    done
else
    for target in "$TARGET_HELPER" "$TARGET_CONFIG" "$TARGET_PREF"; do
        [[ -e $target ]] && GLOBAL_WRITE=1
    done
fi

PRIVILEGE=()
APP_DIR=$(dirname -- "$TARGET_HELPER")
NEEDS_PRIVILEGE=0
if ((GLOBAL_WRITE)) && [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    if [[ ! -w $FIREFOX_DIR || ! -w $FIREFOX_DIR/defaults/pref ]]; then
        NEEDS_PRIVILEGE=1
    elif [[ -d $APP_DIR && ! -w $APP_DIR ]]; then
        NEEDS_PRIVILEGE=1
    fi
fi
if ((NEEDS_PRIVILEGE)); then
    if ! command -v sudo >/dev/null 2>&1; then
        printf '%s\n' 'Global Firefox files need privileges, but sudo is unavailable.' >&2
        exit 1
    fi
    PRIVILEGE=(sudo)
fi

run_privileged() {
    if ((DRY_RUN)); then
        printf 'Would run:'
        printf ' %q' "${PRIVILEGE[@]}" "$@"
        printf '\n'
    else
        "${PRIVILEGE[@]}" "$@"
    fi
}

if ((DRY_RUN)); then
    if [[ $ACTION == install ]]; then
        printf 'Would install application helper: %s\n' "$TARGET_HELPER"
        printf 'Would install autoconfig loader: %s and %s\n' "$TARGET_PREF" "$TARGET_CONFIG"
        printf 'Would create profile marker: %s\n' "$MARKER"
    fi
    exit 0
fi

declare -a ROLLBACK_TARGETS=()
declare -a ROLLBACK_BACKUPS=()
declare -a CREATED_TARGETS=()
rollback() {
    local status=$?
    trap - ERR
    set +e
    for ((index=${#ROLLBACK_TARGETS[@]} - 1; index >= 0; index--)); do
        run_privileged mv -f -- "${ROLLBACK_BACKUPS[index]}" "${ROLLBACK_TARGETS[index]}"
    done
    for target in "${CREATED_TARGETS[@]}"; do
        run_privileged rm -f -- "$target"
    done
    printf '%s\n' 'Installation failed; restored the previous global state.' >&2
    exit "$status"
}
trap rollback ERR

atomic_install() {
    local source=$1
    local target=$2
    cmp -s -- "$source" "$target" 2>/dev/null && return 0

    local directory temporary backup
    directory=$(dirname -- "$target")
    temporary=$directory/.omarchy-install.$$.tmp
    run_privileged mkdir -p -- "$directory"

    if [[ -e $target ]]; then
        backup=$directory/.omarchy-install.$$.backup.$(basename -- "$target")
        run_privileged cp -a -- "$target" "$backup"
        ROLLBACK_TARGETS+=("$target")
        ROLLBACK_BACKUPS+=("$backup")
    else
        CREATED_TARGETS+=("$target")
    fi

    run_privileged install -m 0644 -- "$source" "$temporary"
    run_privileged mv -f -- "$temporary" "$target"
}

if [[ $ACTION == install ]]; then
    atomic_install "$SOURCE_HELPER" "$TARGET_HELPER"
    atomic_install "$SOURCE_CONFIG" "$TARGET_CONFIG"
    atomic_install "$SOURCE_PREF" "$TARGET_PREF"
    mkdir -p -- "$PROFILE_CHROME"
    temporary_marker=$PROFILE_CHROME/.omarchy-favicon-contrast-enabled.$$.tmp
    printf '%s\n' 'Installed by scripts/install-favicon-contrast.sh; this file is not executable.' > "$temporary_marker"
    chmod 0644 "$temporary_marker"
    mv -f -- "$temporary_marker" "$MARKER"
    printf 'Enabled favicon contrast for %s\n' "$PROFILE_DIR"
else
    for target in "$TARGET_HELPER" "$TARGET_CONFIG" "$TARGET_PREF"; do
        [[ -e $target ]] || continue
        backup=$(dirname -- "$target")/.omarchy-remove.$$.backup.$(basename -- "$target")
        run_privileged mv -- "$target" "$backup"
        ROLLBACK_TARGETS+=("$target")
        ROLLBACK_BACKUPS+=("$backup")
    done
fi

trap - ERR
for backup in "${ROLLBACK_BACKUPS[@]}"; do
    if ! run_privileged rm -f -- "$backup"; then
        printf 'Warning: could not remove transaction backup: %s\n' "$backup" >&2
    fi
done

if [[ $ACTION == install ]]; then
    printf 'Installed trusted application code in %s\n' "$TARGET_HELPER"
else
    printf '%s\n' 'Removed recognized global favicon-contrast files.'
fi
printf '%s\n' 'Restart Firefox to apply the change.'
