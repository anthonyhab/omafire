#!/usr/bin/env bash
set -euo pipefail

# FIREFOX_PROFILE_DIR selects a profile; FIREFOX_THEME_DIR can explicitly
# select the directory containing omarchy-chrome.css (direct or nested).
SETTINGS_PATH="${OMARCHY_FIREFOX_SETTINGS_PATH:-${NOCTALIA_SETTINGS_PATH:-}}"
PROFILE_OVERRIDE="${FIREFOX_PROFILE_DIR:-}"
THEME_OVERRIDE="${FIREFOX_THEME_DIR:-}"
OUTPUT_NAME="omarchy-radius.css"

python3 - "$SETTINGS_PATH" "$PROFILE_OVERRIDE" "$THEME_OVERRIDE" "$OUTPUT_NAME" <<'PY'
import json
import math
import os
import re
import subprocess
import sys
from configparser import RawConfigParser
from pathlib import Path

settings_arg = sys.argv[1].strip()
settings_path = Path(settings_arg).expanduser() if settings_arg else None
profile_override = sys.argv[2].strip()
theme_override = sys.argv[3].strip()
output_name = sys.argv[4]

def load_ratio(data, key, default):
    try:
        return float(data.get("general", {}).get(key, default))
    except (TypeError, ValueError):
        return float(default)

