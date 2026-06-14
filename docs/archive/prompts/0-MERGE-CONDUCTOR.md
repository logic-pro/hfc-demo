# 0 — Merge Conductor (single-writer lock)

> Read this FIRST. 8 Claude sessions are live in this repo. `main` is landed via real
> GitHub PRs on `origin` (github.com/logic-pro/hfc-demo). Slice A + Slice B are already
> merged (PR #1 = Slice B). Remaining: **C → alpha → bravo → charlie → D-NPS-SWAP → slice-d.**

## The one rule that prevents a pile-up
**Only ONE integration PR is open against `main` at a time.** `api/Program.cs` is touched
by 4 of the 5 remaining branches and the Angular shell by 2 — parallel merges WILL collide.

Conductor protocol (whoever holds the lock):
1. Announce in the shared channel: "MERGE LOCK: <branch>".
2. Lead rebases their branch on the *current* `origin/main`, proves green, pushes, opens PR.
3. Conductor merges it. `origin/main` moves.
4. Release lock. **Every other lead immediately `git fetch && git rebase origin/main`** before doing anything else (rule 5 of WORKTREE-GITFLOW.md).
5. Next branch in the sequence takes the lock.

## Land order + why (do not reorder)
| # | Branch | Gate | Why it's here |
|---|--------|------|---------------|
| 1 | slice-c-nps-pipeline | none | Already on current main, clean adds. Free win, unblocks D-NPS-SWAP. |
| 2 | alpha | rebase onto Slice A FranchiseeId | Read-model spine everything else reads. |
| 3 | bravo | needs alpha merged | EF read of alpha's `territory_period_summary`; RBAC → token claim. |
| 4 | charlie | needs bravo merged | Swaps fixtures → live bravo; owns the ONE shell. |
| 5 | D-NPS-SWAP | needs C + alpha | Flip rollup `nps_score` seeded→measured from `GET /api/nps`. |
| 6 | slice-d | needs charlie's shell | Franchisee ops dashboard at `/dashboard`, reconciled into the one shell. |

## Non-negotiables (the two known forks — see WORKTREE-GITFLOW.md)
- **Tenancy:** build on Slice A's token claim (`TenantResolver.Populate`, two-axis
  `franchiseeId` key + `brandId` grouping). Do NOT delete `Auth.cs`, do NOT revert to BrandId-only.
  `alpha`, `charlie`, `slice-d` are PRE-Slice-A and MUST rebase onto it before landing.
- **Shell:** ONE app shell, three routes — `/booking` (untouched), `/corporate` (charlie),
  `/dashboard` (slice-d). `charlie` and `slice-d` ship competing shells today; charlie's lands
  first and owns the shell, slice-d reconciles INTO it (no second `shell.ts`/`main.ts`/bootstrap).
