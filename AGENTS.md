# omafire: agent notes

This repo lives inside the bundle checkout (`~/Projects/omarchy-firefox-bundle`). Its AGENTS.md
holds the project rules (design bar, fxlab, live profile, release); read it first. Beads are the
bundle's (prefix `omafire`); `.beads/redirect` here points at them, and that works from a worktree
too.

## Gate

`tests/run.sh` (also what Forgejo CI runs on every push). `scripts/ci-status SHA` says whether CI
passed on exactly that commit; `scripts/ci-wait SHA` waits for it.

## Never against the real home

`omafire setup`, `sync` and `remove` (and the theme hook) act on `$HOME`: the user's live Firefox
profile, which is a symlink to the main checkout's `theme/`, plus Zen, the hook and the shell plugin.
Never run them, the installed or a built binary, outside a sandbox: a review's `omafire remove`
stripped all of that on 2026-10-02 (omafire-v2z.1). To reproduce a profile bug use the test suites
(they set `HOME`), or `tests/lifecycle/` (`build.sh` stages packages; `sandbox` in `lib.sh` runs a
command in bwrap with only the scratch root writable).

## Remotes

`forgejo` is ours (CI and releases). `origin` is upstream omafox on GitHub: never push there.
