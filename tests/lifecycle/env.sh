# Shared settings for the lifecycle harness; source from the repo root.
export SCR=${SCR:-$HOME/.cache/omafire-lc}
export REPO=$PWD PKG_HEAD=$SCR/pkg-head PKG_PREV=$SCR/pkg-v066 PKG_REL=$SCR/pkg-rel
export LIVE_THEME=${LIVE_THEME:-$HOME/.local/state/omarchy/current/theme} THEME_NAME=${THEME_NAME:-matte-black}
export EVID=${EVID:-$SCR/evidence}
. tests/lifecycle/lib.sh
. tests/lifecycle/fixtures.sh
mkdir -p "$SCR/tmp" "$EVID"
