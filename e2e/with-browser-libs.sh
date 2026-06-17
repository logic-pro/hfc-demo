#!/usr/bin/env bash
# with-browser-libs.sh — run a Playwright driver LOCALLY in this sandbox.
#
# The long-standing "browser is CI-only (Chromium can't launch: missing libnspr4/
# libnss3/libasound)" constraint is solved WITHOUT sudo: we apt-get *download* the
# three runtime libs, unpack them into a user-writable prefix, and point Chromium at
# them via LD_LIBRARY_PATH. Idempotent — the first run provisions, later runs reuse.
#
# Usage:
#   e2e/with-browser-libs.sh node e2e/drive-backoffice.mjs "" /tmp/hfc-shots
#   WEB_URL=BASE=http://localhost:5180 e2e/with-browser-libs.sh node e2e/drive-franchisee.mjs "" /tmp/hfc-shots
#
# It only sets LD_LIBRARY_PATH and execs your command — env you export (WEB_URL/
# API_BASE/BASE) passes straight through.
set -euo pipefail

PW_LIBS="${PW_LIBS_DIR:-$HOME/.local/pw-libs}"
LIB="$PW_LIBS/lib"
DEBS="$PW_LIBS/debs"
EXTRACTED="$PW_LIBS/extracted"

# Provision once: if the shared objects Chromium needs aren't unpacked yet, fetch +
# unpack them. libnspr4 is the canonical "is it set up?" marker.
if [ ! -e "$LIB/libnspr4.so" ]; then
  echo "with-browser-libs: provisioning Chromium runtime libs into $LIB ..." >&2
  mkdir -p "$DEBS" "$EXTRACTED" "$LIB"
  ( cd "$DEBS" && apt-get download libnss3 libnspr4 libasound2t64 )
  for d in "$DEBS"/*.deb; do dpkg -x "$d" "$EXTRACTED"; done
  find "$EXTRACTED" -name '*.so*' -exec cp -P {} "$LIB/" \;
  echo "with-browser-libs: provisioned $(ls "$LIB" | wc -l) files." >&2
fi

export LD_LIBRARY_PATH="$LIB:${LD_LIBRARY_PATH:-}"

if [ "$#" -eq 0 ]; then
  echo "with-browser-libs: libs ready at $LIB (LD_LIBRARY_PATH exported). Pass a command to run." >&2
  exit 0
fi

exec "$@"
