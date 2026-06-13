# Worktree Lead Prompt — alpha (corporate read model)

You are the lead implementation agent for this worktree. Work only here.

## Repo context
HFC franchise platform demo — ASP.NET Core 9 minimal API + EF Core (SQLite local / Azure SQL) + Angular 20 + Azure Durable Functions. `main` is the always-deployable trunk; GitHub Flow, rapid integration (see `docs/dashboard/WORKTREE-GITFLOW.md`). Slice A established two-axis tenancy on `main` (`franchiseeId` boundary, `brandId` grouping) via `TenantResolver.Populate` in `api/Auth.cs`. The corporate dashboard read model is built to the frozen `docs/dashboard/CONTRACT.md` §1.

## Your worktree
- Path: `hfc-demo-worktrees/alpha`
- Branch: `alpha` · Base + target: `main`

## Mission
Rebase the read-model spine onto `main`'s `FranchiseeId` model. Your read model is sound — `territory_period_summary` (CONTRACT §1), `RecomputeRollup`, 4 sub-scores + composite (financial=null→pending), watchlist rows, the dramatic seed. The only problem is the tenancy fork: conflicts in `api/AppDb.cs` / `api/Domain.cs` / `api/Seed.cs` because you branched before Slice A.

## Scope
- You own: `api/ReadModel.cs`, `api/Rollup.cs`, the dramatic seed extensions.
- You may edit (to resolve conflicts): `api/AppDb.cs`, `api/Domain.cs`, `api/Seed.cs`, `api/Program.cs`.
- Do NOT edit: `api/Auth.cs` (keep it — do **not** carry your branch's deletion of it).

## Required first steps
1. Run:
   ```bash
   git status --short && git branch --show-current
   git fetch origin && git rebase origin/main      # resolve conflicts
   ```
2. Inspect `main`'s `api/AppDb.cs` / `api/Domain.cs` (the `FranchiseeId` model) before resolving.

## Implementation requirements
- Adopt Slice A's two-axis model in `AppDb` / `Domain` / `Seed`. Keep your read-model tables exactly — and keep them OUT of the tenant query filter (corporate plane, CONTRACT §1).
- Add a comment on `RecomputeRollup`'s `IgnoreQueryFilters()` stating it is the sanctioned corporate cross-tenant aggregator (ADR-19).
- Keep scores (financial=null→`pending_financial_reporting`) and the 4 watchlist rules intact.

## Shared contracts (do not change)
`territory_period_summary` columns = CONTRACT §1. Bravo reads this table via its `IDashboardReadModel`. Don't change column shapes.

## Test gate (green before PR)
```bash
dotnet build api/api.csproj
# boot, reseed, re-run rollup, query the DB: confirm summary row counts + one "red story" (e.g. Atlanta NPS) survived the tenancy restructuring
```

## Git rules
Work only on this branch. Don't merge or force-push (rebasing your OWN feature branch onto main is fine). Conventional commits, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Done when
Rebased on `main`; builds green; rollup produces summary rows; a red story survives; `IgnoreQueryFilters()` justified in a comment.

## Handoff
Summary · files changed · tests run + results · row counts · risks · draft PR description.
