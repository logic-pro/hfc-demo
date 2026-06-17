# Status: charlie
_Updated 2026-06-17T04-57-52Z (branch feat/report-builder-ui)_

charlie — REPORT BUILDER UI: DONE, PR #51 open (CI pending).

PR: https://github.com/logic-pro/hfc-demo/pull/51  (base: feat/backoffice-shell — STACKED on Foundation)
Branch: feat/report-builder-ui · 1 commit (e84b9ba) on top of Foundation 4c1a2b8.

WHAT LANDED (allowed_paths web/src/app/backoffice/reports/** + exceljs dep recovery):
- report-builder.component.ts — overwrote the C1 stub; exports ReportBuilderComponent (route already wired).
  Pickers (multi-metric + group-by brand/region/territory + period + chained filters) → Run → table + SVG
  bar chart → Export CSV/XLSX → Save/list/load/delete. Schedule/Share = <bo-coming-soon>.
- reports.models.ts (§C2 contract) · reports.fixtures.ts (deterministic universe + grouped agg + saved store)
  · reports-data.service.ts (mock↔live seam via window.__REPORTS_LIVE__, D17) · report-chart.component.ts
  (hand-rolled SVG, token-only) · excel-export.util.ts (CSV + real XLSX via exceljs, DYNAMIC import → own
  lazy chunk; route chunk ~108 kB, exceljs 1.47 MB loads only on first export).
- web/package.json + package-lock.json: recovered exceljs ^4.4.0 (was installed but undeclared → npm ci would
  have failed). Ignored the out-of-scope franchisee edits in the stash per instructions.

GATE: cd web && npx ng build --configuration development → GREEN. No raw hex in UI (token-only). a11y:
fieldsets/legends, role=radiogroup, aria-pressed/aria-checked, scope=col/row, aria-live regions, focus-visible.
States: loading skeletons, idle/empty 'build your first report', no-rows, and error+retry (catalog & run).
Headless-verified (esbuild+node): run grouping/filter-scoping/sort, CSV, a REAL .xlsx workbook (provenance-
labelled headers + $#,##0/0.0%% number formats), and save→reload→delete.

DEPENDENCIES / NOTES:
- Foundation (feat/backoffice-shell) NOT yet in main — I stacked on it so the build gate passes (needs shell +
  routes + ComingSoon). GitHub will auto-retarget #51 to main when Foundation merges; I'll rebase onto
  origin/main then (Foundation commit drops out).
- alpha feat/reporting-api has ZERO endpoints (no diff vs main) and docs/backoffice/CONTRACTS.md does not exist
  on any branch — so I defined §C2 myself in reports.models.ts and built against the mock. When alpha publishes
  real endpoints, flip __REPORTS_LIVE__; the mock shapes match what I assumed — recommend alpha reviews
  reports.models.ts to converge the contract.
- Untracked .claude/settings.json change (auto-added Bash permission) left unstaged — not mine, out of scope.

NEXT: watching CI on #51; will merge after Foundation lands + rebase, or per your merge-order call.
