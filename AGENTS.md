# omafire: agent notes

This repo lives inside the bundle checkout (`~/Projects/omarchy-firefox-bundle`). Its AGENTS.md
holds the project rules (design bar, fxlab, live profile, release); read it first. Beads are the
bundle's (prefix `omafire`); `.beads/redirect` here points at them, and that works from a worktree
too.

## Gate

`tests/run.sh` (also what Forgejo CI runs on every push). `scripts/ci-status SHA` says whether CI
passed on exactly that commit; `scripts/ci-wait SHA` waits for it.

## Remotes

`forgejo` is ours (CI and releases). `origin` is upstream omafox on GitHub: never push there.

## Kandev

Beads labelled `kandev-omafire` become cards on the Omafire board (`.kandev/workflows/omafire.yml`);
the step prompts are the rules there. Gate files are in `.kandev/protected`. The bundle's main thread
runs the board with the kandev-factory skill.
