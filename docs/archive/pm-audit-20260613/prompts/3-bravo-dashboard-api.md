Paste into the bravo window:

You are the lead agent for BRAVO (dashboard API — read-only projection endpoints + RBAC scope filter).

Your mission is to land the dashboard API surface (CONTRACT §2 DTOs + the additive v1.1
GET /api/dashboard/map) on main, with RBAC rewired onto Slice A's verified token claim.
This is "Fork 2 / the bravo half" in the integration plan: bravo branched before Slice A,
so it currently scopes via X-Dashboard-Role / X-Franchisee-Id HEADERS and DELETES api/Auth.cs.
Both must change — headers are not a trust boundary, and Auth.cs is now load-bearing on main.

Branch/worktree recommendation:
- Branch: bravo (rebase onto current origin/main AFTER alpha lands, so the read model is real)
- Worktree: hfc-demo-worktrees/bravo

Before coding, inspect:
- api/Dashboard/DashboardEndpoints.cs, DashboardContracts.cs, DashboardReadModel.cs, StubDashboardReadModel.cs, DashboardScope.cs (your surface)
- api/Auth.cs and the TenantResolver.Populate seam on main (Slice A) — this is your new scope source
- docs/dashboard/INTEGRATION-PLAN.md §1 Fork 2/bravo (the ~2–4h RBAC rewire recipe) and §3 (your answered questions: v1.1 /map APPROVED; do NOT add coords to the D9 list item)
- docs/dashboard/CONTRACT.md (the frozen §2 shapes — do not drift)

You own:
- api/Dashboard/* (all of it)
- The RBAC scope resolver: DashboardScopeResolver.ScopeFor()
- Your additions in api/Program.cs (endpoint registration)

Avoid changing:
- api/Auth.cs beyond consuming its claim seam — DO NOT delete it (your branch currently does; drop that deletion)
- web/* (charlie consumes your DTOs but you do not touch the frontend)
- The CONTRACT §2 DTO shapes — they are frozen and charlie's models are verbatim to them

Acceptance criteria:
1. DashboardScopeResolver.ScopeFor() reads tenancy from Slice A's claim seam (TenantResolver.Populate / ctx.User), NOT from X-Dashboard-Role / X-Franchisee-Id headers.
2. The api/Auth.cs deletion is reverted; build links against main's auth.
3. RBAC fails CLOSED: a franchisee-scoped token cannot read another franchisee's rows, and cannot reach the corporate/cross-franchisee read.
4. All five §2 endpoints plus GET /api/dashboard/map return byte-for-byte CONTRACT §2 shapes (verify against dashboard.models.ts).
5. dotnet build + smoke green.

Validation:
Run:
  dotnet build api/api.csproj
  bash e2e/smoke-api.sh
  # plus one live call per dashboard endpoint, asserting the JSON shape matches CONTRACT §2

If validation fails, report exact errors and do not claim completion.

At the end, produce a Worktree Summary Report with:
- What changed (esp. the RBAC seam swap and the Auth.cs un-deletion)
- Files changed
- Tests run
- Known risks
- PM decisions needed
- Recommended next action (expected: "ready to merge as step 3, after alpha")
