# Multi-agent control plane (`.pm/`)

How the PM agent and the worktree lead agents coordinate without conflict. Built
from hard-won lessons this repo (see [decisions.md](decisions.md)).

## Why this exists
Separate Claude sessions **cannot message each other** — the filesystem is the
only reliable channel. So worktrees don't "chat"; they write **structured files**
to this bus, and the PM (which can read into every worktree by path) schedules and
arbitrates. The PM owns priority; worktrees execute within their lane.

## The bus
```
.pm/
  registry.json      lanes → branch → allowed_paths   (PM-owned, single writer)
  board.md           live status of every lane          (PM-owned)
  decisions.md       one-line-per decision, append-only (PM-owned)
  risks.md           open risks                          (PM-owned)
  inbox/             lead → PM reports (UNIQUE filenames: <UTC>__<lane>__report.md)
  outbox/<lane>/     PM → lead assignments
  status/<lane>.md   each lead owns exactly one file
  archive/           processed inbox reports
  hooks/lane-guard.sh  optional PreToolUse ownership enforcement (opt-in)
```
**Write rules:** PM is the only writer of `registry/board/decisions/risks`.
A lead only: appends a unique file to `inbox/`, owns its one `status/<lane>.md`,
reads its `outbox/<lane>/`. Unique filenames + single-writer = no races.

## The skills (the behavior protocol)
| Skill | Who | Does |
|---|---|---|
| `pm-control-plane` | PM | read bus + CI → update board/decisions → assign to outbox |
| `worktree-pm-orchestrator` | PM | plan work, write per-lane copy-paste prompts |
| `repo-pm-worktree-strategist` | PM | audit worktrees, recommend a cleaner structure |
| `integration-merge-resolver` | PM/conductor | rebase → resolve by intent → **CI-green** → merge, one at a time |
| `worktree-continuation` | lead | on finish: self-audit → report → pull next (≤1 safe cycle) or idle-clean |
| `worktree-summary-reporter` | lead | produce the PM-ready status report |

## The flow
```
PM assigns (outbox) → lead implements (in allowed_paths) → lead validates
→ lead runs worktree-continuation: report to inbox + update status, then pull next
→ PM control-plane reads inbox + CI, updates board, assigns next
→ conductor (integration-merge-resolver) merges PRs that are CI-green, one at a time
```

## Two rules that keep you out of trouble
1. **CI is the merge authority — not self-reports.** A lane's local "build/test green" is a pre-check; the PR's CI run decides. (Proven: a lane self-reported 8/8 green, its PR was conflict-clean, it merged, and CI caught a real red on the integrated trunk.)
2. **Stay in your lane.** Edit only your `allowed_paths`. The deep fix for conflicts is **disjoint ownership** (one feature = its own files), which the `wt-modularize` lane sets up — locks are a band-aid.

## Idle policy
"Idle" is only bad when **PM work is queued and unassigned**. A finished, merged,
clean lane should be **retired to free the slot** — not forced to refactor forever.
`worktree-continuation` does **at most one** safe in-scope cycle, then reports and
waits. No runaway loops, no unreviewed churn.

## Naming
Lanes have **friendly role names** (`wt-readmodel`, `wt-dashboard-api`, `wt-exec-ui`,
`wt-franchisee-ui`, `wt-modularize`, `wt-ci`) in `registry.json`, decoupled from the
git branch. This is why we don't have to rename mid-round. **Convention for new
lanes:** `wt-<area>` worktree on a `feat/<area>` or `chore/<area>` branch. **Never
rename a branch with an open PR or mid-round** — it breaks PRs and everyone's rebase
target. Rename only at creation or after retire. (The legacy `alpha/bravo/charlie/
slice-*` branches keep their git names until they retire; refer to them by friendly
name everywhere else.)

## Optional: enforce lane ownership with a hook (opt-in — do NOT enable mid-round)
`hooks/lane-guard.sh` is a `PreToolUse` hook that **blocks edits outside the current
lane's `allowed_paths`** — turning advisory ownership into a deterministic boundary.
It is **not wired in by default**, because enabling a blocking hook while lanes are
mid-merge can disrupt legitimate in-flight edits. Enable it for round 2 by adding to
the repo's `.claude/settings.json`:
```json
{ "hooks": { "PreToolUse": [
  { "matcher": "Edit|Write|NotebookEdit",
    "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.pm/hooks/lane-guard.sh" } ] } ] } }
```
The script reads `registry.json`, finds the lane for the current branch, and exits
non-zero (blocking) if the target path is outside `allowed_paths`. It **fails open**
(allows) for the PM, unknown lanes, or a missing registry — so it can't brick you.
Use the `update-config` skill to install it cleanly.
