#!/bin/bash
# The packaged XPI is the Mozilla-signed build of extension/ as committed:
# signed (META-INF present), the same version, and file for file the same
# content. AMO rewrites manifest.json, so that one is compared as JSON.
# Usage: scripts/check-xpi.sh [XPI]

set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
XPI=${1:-$PROJECT_DIR/packaging/extension/omafire.xpi}
SOURCE="$PROJECT_DIR/extension"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

unzip -q "$XPI" -d "$WORK/xpi"
for sig in META-INF/cose.sig META-INF/mozilla.rsa; do
  [[ -s "$WORK/xpi/$sig" ]] || { echo "$XPI is not signed: no $sig" >&2; exit 1; }
done
rm -rf "$WORK/xpi/META-INF"

# What sign.sh uploads: the source tree less its ignores and the receipt.
listing() {
  (cd "$1" && find . -type f \
    ! -path './dist/*' ! -name sign.sh ! -name build.sh ! -name .amo-upload-uuid \
    | sort)
}
if ! diff <(listing "$SOURCE") <(listing "$WORK/xpi") >"$WORK/files"; then
  echo "$XPI and extension/ hold different files:" >&2
  cat "$WORK/files" >&2
  exit 1
fi

status=0
while read -r file; do
  if [[ $file == ./manifest.json ]]; then
    node -e '
      const fs = require("fs");
      const [a, b] = process.argv.slice(1).map(f => JSON.parse(fs.readFileSync(f, "utf8")));
      if (JSON.stringify(a) !== JSON.stringify(b)) process.exit(1);
    ' "$SOURCE/$file" "$WORK/xpi/$file" && continue
  elif cmp -s "$SOURCE/$file" "$WORK/xpi/$file"; then
    continue
  fi
  echo "$XPI differs from extension/ in ${file#./}" >&2
  status=1
done < <(listing "$SOURCE")
if (( status )); then
  echo "Sign the current source (extension/sign.sh) and copy it to packaging/extension/omafire.xpi." >&2
fi
exit "$status"
