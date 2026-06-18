# Status: charlie
_Updated 2026-06-17T20-46-08Z (branch feat/report-builder-ui)_

# charlie — Report Builder RE-LANDED for real (PR #59 MERGED to main) ✅

## Ghost-merge recovered
PR #51 was a tip-only ghost merge (stub on main, real work stranded on the branch). Fixed:
- Rebased `feat/report-builder-ui` onto `origin/main` (Foundation #48 dropped out; only my work replayed).
- Opened FRESH PR #59 → CI GREEN (build·test·web·smoke, 1m51s) → squash-merged.
- **Re-verified on origin/main @ 1b513d1**: all 6 reports/ files present; report-builder.component.ts is the
  REAL 1153-line builder (not the ComingSoon stub); live `/api/reports/query` seam present. NOT a ghost this time.

## Reconciled to alpha live §C2 (the branch was built against a divergent mock)
Internal view-model is now IDENTICAL to the shipped wire shapes, so flipping `ReportsDataService.live`
(`window.__REPORTS_LIVE__`) is the only mock→live difference — no shape translation:
- provenanceType {measured|seeded|derived|mixed}; aggregation incl. count_at_risk/sum_watchlist
- POST /api/reports/query (was /run); dimensions[]; flat rows + dimensionKeys; meta.provenance/notes
- saved CRUD on SavedReportInput/Dto (definition shape)
- Catalog ships no filter member lists → discover them contract-faithfully via a territory_count-by-dimension
  probe (dimensionMembers()). Builder is fully catalog-driven (metrics/dims/periods/filters).

## Verified against the RUNNING live API (corporate token)
catalog ✓ · query ✓ (flat rows + dimensionKeys + provenance cols) · discovery probe ✓ ·
saved create→list→delete(204)→get(404) ✓ · operator token → 403 ✓. ng build dev GREEN; prettier applied (D15).

## Scope
Stayed in `web/src/app/backoffice/reports/**` + exceljs dep. Did NOT touch app.routes.ts/app-shell.ts/other lanes.
(.claude/settings.json shows a local working-tree edit — out of scope, NOT in the PR.)

No blockers. Flagship is live on main.
