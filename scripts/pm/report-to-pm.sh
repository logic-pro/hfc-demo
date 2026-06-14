#!/usr/bin/env bash
# Deterministic PM report: write a timestamped report into the bus + update the
# lane's status file, so reports never get "summarized in chat and forgotten."
#
# Usage (run from inside a worktree):
#   scripts/pm/report-to-pm.sh <lane> [report-file]
#   scripts/pm/report-to-pm.sh <lane> < report.md        # report on stdin
#   echo "..." | scripts/pm/report-to-pm.sh alpha
#
# Writes:
#   .pm/inbox/<UTC>__<lane>__report.md   (append-only; unique filename = no races)
#   .pm/status/<lane>.md                 (overwrite; the lane's current state)
set -euo pipefail

LANE="${1:?usage: report-to-pm.sh <lane> [report-file]}"
SRC="${2:-/dev/stdin}"
# Resolve the SHARED bus via git's common dir (works from any worktree).
PM="$(cd "$(dirname "$(git rev-parse --git-common-dir 2>/dev/null)")" 2>/dev/null && pwd)/.pm"
[ -d "$PM" ] || { echo "error: no shared .pm/ control plane (resolved: $PM)" >&2; exit 1; }

# UTC timestamp without ':' (filename-safe)
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ 2>/dev/null || echo "unknown-time")"
mkdir -p "$PM/inbox" "$PM/status"
REPORT="$PM/inbox/${TS}__${LANE}__report.md"
BODY="$(cat "$SRC")"

printf '%s\n' "$BODY" > "$REPORT"
printf '# Status: %s\n_Updated %s (branch %s)_\n\n%s\n' \
  "$LANE" "$TS" "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')" "$BODY" \
  > "$PM/status/${LANE}.md"

echo "report  → $REPORT"
echo "status  → $PM/status/${LANE}.md"
echo "You are not done until both files exist (they do now)."
