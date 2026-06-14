# Audit refresh — 2026-06-13 (second pass)

> Re-audit of the parallel-worktree state. The existing prompts (`0-MERGE-CONDUCTOR.md`
> .. `5-slice-d-and-nps-swap.md`) remain **correct and canonical**. This note records
> only what CHANGED since they were written, so the conductor doesn't re-issue stale steps.

## Deltas since the prompts were authored

1. **Merge #1 (slice-c) is DONE — ready to land now.**
   `slice-c-nps-pipeline` has been reconciled onto Slice A's two-axis tenancy and
   **PR #2 is open, green, `MERGEABLE`/`CLEAN`** (https://github.com/logic-pro/hfc-demo/pull/2).
   `dotnet build` clean, `dotnet test` 8/8, `./e2e/smoke-api.sh` **12/12** incl. cross-franchisee
   NPS isolation. NpsSurvey is franchisee-scoped (FranchiseeId filter) with BrandId+TerritoryId
   denormalized; `GET /api/nps` is territory-resolvable without a join.
   **ACTION: conductor merges PR #2 as merge #1. No further work needed on slice-c.**

2. **slice-c's tenancy resolution is the proven template for every PRE-Slice-A lane.**
   AppDb.cs / Domain.cs / Seed.cs two-axis reconciliation (adopt `FranchiseeId` filter,
   keep additive denormalized BrandId/TerritoryId, never revert to BrandId-only, never touch
   Auth.cs) is exactly the conflict alpha / charlie / slice-d will hit. Point them at
   slice-c's diff as the reference resolution before they rebase.

3. **alpha is BROKEN — stuck mid-rebase. Reset before re-attempting.**
   The `alpha` worktree is on a **detached HEAD at main's tip with UNRESOLVED conflicts**
   (`UU api/AppDb.cs`, `UU api/Seed.cs`, `MM api/Domain.cs`) — a half-finished "squash D0–D5
   then replay onto two-axis tenancy" attempt. The `alpha` branch ref (6e1b681) is intact.
   **ACTION (prepend to prompt #2):** abort the stuck state cleanly first —
   `git -C hfc-demo-worktrees/alpha rebase --abort 2>/dev/null; git -C hfc-demo-worktrees/alpha checkout alpha`
   — then do the planned rebase onto the NEW main (which now includes slice-c), reusing
   slice-c's resolution. Alpha is the critical-path bottleneck: bravo and charlie both wait on it.

4. **bravo has UNCOMMITTED work — protect it before any rebase.**
   `bravo` worktree shows 3 modified, uncommitted files (`api/Dashboard/DashboardScope.cs`,
   `api/Program.cs`, `e2e/smoke-api.sh`). **ACTION (prepend to prompt #3):** commit WIP on the
   `bravo` branch before `git fetch && git rebase` — otherwise the rebase will refuse or the
   work is lost.

5. **slice-d still has no `SALVAGE.md`, and overbuilt a 3rd read-model.**
   `slice-d` committed a full `api/DashboardReadModel.cs` + live wiring — a backend that
   duplicates **both** alpha's read-model **and** bravo's `api/Dashboard/*`. Per plan, the
   corporate read-model is alpha+bravo; slice-d is the franchisee OPS view at `/dashboard`.
   **ACTION (reinforce in prompt #5):** slice-d must NOT land a competing corporate read-model;
   keep only its operator-grain `GET /api/dashboard` additive, reconcile UI into charlie's shell.

6. **Orphan branch `feat/corporate-readmodel-design` (no worktree) — harvest then retire.**
   Adds `docs/architecture/corporate-readmodel.sql` (design) + a `web/src/app/corporate/*` slice.
   The 3 dashboard skills it introduced are already on `main`. **ACTION:** harvest
   `corporate-readmodel.sql` into alpha's read-model design if not already reflected, then delete
   the branch. Do not merge its `web/src/app/corporate/*` — charlie owns `/corporate`.

## Land order (unchanged, with status)

| # | Branch | Status now |
|---|--------|------------|
| 1 | slice-c-nps-pipeline | ✅ **PR #2 green/mergeable — MERGE NOW** |
| 2 | alpha | 🔴 broken mid-rebase — reset, then rebase onto new main |
| 3 | bravo | 🟡 uncommitted WIP — commit, then waits on alpha |
| 4 | charlie | ⏸ clean; waits on bravo; owns the one shell |
| 5 | D-NPS-SWAP | ⏸ unblocked once #1 + #2 land |
| 6 | slice-d | ⏸ retire-into-charlie's-shell; no 2nd read-model; needs SALVAGE.md |

## Retire (already merged — close the loop)
- `slice-a-auth-tenancy` (0 ahead of main) and `slice-b-ai-intake` (squash-merged via PR #1):
  fully landed. Remove the worktrees and delete the branches to cut the lane count from 8 → 5.
