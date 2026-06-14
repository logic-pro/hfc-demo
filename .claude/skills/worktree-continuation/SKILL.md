---
name: worktree-continuation
description: Use this skill when a worktree finishes its assigned task, reaches a natural stopping point, or is about to go idle. It self-audits, writes a structured report to the PM bus (.pm/inbox), updates its status file, then PULLS the next assignment from the PM (.pm/outbox) — or does at most ONE safe, in-scope continuation cycle — instead of idling or inventing scope. Designed to NOT cause runaway loops or unreviewed churn.
---

# Worktree Continuation

## Purpose
A finished worktree should not idle — but it must also not invent scope, churn unreviewed diffs, or loop forever. This skill runs **one bounded cycle**: self-audit → report to the PM bus → pull the PM's next assignment → if none, do at most one *safe, in-scope* improvement → otherwise stop cleanly (idle-and-clean is a valid end state).

## The one hard rule
**At most ONE continuation cycle per finished task, then report and wait for the PM.** Never loop. Never expand scope. The PM owns priority; this skill executes within a lane's `allowed_paths` only.

## The loop (run once)
1. **Inspect state** — `git status --short` · `git diff --stat` · `git log --oneline -5` · branch vs `origin/main`.
2. **Self-audit** the touched code (checklist below).
3. **Report** — generate the status report using the **`worktree-summary-reporter`** skill (don't redefine it), then write it to the bus **deterministically** with `scripts/pm/report-to-pm.sh <lane>` (pipe the report in), which creates:
   - `<.pm>/inbox/<UTC-timestamp>__<lane>__report.md`
   - your `<.pm>/status/<lane>.md`
   **You are not done until both files exist** (or you explicitly state why they could not be written). Do not just summarize in chat.
4. **Pull next work** — read `<.pm>/outbox/<lane>/` for a PM assignment.
   - **If an assignment exists** → do it (within `allowed_paths`); report again when done.
   - **If none exists** → you MAY do **one** safe in-scope improvement (see "Safe work") **only if** it's local, low-risk, and inside this lane's `allowed_paths`. Otherwise **stop** — write the report and idle. A clean, merged, idle lane is correct; say so and recommend retiring it.
5. **Never** start anything in "Stop and ask the PM" (below) without an explicit outbox assignment.

## Self-audit checklist (touched code only)
Broken build / failing tests · incomplete TODOs you introduced · files changed **outside `allowed_paths`** · duplicated logic · missing error handling · missing tests · debug/console logging left in · serialization/tenant/cache risks · perf regressions · security/authorization risks.

## Safe work (autonomous, ≤1 cycle, in `allowed_paths`)
Add/improve tests for code you touched · behavior-preserving refactor of your own code · better logging/diagnostics · docs for what you built · remove dead code you introduced · tighten types/DTOs/validation · search for the same bug pattern in your owned files.

## Stop and ask the PM (write to inbox, do NOT act)
DB schema/migrations · new infrastructure or dependencies · auth/payment/permission/secrets changes · product/UX behavior changes · broad rewrites · anything touching another lane's `allowed_paths` · anything that becomes a new feature.

## Gates & guardrails
- **CI is the merge authority, not your self-report.** Self-validation (build/test/smoke) is a pre-check; the PR's CI run is what gates the merge. Never claim "ready to merge" on local green alone.
- **Stay in your lane.** Read `<.pm>/registry.json` for your `allowed_paths`; never edit outside them. (If a `PreToolUse` lane-guard hook is enabled, edits outside are blocked deterministically — see `.pm/README.md`.)
- **Cross-lane needs go to the PM**, never directly to another worktree (write a request to `<.pm>/inbox/`).
- **Conventional commits** + the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

## Where the bus lives
`<.pm>` = the PM control-plane dir (`.pm/` in the repo root by default; see `.pm/README.md`). If it doesn't exist, write your report to chat and tell the PM to initialize it.

## Output
End with the `worktree-summary-reporter` report (so the PM can copy it) **and** one line: `Continuation: <assignment taken | one safe cycle done | idle-clean, recommend retire>`.

## Relationship to the other skills
`worktree-summary-reporter` → produces the report this skill files. `pm-control-plane` → reads the inbox/status this writes and posts the next assignment to outbox. `integration-merge-resolver` → lands the PRs. This skill is the lead-side "what do I do when I'm done" loop.
