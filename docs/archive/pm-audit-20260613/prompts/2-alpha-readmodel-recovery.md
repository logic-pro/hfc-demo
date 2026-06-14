Paste into the alpha window:

You are the lead agent for ALPHA (dashboard read-model spine — territory_period_summary, RecomputeRollup, health scores, watchlist seed).

CRITICAL FIRST: your worktree is currently in a BROKEN, abandoned interactive rebase
onto main (ecafac9). `git status` shows "interactive rebase in progress" with
UNMERGED paths in api/AppDb.cs and api/Seed.cs. Nothing is committed in this state.
Your first job is to recover it — do NOT start new feature work on top of a dirty rebase.

Your mission is to land the read-model spine on main, rebased onto Slice A's two-axis
(FranchiseeId) tenancy. This is "Fork 1" in the integration plan: alpha branched before
Slice A, so it still carries single-axis BrandId filters and a deleted api/Auth.cs. The
conflict is a DESIGN fork (FranchiseeId vs BrandId), not just text.

Branch/worktree recommendation:
- Branch: alpha (finish the in-progress rebase, or abort and redo deliberately)
- Worktree: hfc-demo-worktrees/alpha

Before coding, inspect:
- git status  (confirm the rebase state and the two unmerged files)
- docs/dashboard/INTEGRATION-PLAN.md §1 Fork 1 (the ~30 min resolution recipe) and §3 (alpha's answered questions)
- api/ReadModel.cs, api/Rollup.cs (your new files — already staged in the rebase)
- main's api/AppDb.cs, api/Domain.cs, api/Seed.cs (the FranchiseeId model you must adopt)

You own:
- api/ReadModel.cs, api/Rollup.cs
- The territory_period_summary + RecomputeRollup logic
- The dramatic 24-territory seed rows in api/Seed.cs (merge ON TOP of Slice A's Franchisee seed)

Avoid changing:
- web/* (frontend is charlie/slice-d)
- api/Dashboard/* (that is bravo's API surface — you sit behind its IDashboardReadModel via direct EF, per §3)
- The shape of Slice A's FranchiseeId tenancy model — adopt it, don't fork it

Acceptance criteria:
1. The interactive rebase is resolved: AppDb.cs and Seed.cs adopt main's FranchiseeId model; `git rebase --continue` completes with no remaining conflicts. (If recovery is unsafe, `git rebase --abort` and redo cleanly — document which you did.)
2. RecomputeRollup keeps its cross-franchisee read via IgnoreQueryFilters() and carries a comment that this is the SANCTIONED corporate aggregator (ADR-19) — corporate reads down across franchisees on purpose.
3. dotnet build api/api.csproj succeeds.
4. Boot + seed verify: both the booking slots AND the dashboard demo data seed; spot-check that at least one "red story" territory survived the tenancy restructuring.

Validation:
Run:
  git status                      # must show a clean tree, rebase complete
  dotnet build api/api.csproj
  bash e2e/smoke-api.sh

If validation fails, report exact errors and do not claim completion.

At the end, produce a Worktree Summary Report with:
- Whether you continued or aborted+redid the rebase, and why
- What changed
- Files changed
- Tests run
- Known risks (esp. Seed.cs three-way merge with slice-d)
- PM decisions needed
- Recommended next action (expected: "ready to merge to main as step 2, after slice-c")
