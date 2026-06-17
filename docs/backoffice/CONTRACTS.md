# Back-Office Wave 1 — Interface Contracts

> Coordination spine for Back-Office Wave 1. Each lane builds to the shapes here,
> **not to each other.** Any change is a cross-stream event: edit this file, bump the
> section version, and ping the affected leads before diverging. Mirrors the precedent
> of `docs/dashboard/CONTRACT.md` (the dashboard build's frozen spine).

**Target:** Demo v1 ("demo now, real platform later"). All shapes additive — no breaks.

---

## §C2 — Reporting API (alpha owns) · `v1.0`

A **read-only** reporting layer over the EXISTING corporate read-model
(`territory_period_summary` + `watchlist_flag`, CONTRACT §1). It is a
metric/dimension **query builder**, not a new aggregation plane: the per-territory
metrics and scores are already pre-materialized by `RecomputeRollup`; reporting only
**slices / groups / aggregates** that materialized grain at request time. charlie (Reports
UI) builds against the shapes below.

**Boundaries (frozen):**
- **Corporate-scope only.** All routes require the `Corporate` policy (network / brand /
  region read-down tiers). A franchisee (operator) token → **403**. Same policy + scope
  seam as the dashboard endpoints (`DashboardScopeHolder` / `DashboardScopeResolver`).
- **RBAC reads DOWN.** Every query is filtered to the caller's allowed territory set
  FIRST (network = all; brand = its brand's territories; region = its region's). A
  brand/region principal can never aggregate a territory outside its scope.
- **Provenance rides through.** Every metric carries `provenanceType` + `asOfDate`; the
  response `meta.provenance` summarizes per-metric plane + an `illustrative` flag so
  seeded/illustrative numbers never render as boldly as measured ones.
- **No operational tables.** Reporting reads the pre-aggregated corporate plane only,
  never raw franchisee `Appointment`/`Slot` rows (franchisee-as-data-controller).

### Vocabulary

`provenanceType`: `measured` (app-native: jobs, slot-fill, no-show, survey-measured NPS)
· `seeded` (illustrative/reported: revenue, royalty, growth, ratings, fallback NPS)
· `derived` (a score computed from mixed planes: composite + 4 sub-scores)
· `mixed` (a grouped metric whose contributing rows span >1 plane — only `nps_score`).

`aggregation`: `sum` · `avg` · `count` · `count_at_risk` · `sum_watchlist`.

### Routes

```
GET  /api/reports/catalog                  → ReportCatalogDto
POST /api/reports/query   {ReportQueryRequest} → ReportQueryResultDto
GET    /api/reports/saved                  → SavedReportDto[]
GET    /api/reports/saved/{id}             → SavedReportDto        (404 if not in scope)
POST   /api/reports/saved {SavedReportInput} → SavedReportDto      (201)
PUT    /api/reports/saved/{id} {SavedReportInput} → SavedReportDto (404/403 cross-scope)
DELETE /api/reports/saved/{id}             → 204                   (404/403 cross-scope)
```

### `GET /api/reports/catalog` → `ReportCatalogDto`

```jsonc
{
  "metrics": [
    { "key": "composite_score", "label": "Composite Health Score", "unit": "score",
      "aggregation": "avg", "provenanceType": "derived", "higherIsBetter": true,
      "nullable": false, "description": "Weighted franchise_ops_v1 health score (0–100)." }
    // … see metric keys below
  ],
  "dimensions": [
    { "key": "brand",       "label": "Brand",        "hasId": true  },
    { "key": "region",      "label": "Region",       "hasId": true  },
    { "key": "archetype",   "label": "Archetype",    "hasId": false },
    { "key": "tenure_band", "label": "Tenure Band",  "hasId": false },
    { "key": "territory",   "label": "Territory",    "hasId": true  },
    { "key": "franchisee",  "label": "Franchisee",   "hasId": true  },
    { "key": "status",      "label": "Status",       "hasId": false }
  ],
  "periods": [ { "periodId": 202605, "label": "May 2026", "isLatest": true } ],
  "filters": [ "brandId", "regionId", "archetype", "tenureBand", "status",
               "riskBand", "territoryIds" ]
}
```

**Metric keys (all derivable from `territory_period_summary`):**

| key | unit | agg | provenance | higherIsBetter |
|---|---|---|---|---|
| `composite_score` | score | avg | derived | ✓ |
| `financial_score` | score | avg | derived | ✓ (nullable — pending rows excluded) |
| `customer_score` | score | avg | derived | ✓ |
| `growth_score` | score | avg | derived | ✓ |
| `compliance_score` | score | avg | derived | ✓ |
| `nps_score` | score | avg | measured/seeded/**mixed** | ✓ |
| `jobs_completed` | count | sum | measured | ✓ |
| `slot_fill_rate` | ratio | avg | measured | ✓ |
| `no_show_rate` | ratio | avg | measured | ✗ |
| `gross_revenue` | dollars | sum | seeded | ✓ |
| `royalty_revenue` | dollars | sum | seeded | ✓ |
| `same_territory_growth` | percent | avg | seeded | ✓ |
| `territory_count` | count | count | measured | — |
| `at_risk_count` | count | count_at_risk | derived | ✗ |
| `watchlist_count` | count | sum_watchlist | derived | ✗ |

### `POST /api/reports/query`

**Request — `ReportQueryRequest`:**
```jsonc
{
  "metrics": ["composite_score", "gross_revenue", "at_risk_count"],  // required, ≥1
  "dimensions": ["brand"],                  // 0..n; [] → single grand-total row
  "period": 202605,                          // optional; default = latest
  "filters": {                               // all optional
    "brandId": 1, "regionId": 2,
    "archetype": "recurring_service",
    "tenureBand": "mature", "status": "open",
    "riskBand": "at_risk",                   // healthy(≥70) | watch(50–69) | at_risk(<50)
    "territoryIds": [1, 2, 3]
  }
}
```

**Response — `ReportQueryResultDto`:**
```jsonc
{
  "columns": [
    { "key": "brand", "label": "Brand", "kind": "dimension", "type": "string",
      "hasId": true },
    { "key": "composite_score", "label": "Composite Health Score", "kind": "metric",
      "type": "number", "unit": "score", "aggregation": "avg",
      "provenanceType": "derived", "illustrative": false, "higherIsBetter": true }
  ],
  "rows": [
    { "brand": "Budget Blinds", "composite_score": 71.4, "gross_revenue": 1840000.0,
      "at_risk_count": 1, "dimensionKeys": { "brandId": 1 } }
    // metric cells are number|null (null = no contributing value, e.g. financial pending)
  ],
  "meta": {
    "period": { "periodId": 202605, "label": "May 2026" },
    "scope": { "scopeLevel": "brand", "territoryIds": [1,2,3] },  // echoes RBAC scope
    "rowCount": 1,
    "territoryCount": 3,                       // territories that contributed (post-scope+filter)
    "asOfMeasured": "2026-05-31",
    "asOfReported": "2026-05-31",
    "generatedAt": "2026-06-16T12:00:00Z",
    "provenance": [
      { "metricKey": "composite_score", "provenanceType": "derived",
        "asOfDate": "2026-05-31", "illustrative": false },
      { "metricKey": "gross_revenue", "provenanceType": "seeded",
        "asOfDate": "2026-05-31", "illustrative": true }
    ],
    "notes": [
      { "severity": "info",
        "message": "Financial metrics are illustrative/seeded and lag measured operational metrics." }
    ]
  }
}
```

- `rows[*].dimensionKeys` carries numeric ids for the id-bearing dimensions selected
  (`brandId`/`regionId`/`territoryId`/`franchiseeId`) — for charlie's drill-down.
- A metric whose plane is `seeded` (or `mixed`/`derived` containing seeded inputs) sets
  `illustrative: true` in both its column and its `meta.provenance` entry.

### `SavedReportDto` / `SavedReportInput`

```jsonc
// SavedReportInput (POST/PUT body)
{ "name": "Brand health rollup", "description": "Composite + revenue by brand",
  "definition": { /* a ReportQueryRequest */ } }

