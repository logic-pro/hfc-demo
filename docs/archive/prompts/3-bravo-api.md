Paste into the bravo window:

You are the lead agent for the bravo worktree (dashboard API / RBAC).

Mission: rebase bravo onto current main (post-alpha) and land the read-only corporate dashboard
endpoints, with RBAC rewired to Slice A's token claim and a real EF read behind the existing interface.
You are merge #3 (after alpha).

Branch: bravo  Worktree: hfc-demo-worktrees/bravo

Hold the MERGE LOCK before you push (docs/dashboard/prompts/0-MERGE-CONDUCTOR.md). Alpha MUST be merged first.

Two jobs:
(a) RBAC: rewire DashboardScopeResolver.ScopeFor() from the X-Dashboard-Role / X-Franchisee-Id HEADERS to
    Slice A's claim seam (TenantResolver.Populate / ctx.User). Drop any api/Auth.cs deletion — keep Slice A's auth.
(b) Read model: swap StubDashboardReadModel for an EF-backed read of alpha's territory_period_summary,
    behind the existing IDashboardReadModel interface — NO DTO/shape change (CONTRACT §2 stays frozen).

Keep the additive v1.1 /api/dashboard/map endpoint, but do NOT add coords to the D9 list item.

Before coding, inspect: api/Dashboard/DashboardScope.cs, api/Dashboard/DashboardReadModel.cs,
api/Dashboard/StubDashboardReadModel.cs, api/Dashboard/DashboardEndpoints.cs, api/Dashboard/DashboardContracts.cs,
api/Program.cs, docs/dashboard/CONTRACT.md, and alpha's api/ReadModel.cs (now on main) for the table shape.

You own: api/Dashboard/*. Avoid: api/ReadModel.cs + api/Rollup.cs (alpha's), api/Auth.cs (Slice A's), web/.

Acceptance criteria:
1. Rebase onto origin/main clean; dotnet build green.
2. EF read returns the same DTO shapes as the stub (CONTRACT §2 unchanged).
3. Smoke all 5 dashboard endpoints + cross-tenant 403 + unknown-franchisee-id fails CLOSED (not 200).
4. Existing ./e2e/smoke-api.sh still green.

Validation:
  git fetch && git rebase origin/main
  dotnet build ./api/api.csproj
  (boot) && curl the 5 dashboard endpoints with a scoped token + a cross-tenant token (expect 403) + bad id (fail closed)

If validation fails, report exact errors and do not claim completion.

Final Worktree Summary Report: what changed, files changed, the 5-endpoint + 403 + fail-closed results,
confirmation DTOs are unchanged, merged SHA, next action (release lock → charlie swaps fixtures→live).
