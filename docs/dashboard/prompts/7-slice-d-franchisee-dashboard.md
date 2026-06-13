# Worktree Lead Prompt — slice-d (franchisee operations dashboard)

You are the lead implementation agent for this worktree. Work only here.

## Repo context
HFC franchise platform demo — ASP.NET Core 9 + EF Core + Angular 20 (standalone, signals) + Azure Durable Functions. `main` is the always-deployable trunk; GitHub Flow, rapid integration (see `docs/dashboard/WORKTREE-GITFLOW.md`). Slice A established tenancy (`franchiseeId` boundary via `TenantResolver.Populate`). This dashboard is the **franchisee operator** view (one franchisee's own territories' bookings/deposits/no-shows) — distinct from charlie's franchisor `/corporate` dashboard.

## Your worktree
- Path: `hfc-demo-worktrees/slice-d-franchisee-dashboard`
- Branch: `slice-d-franchisee-dashboard` · Base + target: `main`

## Mission
Land the franchisee dashboard at `/dashboard`, reconciled into the SINGLE app shell charlie established. Scope the Tailwind v4 import so it can't bleed into the booking demo or charlie's scoped CSS. Merge after charlie.

## Scope
- You own: `web/src/app/dashboard/*` (the franchisee components), `api/DashboardReadModel.cs`, the `GET /api/dashboard` + `GET /api/dashboard/territories` endpoints.
- You may edit (additively): `web/src/app/app.routes.ts` (add `/dashboard`), `api/Program.cs`, `api/Seed.cs`.
- Do NOT edit: charlie's `/corporate` dashboard; the `/booking` component; a competing shell/bootstrap (use the one shell).

## Required first steps
1. Run:
   ```bash
   git status --short && git branch --show-current
   git fetch origin && git rebase origin/main      # after charlie has merged
   ```
2. Inspect on `main`: the single app shell + `web/src/app/app.routes.ts`; your own `web/src/app/dashboard/README.md` + `API-CONTRACT.md`.

## Implementation requirements
- Add `/dashboard` to the existing shell's routes. Do NOT reintroduce `shell.ts` or a second bootstrap.
- Scope the Tailwind v4 `@import` to the dashboard route / a scoped layer so the booking SPA and charlie's scoped CSS are unaffected. Verify `/booking` visually after.
- Keep revenue honest: deposit-volume only, labelled "Job revenue unavailable" — no proxy.
- Manually merge `api/Seed.cs` on top of Slice A's + alpha's seed; boot and confirm BOTH the booking slots AND the dashboard demo data seed.

## Shared contracts
Tenant-scoped via Slice A's filter — a franchisee sees only their own data. Confirm a franchisee token cannot reach `/api/dashboard/corporate`.

## Test gate (green before PR)
```bash
dotnet build api/api.csproj
cd web && npm run build
# run the franchisee dashboard screenshot e2e (desktop + drawer + mobile)
```

## Git rules
Work only on this branch. Don't merge or force-push (rebasing your own branch is fine). Conventional commits, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No new deps without approval.

## Done when
`/dashboard` works in the single shell; Tailwind contained (booking + corporate unaffected); `Seed.cs` merged cleanly; tenant isolation verified; e2e green.

## Handoff
Summary · files changed · the Tailwind scoping approach · tests run + results · risks · draft PR description.
