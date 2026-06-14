#!/usr/bin/env bash
# Stop hook: before a LANE session stops with unreported work, require it to write
# a report to the PM inbox (built / problems / self-evaluation). Blocks EXACTLY
# ONCE (guarded by stop_hook_active so it never loops), and only for a worktree
# slot that has work and hasn't reported since its last commit. FAILS OPEN
# everywhere else (PM/main, no slot, no work, already reported, anything missing).
set -euo pipefail
INPUT="$(cat 2>/dev/null || true)"

# Never loop: if this Stop was already triggered by us, allow the stop.
case "$INPUT" in *'"stop_hook_active": true'*|*'"stop_hook_active":true'*) exit 0;; esac

GCD="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
MAIN="$(cd "$(dirname "$GCD")" 2>/dev/null && pwd)" || exit 0
[ -f "$MAIN/.pm/registry.json" ] || exit 0
BR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo)"
case "$BR" in main|master|""|HEAD) exit 0;; esac
SLOT="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo)")"
[ -n "$SLOT" ] || exit 0

# Only nag if there is actually work (commits ahead of trunk, or a dirty tree).
AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
[ "$AHEAD" = "0" ] && [ "$DIRTY" = "0" ] && exit 0

# Already reported since the last commit? then allow.
LAST="$(ls -t "$MAIN/.pm/inbox/"*__"${SLOT}"__*.md 2>/dev/null | head -1)"
if [ -n "$LAST" ]; then
  HEADTS="$(git log -1 --format=%ct 2>/dev/null || echo 0)"
  RPTTS="$(stat -c %Y "$LAST" 2>/dev/null || echo 0)"
  [ "$RPTTS" -ge "$HEADTS" ] && exit 0
fi

# Block once and ask for the report (the model will then write it, then stop).
printf '{"decision":"block","reason":"%s"}\n' \
  "📋 Before stopping: write your worktree report for slot '$SLOT' to the PM inbox — (1) what you built, (2) problems hit, (3) a self-evaluation: what went well + where you would improve next time + a confidence level. Use the worktree-summary-reporter format, then run:  printf '<report>' | \"$MAIN/scripts/pm/report-to-pm.sh\" $SLOT . You are not done until that report is in .pm/inbox."