def hypr_option(option):
    try:
        result = subprocess.run(
            ["hyprctl", "getoption", option, "-j"],
            check=True,
            capture_output=True,
            text=True,
        )
        data = json.loads(result.stdout)
        return data if data.get("set", True) else None
    except (OSError, subprocess.SubprocessError, AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return None


def load_hyprland_rounding():
    data = hypr_option("decoration:rounding")
    try:
        return max(0.0, float(data["int"])) if data else None
    except (KeyError, TypeError, ValueError):
        return None


def normalize_hypr_color(token):
    token = token.strip().strip(",")
    if not token:
        return None

    if token.lower() in {"none", "transparent"}:
        return token.lower()

    rgba_match = re.fullmatch(r"rgba?\(([^()]*)\)", token, re.IGNORECASE)
    if rgba_match:
        value = rgba_match.group(1).strip()
        if re.fullmatch(r"[0-9a-fA-F]{8}", value):
            # Hyprland's rgba(RRGGBBAA) notation is valid CSS as hex.
            return f"#{value}"
        if re.fullmatch(r"[0-9a-fA-F]{6}", value):
            return f"#{value}"
        if re.fullmatch(r"[0-9.,% /+-]+", value):
            return token
        return None

    hex_match = re.fullmatch(r"(?:0x|#)?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})", token)
    if hex_match:
        value = hex_match.group(1)
        if len(value) == 8:
            # hyprctl serializes the color as AARRGGBB.
            value = f"{value[2:]}{value[:2]}"
        return f"#{value}"

    return None


def load_hyprland_border(value):
    if not value:
        return "none", "transparent"

    angle_match = re.search(r"([-+]?\d+(?:\.\d+)?)deg\s*$", value)
    angle = f"{angle_match.group(1)}deg" if angle_match else None
    color_tokens = re.findall(
        r"rgba?\([^()]*\)|#[0-9a-fA-F]{6,8}|0x[0-9a-fA-F]{6,8}|(?<![A-Za-z0-9])[0-9a-fA-F]{6,8}(?![A-Za-z0-9])",
        value,
        re.IGNORECASE,
    )
    colors = [normalize_hypr_color(token) for token in color_tokens]
    colors = [color for color in colors if color]
    if not colors:
        return "none", "transparent"

    if len(colors) == 1 and angle is None:
        return colors[0], colors[0]

    return (
        f"linear-gradient({angle or '90deg'}, {', '.join(colors)})",
        colors[0],
    )


def load_hyprland_borders():
    size_data = hypr_option("general:border_size")
    try:
        size = max(0, int(size_data["int"])) if size_data else 0
    except (KeyError, TypeError, ValueError):
        size = 0

    active_data = hypr_option("general:col.active_border") or {}
    inactive_data = hypr_option("general:col.inactive_border") or {}
    # Hyprland versions have exposed this as `gradient` and `str`; accept
    # both, plus `color` for single-color configurations.
    active_value = (
        active_data.get("gradient")
        or active_data.get("str")
        or active_data.get("color")
        or ""
    )
    inactive_value = (
        inactive_data.get("gradient")
        or inactive_data.get("str")
        or inactive_data.get("color")
        or ""
    )
    active_source, active_color = load_hyprland_border(str(active_value))
    inactive_source, inactive_color = load_hyprland_border(str(inactive_value))
    return size, active_source, active_color, inactive_source, inactive_color

def find_default_profile():
    ini_path = Path.home() / ".mozilla" / "firefox" / "profiles.ini"
    if not ini_path.exists():
        return None
    parser = RawConfigParser()
    parser.read(ini_path)
    # Prefer install-specific default when present.
    for section in parser.sections():
        if section.startswith("Install") and parser.has_option(section, "Default"):
            path = parser.get(section, "Default", fallback="")
            if path:
                return Path.home() / ".mozilla" / "firefox" / path
    for section in parser.sections():
        if parser.has_option(section, "Default") and parser.get(section, "Default") == "1":
            path = parser.get(section, "Path", fallback="")
            is_relative = parser.get(section, "IsRelative", fallback="1") == "1"
            if path:
                return (Path.home() / ".mozilla" / "firefox" / path) if is_relative else Path(path)
    # Fallback: first profile section with a path.
    for section in parser.sections():
        if section.startswith("Profile") and parser.has_option(section, "Path"):
            path = parser.get(section, "Path", fallback="")
            is_relative = parser.get(section, "IsRelative", fallback="1") == "1"
            if path:
                return (Path.home() / ".mozilla" / "firefox" / path) if is_relative else Path(path)
    return None

if profile_override:
    profile_dir = Path(profile_override).expanduser()
else:
    profile_dir = find_default_profile()

if not profile_dir or not profile_dir.exists():
    sys.exit(0)

profile_chrome_dir = profile_dir / "chrome"
if theme_override:
    chrome_dir = Path(theme_override).expanduser()
elif (profile_chrome_dir / "omarchy-chrome.css").is_file():
    # Profile-local development checkout (the repository itself is chrome/).
    chrome_dir = profile_chrome_dir
elif (profile_chrome_dir / "omarchy-chrome" / "omarchy-chrome.css").is_file():
    # Standard documented layout: an omarchy-chrome/ checkout or symlink
    # nested inside the profile's chrome/ directory (see README.md).
    chrome_dir = profile_chrome_dir / "omarchy-chrome"
elif (profile_chrome_dir / "firefox-gnome-theme" / "omarchy-chrome.css").is_file():
    # Pre-rebrand nested folder name, kept for backward compatibility with
    # profiles set up before the omarchy-chrome/ rename.
    chrome_dir = profile_chrome_dir / "firefox-gnome-theme"
else:
    # Keep the historical profile-root fallback for pre-install generation.
    chrome_dir = profile_chrome_dir
chrome_dir.mkdir(parents=True, exist_ok=True)
output_path = chrome_dir / output_name

data = {}
if settings_path and settings_path.is_file():
    try:
        data = json.loads(settings_path.read_text())
    except json.JSONDecodeError:
        data = {}

hyprland_rounding = load_hyprland_rounding()
if hyprland_rounding is not None:
    # Omarchy's native geometry source: keep Firefox aligned with Hyprland.
    container_px = hyprland_rounding
    input_px = hyprland_rounding
else:
    # Preserve the older settings-file contract when Hyprland is unavailable.
    radius_ratio = load_ratio(data, "radiusRatio", 0.42)
    input_ratio = load_ratio(data, "iRadiusRatio", 0.18)
    container_px = max(0.0, round(radius_ratio * 20.0, 1))
    input_px = max(0.0, round(input_ratio * 14.0, 1))

border_size, active_border_source, active_border_color, inactive_border_source, inactive_border_color = load_hyprland_borders()

css = (
    ":root {\n"
    f"  --omarchy-radius-container: {container_px}px;\n"
    f"  --omarchy-radius-input: {input_px}px;\n"
    f"  --omarchy-border-width: {border_size}px;\n"
    f"  --omarchy-border-active-source: {active_border_source};\n"
    f"  --omarchy-border-active-color: {active_border_color};\n"
    f"  --omarchy-border-inactive-source: {inactive_border_source};\n"
    f"  --omarchy-border-inactive-color: {inactive_border_color};\n"
    "}\n"
)
if output_path.exists() and output_path.read_text() == css:
    sys.exit(0)

temporary_path = output_path.with_name(f".{output_name}.{os.getpid()}.tmp")
try:
    temporary_path.write_text(css)
    temporary_path.chmod(0o644)
    temporary_path.replace(output_path)
finally:
    temporary_path.unlink(missing_ok=True)
PY
