#!/usr/bin/env bash
# SessionStart hook: when a worktree window opens, surface that slot's pending
# assignment from the SHARED bus as session context — so a lead sees its task
# immediately, no pasting.
#
# Reaches the shared .pm from ANY worktree via git's common dir (all worktrees
# share the main repo's .git → its parent holds the canonical .pm/). Read-only;
# FAILS OPEN (prints nothing for the PM/main/unknown slot or anything missing).
set -euo pipefail
GCD="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
MAIN="$(cd "$(dirname "$GCD")" 2>/dev/null && pwd)" || exit 0   # main repo root
PM="$MAIN/.pm"
REG="$PM/registry.json"
[ -f "$REG" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0
BR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo)"
case "$BR" in main|master|""|HEAD) exit 0;; esac

SLOT="$(python3 - "$REG" "$BR" <<'PY' 2>/dev/null || true
import sys, json
reg, br = sys.argv[1], sys.argv[2]
d = json.load(open(reg)); slots = d.get("slots") or d.get("lanes") or []
m = next((s for s in slots if s.get("branch") == br), None)
print((m or {}).get("name", ""))
PY
)"
[ -n "$SLOT" ] || exit 0
LATEST="$(ls -t "$PM/outbox/$SLOT"/*.md 2>/dev/null | head -1)"
[ -n "$LATEST" ] || exit 0

echo "📋 PM ASSIGNMENT for slot '$SLOT'  (source: ${LATEST#$MAIN/})"
echo "────────────────────────────────────────────────────────"
cat "$LATEST"
echo "────────────────────────────────────────────────────────"
echo "Begin this assignment now. Stay in your allowed_paths. When done:"
echo "  $MAIN/scripts/pm/report-to-pm.sh $SLOT   (writes your report to the PM inbox)"
