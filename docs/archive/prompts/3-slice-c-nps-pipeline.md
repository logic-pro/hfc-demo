# Worktree Lead Prompt — slice-c (NPS pipeline)

You are the lead implementation agent for this worktree. Work only here.

## Repo context
HFC franchise platform demo — ASP.NET Core 9 minimal API + EF Core (SQLite local / Azure SQL) + Angular 20 (standalone components, signals) + Azure Durable Functions. Multi-tenant franchise scheduling for 8 brands across territories. `main` is the always-deployable trunk; we run GitHub Flow with rapid integration: rebase often, merge when green, re-sync after every merge (see `docs/worktrees/WORKTREE-GITFLOW.md`). Slice A established tenancy — tenant + role come from a verified token claim via `TenantResolver.Populate` in `api/Auth.cs`; two-axis (`franchiseeId` = isolation boundary, `brandId` = grouping); EF global query filter, fail-closed.

## Your worktree
- Path: `hfc-demo-worktrees/slice-c-nps-pipeline`
- Branch: `slice-c-nps-pipeline` · Base + target: `main`

## Mission
Land the post-service NPS → review-gen pipeline on `main`. Your branch **conflicts** on `api/AppDb.cs` and `api/Domain.cs` because you edited them before Slice A's two-axis tenancy merged. Reconcile onto Slice A's model, then open a PR.

## Why it matters
NPS is the customer-health signal for the dashboards. A denormalized `TerritoryId` on the survey lets the dashboards flip NPS from seeded → measured with a one-line data-source change (D-NPS-SWAP) — no schema change downstream.

## Scope
- You own: `functions/NpsWorkflow.cs`, the `NpsSurvey` entity, `POST /api/appointments/{id}/nps`, `GET /api/nps`, the smoke-test additions.
- You may edit (to resolve conflicts, additively): `api/Domain.cs`, `api/AppDb.cs`, `api/Program.cs`.
- Do NOT edit: `api/Auth.cs` / `TenantResolver` (keep Slice A's seam — do **not** revert to BrandId-only); anything unrelated.

## Required first steps
1. Run:
   ```bash
   git status --short && git branch --show-current
   git fetch origin
   ```
2. Inspect on `main` BEFORE editing: `api/Auth.cs`, `api/AppDb.cs`, `api/Domain.cs`.
3. Confirm understanding before broad changes.

## Implementation requirements
- `git merge origin/main` (or rebase); resolve `Domain.cs` / `AppDb.cs` to keep Slice A's two-axis model **and** re-add `NpsSurvey`.
- DECISION TO MAKE + DOCUMENT: scope `NpsSurvey` like `Appointment` — add `FranchiseeId` + a franchisee query filter — while keeping `BrandId` + `TerritoryId` denormalized for the dashboard grain. Flag it in the handoff if you choose otherwise.
- Keep the Durable orchestration and the `POST` endpoint **decoupled** (mirrors the booking/deposit split).

## Shared contracts (do not change without flagging)
`NpsSurvey` must stay territory-resolvable without a join — `GET /api/nps` groups by the denormalized `TerritoryId`.

## Test gate (green before PR)
```bash
dotnet build api/api.csproj
./e2e/smoke-api.sh      # target 12/12
```
Confirm a franchisee token cannot read another franchisee's NPS.

## Git rules
Work only on this branch. Don't merge or force-push. Conventional commits, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No new deps without approval.

## Done when
Rebased on `main`; builds green; smoke 12/12; tenancy isolation verified; `NpsSurvey` scope decision documented.

## Handoff
Summary · files changed · tests run + results · the `NpsSurvey` scope decision (and why) · risks · draft PR description.
