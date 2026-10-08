#!/usr/bin/env python3
"""Ownership manifest of a sandbox home, and a diff of two of them.

  manifest.py snap HOME OUT.json   record every entry under HOME
  manifest.py diff A.json B.json   print what changed; exit 1 if a sentinel
                                   or the user-owned part of a managed file did

Each entry: type, mode, size, sha256 (files), target (symlinks). Managed
user files (user.js, userChrome.css, userContent.css) also get the hash of
their user-owned remainder (managed blocks removed) and the count of each
OMAFIRE/OMAFOX BEGIN marker, so duplicated blocks show.
Sentinels: any file whose content contains SENTINEL or 'sentinel', and the
fixture's unrelated files, must be byte-identical with the same mode.
"""
import hashlib, json, os, re, stat, sys

MANAGED = {"user.js", "userChrome.css", "userContent.css"}
BEGIN = re.compile(r"^(/\* |// )BEGIN OMAF(IRE|OX) FIREFOX BRIDGE( \*/)?$")
END = re.compile(r"^(/\* |// )END OMAF(IRE|OX) FIREFOX BRIDGE( \*/)?$")
# prefs.js lines `omafire remove` clears (cmd/omafire/firefox.go ffOwnedPrefs):
# the rest of prefs.js is the user's and must survive byte for byte.
OWNED_PREFS = re.compile(
    r'^user_pref\("(omafire\.managed|omafire\.extension\.offered|'
    r'browser\.display\.(background_color|foreground_color|use_system_colors|permit_backplate)|'
    r'browser\.anchor_color|browser\.visited_color|ui\.accentcolor(text)?|'
    r'layout\.css\.prefers-color-scheme\.content-override)",')
# omafire's own write temporaries and stages: a copy, never the user's file.
OMAFIRE_TEMP = re.compile(r"(^|/)\.omafire\.([0-9]+|(new|old)\.[0-9]+)(/|$)")
# Firefox's own churn on a run; not ours to judge.
VOLATILE = re.compile(r"(^|/)(\.cache|\.local/state/omafire/backups|cache2|startupCache|"
                      r"datareporting|saved-telemetry-pings|sessionstore|crashes|minidumps|"
                      r"storage|security_state|safebrowsing|\.parentlock|lock$)")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def remainder(text):
    out, managed, begins = [], False, 0
    for line in text.split("\n"):
        if BEGIN.match(line):
            managed, begins = True, begins + 1
        elif END.match(line):
            managed = False
        elif not managed:
            out.append(line)
    return "\n".join(out).strip("\n"), begins


def snap(home):
    entries = {}
    for dirpath, dirnames, filenames in os.walk(home):
        for name in sorted(dirnames + filenames):
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, home)
            st = os.lstat(path)
            e = {"mode": oct(stat.S_IMODE(st.st_mode))}
            if stat.S_ISLNK(st.st_mode):
                e["type"], e["target"] = "link", os.readlink(path)
            elif stat.S_ISDIR(st.st_mode):
                e["type"] = "dir"
            else:
                data = open(path, "rb").read()
                e.update(type="file", size=len(data), sha256=sha(data))
                if b"SENTINEL" in data or b"sentinel" in data:
                    e["sentinel"] = True
                if name == "prefs.js":
                    keep = [l for l in data.decode("utf-8", "replace").split("\n")
                            if not OWNED_PREFS.match(l)]
                    e["prefs_user_sha256"] = sha("\n".join(keep).encode())
                if name in MANAGED:
                    rest, begins = remainder(data.decode("utf-8", "replace"))
                    e["user_sha256"], e["blocks"] = sha(rest.encode()), begins
            entries[rel] = e
        # follow nothing: os.walk does not descend symlinked dirs by default
    return entries


PAYLOAD = re.compile(r"^(.*/chrome/(omafire|\.omafire\.(new|old)\.[^/]*|omarchy-firefox))/.+")


def diff(a, b):
    bad, payload = [], {}
    for rel in sorted(set(a) | set(b)):
        x, y = a.get(rel), b.get(rel)
        if x == y:
            continue
        m = PAYLOAD.match(rel)
        if m:  # the packaged theme tree: one line per payload, not per file
            key = m.group(1)
            kind = "+" if x is None else "-" if y is None else "~"
            payload.setdefault(key, {"+": 0, "-": 0, "~": 0})[kind] += 1
            continue
        volatile = bool(VOLATILE.search(rel))
        tag = " (firefox/backup churn)" if volatile else ""
        if x is None:
            print(f"+ {rel} {y['type']} {y['mode']}{tag}")
            continue
        if y is None:
            print(f"- {rel} {x['type']} {x['mode']}{tag}")
            if OMAFIRE_TEMP.search(rel):
                continue   # an interrupted run's temp copy, swept
            if x.get("sentinel") or (x.get("user_sha256") and remainder_nonempty(x)):
                bad.append(f"removed user-owned {rel}")
            continue
        what = [k for k in sorted(set(x) | set(y)) if x.get(k) != y.get(k)]
        print(f"~ {rel} {', '.join(what)}{tag}")
        if x.get("prefs_user_sha256"):
            # prefs.js: only the lines remove clears may go
            if x["prefs_user_sha256"] != y.get("prefs_user_sha256"):
                bad.append(f"user prefs changed: {rel}")
        elif x.get("sentinel") and not x.get("user_sha256") and x.get("sha256") != y.get("sha256"):
            bad.append(f"sentinel changed: {rel}")
        if x.get("mode") != y.get("mode") and not volatile:
            bad.append(f"mode changed: {rel} {x['mode']} -> {y['mode']}")
        if x.get("user_sha256") and x.get("user_sha256") != y.get("user_sha256"):
            bad.append(f"user content changed: {rel}")
        if y.get("blocks", 0) > 1:
            bad.append(f"duplicate managed blocks: {rel}")
    for key, counts in sorted(payload.items()):
        print(f"* {key}/ payload entries: +{counts['+']} -{counts['-']} ~{counts['~']}")
    return bad


EMPTY = sha(b"")


def remainder_nonempty(e):
    return e.get("user_sha256") != EMPTY


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "snap":
        json.dump(snap(sys.argv[2]), open(sys.argv[3], "w"), indent=1, sort_keys=True)
    elif cmd == "diff":
        bad = diff(json.load(open(sys.argv[2])), json.load(open(sys.argv[3])))
        for line in bad:
            print("VIOLATION:", line)
        print("PRESERVED: sentinels, modes and user-owned content" if not bad else f"{len(bad)} VIOLATION(S)")
        sys.exit(1 if bad else 0)
    elif cmd == "blocks":
        # blocks FILE: count of BEGIN markers (duplicate detection)
        print(remainder(open(sys.argv[2]).read())[1])
