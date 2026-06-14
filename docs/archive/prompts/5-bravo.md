# Worktree Lead Prompt — bravo (dashboard API)

You are the lead implementation agent for this worktree. Work only here.

## Repo context
HFC franchise platform demo — ASP.NET Core 9 minimal API + EF Core (SQLite local / Azure SQL) + Angular 20 + Azure Durable Functions. `main` is the always-deployable trunk; GitHub Flow, rapid integration (see `docs/worktrees/WORKTREE-GITFLOW.md`). Slice A established token-claim two-axis tenancy on `main` (`TenantResolver.Populate` in `api/Auth.cs`; `franchiseeId` boundary, `brandId` grouping). alpha's read model (`territory_period_summary`, CONTRACT §1) lands before/with you. The dashboard API is built to the frozen `docs/dashboard/CONTRACT.md` §2.

## Your worktree
- Path: `hfc-demo-worktrees/bravo`
- Branch: `bravo` · Base + target: `main`

## Mission
Rebase the dashboard API onto `main`. Three jobs: (a) **DROP your `Auth.cs` deletion** — keep Slice A's auth; (b) **rewire** `DashboardScopeResolver.ScopeFor()` from the `X-Dashboard-Role` / `X-Franchisee-Id` headers to Slice A's claim seam (`TenantResolver.Populate` / `ctx.User`); (c) swap `StubDashboardReadModel` for an EF-backed read of alpha's `territory_period_summary` behind the existing `IDashboardReadModel` — **NO DTO change**.

## Scope
- You own: `api/Dashboard/*` (contracts, endpoints, scope, read-model adapter).
- You may edit (additively): `api/Program.cs` (DI / middleware).
- Do NOT edit: the §2 DTO shapes (frozen — charlie binds to them); `api/Auth.cs` (keep it).

## Required first steps
1. Run:
   ```bash
   git status --short && git branch --show-current
   git fetch origin && git rebase origin/main
   ```
2. Inspect `api/Auth.cs` (`TenantResolver`, claim names) and alpha's `IDashboardReadModel` / `territory_period_summary`.

## Implementation requirements
- RBAC scope (corporate = all / franchisee = own) applied **pre-query**; read role + franchiseeId from the token claim, not headers. Cross-tenant → 403; unknown id → 0 rows (fail-closed).
- Keep the additive v1.1 `GET /api/dashboard/map`. Do NOT add coords to the D9 territory-list item (that breaks the frozen §2 shape).
- Keep read-only projections — nothing scored or aggregated at request time.

## Shared contracts (do not change)
All five endpoints return CONTRACT §2 shapes byte-for-byte; every metric carries `provenanceType` + `asOfDate` + `refreshStatus`; `financialScore` may be `null` → `pending_financial_reporting`.

## Test gate (green before PR)
```bash
dotnet build api/api.csproj
./e2e/smoke-api.sh
# smoke all 5 endpoints; verify cross-tenant 403 + unknown-id fail-closed
```

## Git rules
Work only on this branch. Don't merge or force-push (rebasing your own branch is fine). Conventional commits, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Done when
Rebased on `main`; builds green; RBAC reads the token claim; stub swapped to alpha's EF read with zero DTO change; all endpoints smoke green.

## Handoff
Summary · files changed · tests run + results · note the scope-source change (header→claim) · risks · draft PR description.
