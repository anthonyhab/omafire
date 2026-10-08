# shellcheck shell=bash
# make_fixture DIR: a pristine sandbox home under DIR/home with every §2
# fixture profile and sentinel content. Paths are relative where they can
# be, so a copy (cp -a) of DIR is a fixture of its own.

make_fixture() {
  local root=$1 home=$1/home ff=$1/home/.mozilla/firefox
  mkdir -p "$home/.local/state/omarchy/current" "$ff" "$home/.config/omarchy/hooks/theme-set.d"
  cp -rL "$LIVE_THEME" "$home/.local/state/omarchy/current/theme"
  printf '%s\n' "$THEME_NAME" > "$home/.local/state/omarchy/current/theme.name"
  # An unrelated hook of the user's: must survive every operation.
  printf '#!/bin/sh\necho sentinel-hook\n' > "$home/.config/omarchy/hooks/theme-set.d/10-mine"
  chmod 750 "$home/.config/omarchy/hooks/theme-set.d/10-mine"

  # 1. generated: an ordinary profile Firefox created and ran once.
  sandbox "$PKG_HEAD" firefox --headless --no-remote -CreateProfile "gen $ff/gen.default" >/dev/null 2>&1
  sandbox "$PKG_HEAD" timeout 60 firefox --headless --no-remote --profile "$ff/gen.default" \
    --screenshot "$root/gen-first-run.png" about:blank >/dev/null 2>&1 || true
  rm -f "$root/gen-first-run.png"

  # 2. personal: the user's own CSS, prefs and neighbouring files.
  local p=$ff/personal.default
  mkdir -p "$p/chrome/img"
  printf '/* SENTINEL personal userChrome */\n:root:root:root:root #nav-bar { box-shadow: inset 0 -6px 0 #ff00ff !important; }\n' > "$p/chrome/userChrome.css"
  printf '/* SENTINEL personal userContent */\n@-moz-document url(about:blank) { body { color: red; } }\n' > "$p/chrome/userContent.css"
  printf '/* SENTINEL customChrome */\n#TabsToolbar { box-shadow: inset 0 6px 0 #00ff00 !important; }\n' > "$p/chrome/customChrome.css"
  printf '/* SENTINEL customContent */\n' > "$p/chrome/customContent.css"
  printf 'sentinel neighbour\n' > "$p/chrome/notes.txt"
  printf 'PNGSENTINEL' > "$p/chrome/img/logo.png"
  printf '// SENTINEL personal user.js\nuser_pref("sentinel.userjs", "keep-me");\nuser_pref("browser.startup.homepage", "about:blank");\n' > "$p/user.js"
  printf '// Mozilla User Preferences\nuser_pref("sentinel.prefsjs", 42);\n' > "$p/prefs.js"
  printf 'sentinel root file\n' > "$p/sentinel.txt"
  chmod 644 "$p/chrome/userChrome.css"
  chmod 640 "$p/user.js"
  chmod 600 "$p/chrome/userContent.css"

  # 3. checkout-backed: chrome/ is a symlink to a theme checkout.
  mkdir -p "$home/src"
  git -C "$REPO" archive --prefix=omafire-theme/ HEAD:theme | tar -x -C "$home/src"
  git -C "$home/src/omafire-theme" init -q
  git -C "$home/src/omafire-theme" add -A
  git -C "$home/src/omafire-theme" -c user.name=t -c user.email=t@t commit -qm fixture
  printf '/* SENTINEL checkout customChrome */\n' > "$home/src/omafire-theme/customChrome.css"
  mkdir -p "$ff/checkout.default"
  ln -s ../../../src/omafire-theme "$ff/checkout.default/chrome"
  printf 'user_pref("sentinel.checkout", true);\n' > "$ff/checkout.default/user.js"

  # 4. a path with spaces, below a subdirectory, with its own content.
  p="$ff/Profiles/My Profile.default"
  mkdir -p "$p/chrome"
  printf '/* SENTINEL spaced userChrome */\n' > "$p/chrome/userChrome.css"
  printf 'user_pref("sentinel.spaced", 1);\n' > "$p/user.js"

  # 5. an absolute (IsRelative=0) profile outside the Firefox root.
  mkdir -p "$home/elsewhere/abs profile"
  printf 'user_pref("sentinel.abs", 1);\n' > "$home/elsewhere/abs profile/user.js"

  # 6. a psd copy listed by mistake: never written.
  mkdir -p "$ff/personal.default-backup/chrome"
  printf 'user_pref("psd.copy", 1);\n' > "$ff/personal.default-backup/user.js"

  cat > "$ff/profiles.ini" <<INI
[General]
StartWithLastProfile=1
Version=2

[Profile0]
Name=gen
IsRelative=1
Path=gen.default
Default=1

[Profile1]
Name=personal
IsRelative=1
Path=personal.default

[Profile2]
Name=checkout
IsRelative=1
Path=checkout.default

[Profile3]
Name=spaced
IsRelative=1
Path=Profiles/My Profile.default

[Profile4]
Name=absolute
IsRelative=0
Path=@HOME@/elsewhere/abs profile

[Profile5]
Name=psdcopy
IsRelative=1
Path=personal.default-backup

[Profile6]
Name=missing
IsRelative=1
Path=missing.default
INI
}

# instance NAME: a fresh copy of the pristine fixture at $SCR/runs/NAME,
# made the current sandbox home.
instance() {
  local dir=${SCR:?}/runs/${1:?}
  rm -rf "$dir"; mkdir -p "$SCR/runs"
  cp -a "$SCR/fixture" "$dir"
  SB_HOME=$dir/home
  FF=$SB_HOME/.mozilla/firefox
  sed -i "s|@HOME@|$SB_HOME|" "$FF/profiles.ini"
}
