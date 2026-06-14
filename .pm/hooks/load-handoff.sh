#!/usr/bin/env bash
# SessionStart hook: if a context-handoff checkpoint exists, surface it so a fresh
# session (after /clear or /compact) resumes by reading-then-going instead of
# re-discovering state. Pairs with the /context-handoff skill which writes latest.md.
# Read-only; FAILS OPEN (prints nothing if there's no handoff or no shared .pm).
set -euo pipefail
GCD="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
PM="$(cd "$(dirname "$GCD")" 2>/dev/null && pwd)/.pm" || exit 0
LATEST="$PM/handoffs/latest.md"
[ -f "$LATEST" ] || exit 0

# Only surface if it's reasonably fresh (last 7 days) — stale handoffs are noise.
AGE_DAYS=$(( ( $(date +%s) - $(stat -c %Y "$LATEST" 2>/dev/null || echo 0) ) / 86400 ))
[ "$AGE_DAYS" -le 7 ] || exit 0

echo "🧭 CONTEXT HANDOFF found (.pm/handoffs/latest.md, ${AGE_DAYS}d old) — resume from here:"
echo "────────────────────────────────────────────────────────"
cat "$LATEST"
echo "────────────────────────────────────────────────────────"
echo "Continue from the 'Resume prompt'/'Next actions' above. Re-verify SHAs/PRs before acting."
