---
name: start-lane
description: Run this inside a worktree window to pull that slot's pending PM assignment from the shared .pm/outbox bus and begin working it. The easiest one-command trigger for a lead agent — resolves the shared bus from any worktree, any branch.
---

# Start Lane

Type `/start-lane` in a worktree window to pick up and start your assignment.

## 1. Resolve your slot + the shared bus (works from any worktree, any branch)
```bash
MAIN="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"   # main repo (holds the shared .pm)
SLOT="$(basename "$(git rev-parse --show-toplevel)")"                   # slot = worktree dir name (alpha/bravo/echo/…)
echo "slot: $SLOT · bus: $MAIN/.pm"
cat "$MAIN/.pm/outbox/$SLOT/"*.md 2>/dev/null || echo "NO PENDING ASSIGNMENT for $SLOT"
```

## 2. Act on it
- **If there's an assignment:** that is your task — **begin it now.** Stay strictly within your slot's `allowed_paths` (see `$MAIN/.pm/registry.json`). Keep commits focused (conventional + the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer). Open a PR; CI is the merge gate. When done, report:
  ```bash
  printf '...your report...' | "$MAIN/scripts/pm/report-to-pm.sh" "$SLOT"
  ```
- **If "NO PENDING ASSIGNMENT":** you're idle-clean. Write a one-line status with `report-to-pm.sh` and stop — do **not** invent scope (that's the PM's call).

## Guardrails
Edit only your `allowed_paths`. Cross-lane needs go to `$MAIN/.pm/inbox/` (the PM routes them) — never directly to another worktree. Don't touch `api/Auth.cs` or the frozen CONTRACT §2 DTOs. Rebase onto `origin/main` if it moves.