// SavedReportDto (responses)
{ "id": "rep_9f3c…", "name": "Brand health rollup",
  "description": "Composite + revenue by brand",
  "definition": { /* the ReportQueryRequest */ },
  "ownerScopeLevel": "brand", "ownerScopeId": 1,
  "createdAt": "2026-06-16T12:00:00Z", "updatedAt": "2026-06-16T12:00:00Z" }
```

**Saved-report RBAC (read-down library):** a saved report is tagged with the scope that
created it. **List/get:** network sees ALL; brand sees network-owned ∪ its-own-brand;
region sees network-owned ∪ its-own-region. **Create:** tagged with the caller's scope.
**Update/Delete:** only on reports the caller's scope owns (network may edit any; a brand
editing another scope's report → 403; a non-existent / out-of-scope id → 404). Persisted
additively in the existing store (`saved_report`, no tenant filter — corporate plane).

### Errors — `application/problem+json` (RFC 7807), uniformly

| case | status |
|---|---|
| no token / not authenticated | 401 |
| franchisee (operator) token on any reporting route | 403 |
| unknown metric key / unknown dimension key / empty `metrics` | 400 (validation problem) |
| unknown `period` | 404 (consistent with dashboard `?period=`) |
| invalid `riskBand` / negative `territoryIds` | 400 |
| saved report id not in caller's scope | 404 |
| update/delete a report owned by another scope | 403 |

---

_Changelog_
- `v1.0` (alpha) — initial Reporting API contract (catalog / query / saved CRUD).
