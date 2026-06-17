# Status: bravo
_Updated 2026-06-17T04-57-56Z (branch feat/territory-explorer)_

bravo — TERRITORY EXPLORER + scorecard drill-down: DONE → PR #52 (CI running).

Branch feat/territory-explorer, rebased onto origin/main AFTER Foundation #48 landed (d7073c1). Overwrote the two C1 stubs; edited ONLY web/src/app/backoffice/territories/** — no app.routes.ts / app-shell.ts / api/** / other lanes touched.

DELIVERED
- Territory Explorer (/back-office/territories): sortable/filterable list of every in-scope territory (name+franchisee, brand, region, composite health w/ banded bar, data-completeness status, open-flag count). Defaults worst-health-first; "At risk" quick filter; brand/region selects (options derived from in-scope rows only — no sibling-brand leak); search. Joins /api/dashboard/watchlist for per-row flags. Row → scorecard. Loading/error+retry/empty states; a11y (aria-sort, scoped row headers, focus-visible, sr-only caption).
- Territory Scorecard (/back-office/territories/:id): composite radial gauge (reused ec-radial-gauge), 4 sub-scores (financial honestly Pending), drivers each w/ provenance badge (Measured/Reported/Illustrative — NPS/bookings/deposits respect provenance), open at-risk flags, score notes. Reacts to :id for neighbour nav; watchlist failure degrades gracefully.

DATA: reused existing read model via DashboardDataService (GET /api/territories, /api/territories/:id/health-score, /api/dashboard/watchlist) + dashboard.models DTOs + ui/health language. NO API change needed.

RBAC: read-down enforced server-side (JWT scope); UI renders only what API returns. Design tokens only.

GATE: cd web && npx ng build --configuration development → GREEN. Both components emit as own lazy chunks.

DELIBERATE OMISSION (honesty): no fabricated per-territory trend line — the contract has no per-territory time series, so I show drivers vs benchmark (real, sourced) instead of inventing a chart. If a historical trend is wanted, it needs an additive read-model endpoint — flagging for alpha rather than writing api/** myself. Routing no inbox note now since trend was not a hard gate item; raise if you want it scheduled for Wave 2.

NEXT: CI green → merge (per merge order, Territory lands after Reporting API). echo can drive the BO territory drill-down e2e against this.
