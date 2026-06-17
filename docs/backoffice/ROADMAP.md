# Back-Office "Powerhouse" — Roadmap & Worktree Delegation (Wave 1)

**Initiative:** Turn the 3-surface demo into an enterprise back-office for the HFC franchisor org — a
real navigation framework with more pages/features, anchored by a **full custom report builder** and a
**Territory Explorer** ("exactly where every territory is at"), plus polished sections for **Users & Roles**
and **Org & Catalog** (real where cheap, "coming soon" otherwise).

**Decided (user, 2026-06-16):**
- Reporting depth = **Full report builder** (metric × dimension × period composition; run → table + chart;
  CSV/XLSX export; save reports). Scheduling/sharing = "coming soon".
- Back-office sections in Wave 1: Reports hub, Territory Explorer + scorecard, Users & Roles, Org & Catalog.
- Redesign (PR #46 theme system) is already **live** — everything here uses the new design tokens, no raw hex.

---

## Current app (build on this)
- One shell (`web/src/app/app-shell.ts`), scope-aware nav, RBAC guards (`auth/auth.guard.ts`:
  `corporateGuard`, `franchiseeGuard`).
- Routes (`web/src/app/app.routes.ts`): `/login`, `/corporate` (Executive), `/dashboard` (Operator),
  `/booking` (Scheduling).
- Corporate read-model + endpoints already exist (`api/Dashboard/**`, `api/DashboardReadModel.cs`,
  `api/Endpoints/**`, `/api/territories`, `/api/dashboard/*`). Reporting reads down from these.
- charlie's worktree holds an **export head start**: `web/src/app/shared/excel-export.util.ts` + `exceljs`
  dep (uncommitted) — folds into the Reports lane.

---

## Lanes → worktree slots (DISJOINT paths → parallel-safe)

| Slot | Lane | Mission | Owns (only) | Branch |
|---|---|---|---|---|
| **chore-modularize** | **A — Foundation + admin stubs** | Back-office shell, scope-aware nav, route table, reusable `ComingSoon`, back-office home, + Users&Roles / Org&Catalog stub sections. Lands FIRST. | `web/src/app/app-shell.ts`, `web/src/app/app.routes.ts`, `web/src/app/backoffice/{shell,shared,home,admin}/**` + **stub files** at the reports/territories paths | `feat/backoffice-shell` |
| **alpha** | **B — Reporting API** | Reporting read-model + endpoints: metric/dimension catalog, query, saved-report CRUD. Publishes the contract early. RBAC read-down + problem+json. | `api/**` (new `api/Reporting/**` + `api/Endpoints/ReportingEndpoints.cs`) | `feat/reporting-api` |
| **charlie** | **C — Report builder UI (flagship)** | Full builder: pick metrics × dimensions × period → run → table + chart → CSV/XLSX export → save. Folds in the exceljs head start. | `web/src/app/backoffice/reports/**` | `feat/report-builder-ui` |
| **bravo** | **D — Territory Explorer + scorecard** | Sortable/filterable territory list → per-territory scorecard drill-down. Reads existing territory + read-model data. | `web/src/app/backoffice/territories/**` | `feat/territory-explorer` |
| **delta** | **E — Infra/CI hardening** | Fix `deploy.sh` region/idempotency (the centralus↔eastus2 snag), make it code-only-redeploy capable, add a back-office CI gate. | `infra/**`, `.github/**`, `scripts/**` | `chore/deploy-hardening` |
| **echo** | **F — e2e / QA** | Drive the new back-office nav + report-builder happy path + territory drill-down; assert RBAC scope (back-office = corporate-only); keep post-deploy gate green. Folds in the existing assertion-hardening. | `e2e/**` | `test/backoffice-e2e` |

---

## Shared contracts (freeze before parallel work)

### Contract 1 — Route + Nav (Lane A is single writer of routing/shell)
Back-office mounts at **`/back-office`**, guarded by `corporateGuard` (corporate scope only). Child routes,
each lazy-loading a component at a FIXED path + export name:

| Path | Component (export) | File (owner) |
|---|---|---|
| `/back-office` | `BackOfficeHomeComponent` | `backoffice/home/back-office-home.component.ts` (A) |
| `/back-office/reports` | `ReportBuilderComponent` | `backoffice/reports/report-builder.component.ts` (C) |
| `/back-office/territories` | `TerritoryExplorerComponent` | `backoffice/territories/territory-explorer.component.ts` (D) |
| `/back-office/territories/:id` | `TerritoryScorecardComponent` | `backoffice/territories/territory-scorecard.component.ts` (D) |
| `/back-office/admin/users` | `UsersRolesComponent` | `backoffice/admin/users-roles.component.ts` (A, stub) |
| `/back-office/admin/org` | `OrgCatalogComponent` | `backoffice/admin/org-catalog.component.ts` (A, stub) |

**Anti-collision rule:** Lane A lands FIRST and commits **working stub files** at the reports/territories
paths (each renders `<bo-coming-soon>`). Routing + nav are written ONCE by Lane A and never touched again.
Lanes C and D branch off post-A `main` and **overwrite only their own files** (same path + export name). No
feature lane edits `app.routes.ts` or `app-shell.ts`. Nav shows a **"Back office"** entry only for corporate scope.

Reusable `ComingSoonComponent` (selector `bo-coming-soon`, input `feature`/`eta`) lives at
`backoffice/shared/coming-soon.component.ts` — used by every not-yet-real section.

### Contract 2 — Reporting API (Lane B is single writer; publish to `docs/backoffice/CONTRACTS.md` first commit)
All corporate-scope, RBAC read-down (scope from token, never a header), problem+json on error, additive
(no breaking schema changes; any new table = additive migration owned by B).

- `GET  /api/reports/catalog` → `{ metrics:[{key,label,unit,format,provenance}], dimensions:[{key,label}], periods:[...] }`
- `POST /api/reports/query` body `{ metrics:[], dimensions:[], filters:{brandId?,regionId?,territoryId?}, period }`
  → `{ columns:[{key,label,format}], rows:[ {<dim>:..,<metric>:..} ], meta:{ provenance, generatedAt, scope } }`
- `GET/POST/PUT/DELETE /api/reports/saved` → saved report definitions CRUD (save real; **schedule/share = coming soon**).

### Contract 3 — Export (Lane C, client-side)
Export the current query result to CSV + XLSX **client-side** via `exceljs` (charlie's `excel-export.util.ts`,
relocated to `backoffice/reports/` or `backoffice/shared/`). No API change for export.

### Contract 4 — Theme/RBAC (all lanes)
Use design tokens (`var(--accent)`, `var(--surface)`, `var(--ink)`, …) only — no raw hex. Back-office is
corporate-only; reporting/territory data reads DOWN per caller scope (enforced server-side in Lane B).

---

## Git flow & merge order
Lightweight GitHub Flow — feature branch → PR → `main`, merge-when-green, rebase after each merge.

**Merge order:**
1. **chore-modularize / Foundation** (gates the UI lanes — provides routes + stubs)
2. **alpha / Reporting API** (publishes contract + endpoints; unblocks C's real data) — *develops in parallel, merges 2nd*
3. **delta / Infra** — independent, merge anytime
4. **charlie / Reports UI** + **bravo / Territory** — after Foundation; charlie builds on B's contract (mock until B lands)
5. **echo / e2e** — last, after surfaces land

## Branch setup (run from repo root, after Foundation guidance below)
- **charlie**: KEEP the exceljs WIP. Create `feat/report-builder-ui`; relocate `excel-export.util.ts` into the
  reports feature; keep the `exceljs` dep. (The franchisee action-table export edit is optional — drop unless wanted.)
- **bravo**: its `feat/dark-hfc-accents` is the rejected accent theme (superseded by #46). Start fresh
  `feat/territory-explorer` off `main`; the old branch stays for history.
- others: fresh branch off `main` (Foundation lands first, then feature lanes rebase onto it).

## Risks
- Routing/shell is the one shared web surface — mitigated by Lane A single-writer + stub-file handoff + strict sequencing.
- Reporting API contract drift — mitigated by B publishing `CONTRACTS.md` before C starts; C mocks against it.
- charlie WIP loss — explicitly preserved/relocated, not discarded.
- "Full builder" is the biggest piece — Wave 1 = compose+run+export+save; pivot/schedule/share are "coming soon".
