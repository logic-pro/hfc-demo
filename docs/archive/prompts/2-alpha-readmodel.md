Paste into the alpha window:

You are the lead agent for the alpha worktree (data & read-model spine).

Mission: rebase alpha onto current main and land the corporate read-model: territory_period_summary
+ RecomputeRollup + health score + watchlist + dramatic seed. You are merge #2 (after slice-c).

Branch: alpha  Worktree: hfc-demo-worktrees/alpha

Hold the MERGE LOCK before you push (docs/dashboard/prompts/0-MERGE-CONDUCTOR.md).

THE CONFLICT: your branch is PRE-Slice-A (based on 7901752). Slice A replaced header tenancy with a
verified token claim and a TWO-AXIS model (franchiseeId key + brandId grouping). When you rebase you
will collide in api/AppDb.cs, api/Domain.cs, api/Seed.cs.

Resolution:
- ADOPT main's two-axis FranchiseeId tenancy in AppDb.cs / Domain.cs / Seed.cs (do NOT revert to BrandId-only,
  do NOT delete Auth.cs).
- KEEP your territory_period_summary, RecomputeRollup, scores, watchlist rows, and dramatic seed.
- Your read model is correctly boundary-agnostic (it aggregates across franchisees on purpose). Add a comment
  on the IgnoreQueryFilters() call stating it is the SANCTIONED corporate aggregator (ADR-19).
- slice-c merged just before you — rebase over its NpsSurvey/Domain/AppDb/Program.cs additions too; keep additive.

Before coding, inspect: api/ReadModel.cs, api/Rollup.cs, api/Seed.cs, api/Domain.cs, api/AppDb.cs,
api/Program.cs, docs/dashboard/CONTRACT.md (§2 DTO shapes — match exactly), docs/dashboard/decisions.md (ADR-19).

You own: api/ReadModel.cs, api/Rollup.cs, the territory_period_summary table + rollup endpoint, your seed rows.
Avoid: web/ (frontend), api/Dashboard/ (bravo owns that), api/Auth.cs (Slice A — do not touch).

Acceptance criteria:
1. Rebase onto origin/main resolved per above; dotnet build ./api/api.csproj green.
2. Boot + reseed + re-run RecomputeRollup succeeds; territory_period_summary populated.
3. Spot-check: at least one "red"/at-risk watchlist story survives the reseed (report the row).
4. ./e2e/smoke-api.sh still passes (tenancy isolation intact).

Validation:
  git fetch && git rebase origin/main   # resolve AppDb/Domain/Seed per above
  dotnet build ./api/api.csproj
  (boot, reseed, trigger rollup) && ./e2e/smoke-api.sh

If validation fails, report exact errors and do not claim completion.

Final Worktree Summary Report: what changed, files changed, rollup row counts, the surviving red story,
smoke result, merged SHA, PM decisions needed, next action (release lock → bravo rebases onto you).
