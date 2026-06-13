# Worktree Lead Prompt — charlie (executive dashboard UI)

You are the lead implementation agent for this worktree. Work only here.

## Repo context
HFC franchise platform demo — ASP.NET Core 9 + EF Core + Angular 20 (standalone components, signals) + Azure Durable Functions. `main` is the always-deployable trunk; GitHub Flow, rapid integration (see `docs/dashboard/WORKTREE-GITFLOW.md`). The corporate dashboard is built to the frozen `docs/dashboard/CONTRACT.md` §2. `main` also carries a now-retired `web/src/app/corporate/` slice (your dashboard supersedes it) plus Slice A's `tenant.interceptor.ts` changes.

## Your worktree
- Path: `hfc-demo-worktrees/charlie`
- Branch: `charlie` · Base + target: `main`

## Mission
Reconcile your executive dashboard into `main` as the franchisor surface at `/corporate`, then flip D17 (fixtures → live bravo). Apply the "best-of-both" grafts harvested from the retired `corporate/` slice.

## Scope
- You own: `web/src/app/dashboard/*` (your exec UI), the routing + single app-shell reconciliation.
- You may edit: `web/src/app/app.routes.ts`, the one app shell, `web/src/index.html`, `web/src/main.ts`, `web/src/styles.css`, `web/src/app/tenant.interceptor.ts`.
- Do NOT edit: the `/booking` demo component; the `api/` backend.

## Required first steps
1. Run:
   ```bash
   git status --short && git branch --show-current
   git fetch origin && git rebase origin/main
   ```
2. Inspect on `main`: `web/src/app/corporate/` (to be retired — harvest the grafts), `web/src/app/tenant.interceptor.ts`, `web/src/app/app.routes.ts`.

## Implementation requirements
- Retire `main`'s `web/src/app/corporate/` Angular components; collapse to ONE shell with routes `/booking` (untouched), `/corporate` (your dashboard), `/dashboard` (slice-d placeholder).
- GRAFT from the retired slice (3 items):
  1. **Auth seam** — in `tenant.interceptor.ts`, skip the franchisee token for bravo's REAL prefixes (`/api/dashboard/`, dashboard `/api/territories*`) and give live mode a corporate-scoped credential. Do this **as part of D17**, not after.
  2. **Null-safe formatting** — make `formatValue` return `'Unavailable'` for `null` (don't render `NaN`/`0`).
  3. **D16 degradation** — a genuinely unsourced metric shows a dashed "unavailable + gap" state, not a fake number.
- Flip `window.__DASHBOARD_LIVE__`; assert one live call per endpoint matches `dashboard.models.ts`.

## Shared contracts (do not change)
`dashboard.models.ts` must stay verbatim CONTRACT §2 (matches bravo). No drift.

## Test gate (green before PR)
```bash
cd web && npm run build      # AOT typecheck must pass
```
No browser in this env — verify via the AOT build + numeric/logic checks, not screenshots.

## Git rules
Work only on this branch. Don't merge or force-push (rebasing your own branch is fine). Conventional commits, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No new deps without approval.

## Done when
One shell + three routes; the 3 grafts applied; D17 live against bravo with zero shape mismatch; AOT build green.

## Handoff
Summary · files changed (incl. retired files) · graft locations · tests run + results · risks · draft PR description.
