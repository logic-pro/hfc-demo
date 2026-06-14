You are the lead for the SLICE-A worktree (Auth & Tenancy). This is the MUST slice —
it's both the security fix and the foundation the dashboard's RBAC rebases onto.

Read first:
1. ROADMAP.md §0 (Slice A row) and §2 (foundations)
2. docs/decisions.md — ADR-04 (EF query filter), ADR-05 (header→token claim), ADR-16 (two-axis tenancy)
3. api/Program.cs, api/AppDb.cs, api/Domain.cs — current TenantContext/middleware + query filter

Invoke the run-hfc-demo skill to build/run/verify.

Mission (Track: security MUST):
1. Move tenant resolution from the X-Tenant-Id header to a VERIFIED auth token claim
   (Entra ID / Azure AD B2C). The EF global query filter mechanism stays unchanged —
   only the SOURCE of the tenant id changes (fail-closed: no claim → no rows).
2. Make tenancy two-axis: franchiseeId is the isolation key, brandId is the grouping
   (ADR-16). Add franchiseeId to the tenant-scoped entities + the resolved claim.
3. Integration tests with xUnit + WebApplicationFactory: tenant isolation (no cross-
   franchisee leakage) AND the optimistic-concurrency double-booking 409 test.

Coordination: keep claim resolution a clean, single seam — the alpha/bravo dashboard
worktrees will rebase their RBAC scope source onto exactly this. This slice merges to
main FIRST per the ROADMAP. Work on the slice-a-auth-tenancy branch; commit as you go;
do not push. Give me a short plan, then begin.
