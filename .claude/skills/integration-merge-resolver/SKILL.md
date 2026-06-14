---
name: integration-merge-resolver
description: Use this skill when acting as the merge conductor / integration agent for a repo with multiple parallel Git worktrees — to land ready feature branches onto the trunk one at a time, rebase each onto current main, resolve conflicts by intent + the frozen contract (additive union; never revert the foundation or change frozen DTOs), run the validation gate (build + tests + smoke), and merge/PR ONLY when green. Replaces a manual merge lock with automated, verified integration. Pairs with worktree-pm-orchestrator / repo-pm-worktree-strategist (planning) and worktree-summary-reporter (lead reports).
---

# Integration Merge Resolver (the conductor)

## Purpose
You are the **merge conductor**. Worktree leads build in parallel; your job is to land their branches on the trunk **safely and in order**, resolving conflicts automatically where the intent is unambiguous, and **proving every merge green before it lands**. You replace a human merge lock with automated, verified integration.

You do not write features. You integrate them.

## The three rules that never bend
1. **One integration at a time.** Only one branch is being rebased+merged at any moment (the lock). After each merge, every other lane re-syncs on the new trunk. This prevents N-way collisions on shared hub files.
2. **Only green merges.** A branch lands only after build + tests + smoke pass on the *rebased* result. Red never merges. "The right code landed" is guaranteed by the gate, not by trusting the merge.
3. **Never silently drop work or revert the foundation.** Resolution is additive-union by default. If resolving would delete a lane's feature, revert the auth/tenancy foundation, or change a frozen contract DTO — **stop and escalate**, don't guess.

## Inputs to gather first
```bash
git fetch origin
git rev-parse --short origin/main                 # current trunk
gh pr list --state open --json number,headRefName,mergeable,mergeStateStatus
```
Plus: the merge order (from the PM plan), the frozen contract (`docs/**/CONTRACT.md`), and the validation commands (below). If a queue/order isn't given, derive it: foundation → data → API → UI → last (and put truly-independent/disjoint-file lanes anywhere).

## Per-branch protocol (the loop)
For each branch in queue order:

1. **Take the lock** — announce `MERGE LOCK: <branch>`.
2. **Check readiness** — `gh pr view <n> --json mergeable,mergeStateStatus`. If no PR yet, the lane opens one.
3. **Rebase onto trunk** — in the lane's worktree: `git fetch origin && git rebase origin/main` (or merge main in if the branch is shared/already-pushed). If `CONFLICTING/DIRTY`, the branch was opened on a stale base — rebasing is the fix.
4. **Resolve conflicts by the rules below.**
5. **Run the validation gate** (all must pass on the rebased result):
   ```bash
   dotnet build <api>.csproj            # 0 warnings / 0 errors
   dotnet test <tests>.csproj           # all pass
   ./e2e/smoke-api.sh                   # green (if API touched)
   cd web && npm run build              # AOT (if web touched)
   ```
6. **If green** → `git push --force-with-lease` (own branch) → merge the PR → `git fetch && git rev-parse --short origin/main` → **broadcast the new SHA** (`MERGE LOCK RELEASED; origin/main = <sha>; everyone git fetch && git rebase origin/main`) → next branch.
7. **If red** → do NOT merge. Report the exact failure (command + error) and hand back to the lane lead. Lock stays until fixed or skipped.

## Conflict-resolution rules (how to resolve, by intent)
- **Additive union (default):** when two lanes each *add* to a hub file (`Program.cs` endpoints, `AppDb.cs` DbSets/config, `Seed.cs` seeders, `app.routes.ts` routes), **keep both additions**. Neither lane's feature is dropped.
- **Foundation is immutable:** never accept a resolution that reverts the auth/tenancy seam (`Auth.cs`, the global query filter, the two-axis model) or re-introduces a removed insecure pattern (e.g. header-based tenancy). If a stale branch carries a deletion of the foundation, **keep the foundation**.
- **Frozen contract is immutable:** API DTOs / event shapes named in CONTRACT must stay byte-for-byte. A conflict that changes a frozen DTO is a bug → restore the contract shape, flag the lane.
- **Preserve denormalized/tenant columns** and provenance fields — they're load-bearing for downstream lanes.
- **Duplicate file-name clashes** (two lanes add the same path with different content) → namespace them (rename one), don't overwrite.
- **Genuine semantic clash** (two lanes change the *same logic* incompatibly, not just adjacent additions) → **STOP and escalate to the PM** with both versions + the question. Never pick a side silently.

## Validation gate (the "right code" guarantee)
No branch merges unless build + tests + smoke + (web) AOT all pass on the rebased tip. If CI exists (`.github/workflows`), require the PR check green too. The gate — not the merge — is what guarantees correctness.

## Guardrails (never do)
- Never merge a red or `CONFLICTING` PR.
- Never run two integrations concurrently.
- Never `git push --force` to shared `main` (force-with-lease only on the lane's own branch during rebase).
- Never resolve a semantic conflict by guessing — escalate.
- Never drop a lane's feature or revert the foundation/contract to "make it merge."
- Never claim green without running the commands.

## Output per merge (conductor log)
```
MERGE <n> — <branch>
  rebased onto: <old origin/main sha>
  conflicts resolved: <files + how (additive-union / foundation-kept / namespaced / …)>
  validation: build ✓  tests N/N ✓  smoke ✓  (web AOT ✓)
  result: merged → origin/main = <new sha>
  broadcast: "RELEASED; origin/main=<sha>; all lanes re-sync"
  escalations: <none | the semantic conflict you stopped on>
```

## Honest limits
This automates the **mechanical/additive** conflicts (the common case) and **validates everything**, replacing the manual lock. It does **not** magically resolve genuine same-logic disagreements — those are escalated, by design. And it cannot make conflicts impossible; the real elimination of conflicts is **disjoint file ownership** (see the modularize/round-2 plan). This skill is the safety net for the residual overlap.

## Relationship to the other skills
- `worktree-pm-orchestrator` / `repo-pm-worktree-strategist` — plan the work and the merge order.
- `worktree-summary-reporter` — each lane reports readiness.
- **`integration-merge-resolver` (this)** — consumes the queue + reports, and lands the branches verified-green, one at a time. It is the automated form of a `MERGE-CONDUCTOR.md` protocol doc.
