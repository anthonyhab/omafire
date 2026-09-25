#!/usr/bin/env python3
"""Extract Firefox's Nova icon variants from the installed omni.ja files into
native/ (not committed: they are Mozilla's, and they track the Firefox build)."""
import glob, os, re, subprocess, tempfile
from lib import NATIVE
os.makedirs(NATIVE, exist_ok=True)
with tempfile.TemporaryDirectory() as t:
    for ja in ("/usr/lib/firefox/browser/omni.ja", "/usr/lib/firefox/omni.ja"):
        subprocess.run(["unzip", "-o", "-q", ja, "*.svg", "-d", t], capture_output=True)
    n = 0
    for f in glob.glob(t + "/**/*.svg", recursive=True):
        s = open(f, errors="replace").read()
        m = re.search(r'<g class="nova"[^>]*>(.*?)</g>\s*</svg>', s, re.S)
        if not m:
            continue
        vm = re.search(r'viewBox="([^"]+)"', re.search(r"<svg[^>]*>", s).group(0))
        vb = vm.group(1) if vm else "0 0 16 16"
        open(os.path.join(NATIVE, os.path.basename(f)), "w").write(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="16" height="16" fill="FG">{m.group(1)}</svg>')
        n += 1
print(n, "Nova icons ->", NATIVE)
