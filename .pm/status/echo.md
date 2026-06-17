# Status: echo
_Updated 2026-06-17T05-05-43Z (branch test/backoffice-e2e)_

# echo — Back-Office Wave 1 e2e/QA: drivers delivered (PR #53), staged to frozen contracts

**PR:** #53 → main (`test/backoffice-e2e`). Scope kept strictly to `e2e/**`. Carries my prior 5cf991b hardening.
**CI:** opened; no run registered yet at report time (same state as Foundation PR #48). CI is the merge gate.

## Delivered (against FROZEN CONTRACTS C1/C2 — built now, finalize as lanes land)

### `e2e/drive-backoffice.mjs` (new; auto-collected by post-deploy-e2e `drive-*.mjs` glob)
- **RBAC isolation (the load-bearing assertion):** corporate persona sees the "Back office" nav entry +
  opens `/back-office` (home launcher paints); franchisee persona has NO nav entry AND is bounced off a
  direct `/back-office` deep-link by `corporateGuard`. Both halves asserted → the deny is non-vacuous.
- **Report builder happy path** (run → non-empty table + export control + save round-trip) and
  **Territory drill-down** (non-empty/sorted list → row click → scorecard route + populated detail):
  written to contract, **stub-aware** — `<bo-coming-soon>` → loud SKIP, not a silent pass.
- **Foundation gate:** absent corporate nav entry → one loud SKIP + exit 0 (green pre-merge, no vacuous pass).
- Selectors verified against Foundation source (app-shell / app.routes / auth.guard / back-office-home /
  coming-soon). `outDir(3)` matches the workflow's `<driver> "" <dir>` call convention.

### `e2e/smoke-api.sh` — `/api/reports/{catalog,query,saved}` (C2), presence-gated
Probe catalog; 404 → loud SKIP (Reporting API unmerged). When live: catalog field shapes; query
columns/rows/meta{provenance,generatedAt,scope}; problem+json on bad input; franchisee read-down→403,
brand read-down→200; saved-report CRUD round-trip (create→list→update→delete→gone).

## Validation
- `bash e2e/smoke-api.sh` → **GREEN, 53 checks** locally; reports block correctly takes the SKIP path
  vs current main (no reporting endpoints).
- Browser drivers: **run in post-deploy-e2e CI** (`playwright install --with-deps chromium`).

## BLOCKERS / dependencies (surfaces untestable until lanes land — per assignment, reporting here)
1. **Reporting API (alpha)** — NOT built: no `api/Reporting/**`, `/api/reports/catalog` → 404 on the running
   instance. The smoke C2 block is dormant (SKIP) until alpha merges. Coordinate final field names if they
   extend beyond the frozen C2 shapes.
2. **Report builder UI (charlie)** and **Territory Explorer (bravo)** — only Foundation `<bo-coming-soon>`
   stubs exist; happy-path + drill-down assertions are staged and SKIP until those lanes overwrite the stubs.
3. **Foundation (chore-modularize, PR #48)** — built but not yet merged to main; drive-backoffice nav/RBAC
   assertions activate once it deploys. Only surface currently buildable.
4. **Local browser** — this env's Playwright Chromium can't launch (missing libnspr4, no sudo); browser
   validation is CI-only. Same constraint as all four existing `drive-*.mjs`. Not a blocker for CI.

## Next (on PM signal)
Rebase echo onto main as each lane merges; the stub/presence gates flip the staged assertions
load-bearing automatically. Drive the post-deploy gate green once surfaces are live.
