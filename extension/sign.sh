#!/usr/bin/env bash
# Sign the extension through AMO's unlisted (self-distributed) channel.
# Reads WEB_EXT_API_KEY/WEB_EXT_API_SECRET from the environment, or from
# ~/.config/mozilla/web-ext-signing.env if present.
set -euo pipefail

EXTENSION_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "${WEB_EXT_API_KEY:-}" || -z "${WEB_EXT_API_SECRET:-}" ]]; then
  CREDS="$HOME/.config/mozilla/web-ext-signing.env"
  if [[ -f "$CREDS" ]]; then
    set -a
    # shellcheck source=/dev/null
    . "$CREDS"
    set +a
  fi
fi

: "${WEB_EXT_API_KEY:?WEB_EXT_API_KEY is required for signing}"
: "${WEB_EXT_API_SECRET:?WEB_EXT_API_SECRET is required for signing}"

exec npx -y web-ext@10.6.0 sign \
  --source-dir "$EXTENSION_DIR" \
  --artifacts-dir "$EXTENSION_DIR/dist" \
  --channel unlisted \
  --ignore-files "dist/**" "sign.sh" "build.sh"
