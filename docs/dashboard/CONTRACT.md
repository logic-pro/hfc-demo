# Dashboard Build — Frozen Contract (the parallelism spine)

> This file is the coordination spine for the parallel dashboard build across the
> **alpha / bravo / charlie** worktrees. Alpha builds the read model to this schema,
> Bravo builds APIs to these DTOs, Charlie builds the UI to these DTOs. **Build to
> this contract, not to each other.** Any change here is a cross-stream event:
> edit this file, bump the version, and ping the other leads before diverging.

**Contract version:** `v1` · **Target:** Demo v1 ("demo now, real platform later")
· **Source of truth for rationale:** the tech spec + ROADMAP §0 + the three
`franchise-*` / `corporate-rollup-*` skills.

---

## 0. Design decisions locked for v1 (from the review)

| Decision | v1 choice | Why |
|---|---|---|
| Metric storage | **Wide, typed summary table** (NOT EAV) | Type safety + no request-time pivot at demo scale; EAV is a Track-2 option only if runtime-pluggable metrics are needed |
| Grains materialized | **territory+month** only; brand/region/corporate **rolled up in the job** | One materialized grain keeps the demo small; aggregation lives in `RecomputeRollup`, never at request time |
| Projection clock | **One on-demand / boot-time `RecomputeRollup`** | No streaming infra for the demo |
| Health score | **4 sub-scores + composite**, hardcoded-but-documented weights, `financial = null → pending` | Sub-scores are the high-value idea; version/tenure/archetype config tables are Track 2 |
| Provenance | **Every metric carries `provenanceType` + `asOfDate` + `refreshStatus`** | The star feature — turns the data gap into a feature |
| RBAC | **Two lenses: `corporate` (all) + `franchisee` (own)**, scope = a filter applied pre-query | Proves the boundary; 5 roles are Track 2 |
| Same-territory growth | **seeded-only**, always labeled | Needs ≥2yr reported revenue history that doesn't exist |
| Latency SLAs | **Azure-SQL targets, not demo gates** | SQLite/F1 won't hit them; pre-aggregation gives the shape |

**Measured plane (real in the demo):** `jobs_completed`, `slot_fill_rate`,
`no_show_rate`. **Seeded plane (labeled Illustrative):** all financials
(`gross_revenue`, `royalty_*`, `same_territory_growth`, `mrr`), `nps_score`*,
`google_rating`, `quote_to_close`.

`*` NPS flips `seeded → measured` when Slice C (NPS pipeline) merges — a one-line
data-source change (issue D-NPS-SWAP), NOT a blocker.

---

## 1. Read-model table (Alpha owns) — `territory_period_summary`

Wide, typed, one row per `(territory_id, period_id)`. Each metric group carries its
own provenance trio. SQLite-friendly types in parens.

```
territory_id            (INTEGER)   FK
brand_id                (INTEGER)   denormalized for fast filter
region_id               (INTEGER)   denormalized
franchisee_id           (INTEGER)
period_id               (INTEGER)   YYYYMM
period_start            (TEXT/DATE)
period_end              (TEXT/DATE)
tenure_band             (TEXT)      launch|ramping|established|mature

-- measured plane (real)
jobs_completed          (INTEGER)   provenance: measured
slot_fill_rate          (REAL)      0..1, measured
no_show_rate            (REAL)      0..1, measured

-- seeded plane (illustrative; labeled in API)
gross_revenue           (REAL)      seeded
royalty_rate            (REAL)      0..1, seeded
royalty_revenue         (REAL)      = gross_revenue * royalty_rate, derived/seeded
royalty_collected       (REAL)      seeded
same_territory_growth   (REAL)      seeded (needs history)
nps_score               (INTEGER)   0..100 NPS scale; seeded -> measured on Slice C
google_rating           (REAL)      seeded
quote_to_close          (REAL)      0..1, seeded

-- scores (Alpha computes in RecomputeRollup; see §3)
financial_score         (REAL NULL) null => pending_financial_reporting
customer_score          (REAL NULL)
growth_score            (REAL NULL)
compliance_score        (REAL NULL)
composite_score         (REAL)      0..100, for sort/color only
score_version           (TEXT)      e.g. "franchise_ops_v1"
score_status            (TEXT)      complete|partial|pending_financial_reporting

-- provenance / freshness (per-row summary; per-metric trio derived from plane)
as_of_measured          (TEXT/DATE)
as_of_reported          (TEXT/DATE)
refresh_status          (TEXT)      current|stale|missing|pending|seeded
loaded_at               (DATETIME)
```

Brand/region/corporate roll-ups are computed from this table **inside the job** and
may be cached in memory or a tiny `*_summary_cache` — they are **not** separate
materialized grains for v1.

---

## 2. API DTOs (Bravo owns) — Charlie builds against these exact shapes

All endpoints: **read-only**, **scope-filtered before query**, every metric carries
provenance. Period defaults to latest; `trailingWindow` months optional.

### `GET /api/territories?brandId&regionId&status&archetype&page&pageSize`
```json
{ "items": [ { "territoryId":1, "territoryName":"Orange County North",
  "brandId":1, "brandName":"Budget Blinds", "regionId":1, "regionName":"West",
  "franchiseeName":"Example Franchisee", "openDate":"2022-04-01",
  "tenureBand":"mature", "archetype":"project_installation", "status":"open" } ],
  "page":1, "pageSize":50, "totalCount":24 }
```

### `GET /api/dashboard/corporate?period&trailingWindow&brandId?&regionId?`
```json
{ "period": { "periodId":202605, "label":"May 2026", "trailingWindowMonths":12 },
  "scope": { "scopeLevel":"corporate", "territoryIds":[] },
  "vitalSigns": [
    { "metricKey":"jobs_completed_ltm", "label":"Jobs Completed LTM", "value":18520,
      "unit":"count", "trendDirection":"up", "trendPercent":6.1,
      "provenanceType":"measured", "asOfDate":"2026-06-12",
      "refreshStatus":"current", "confidenceLevel":"high" },
    { "metricKey":"system_revenue_ltm", "label":"System Revenue LTM", "value":42800000,
      "unit":"dollars", "provenanceType":"seeded", "asOfDate":"2026-05-31",
      "refreshStatus":"seeded", "confidenceLevel":"low" } ],
  "brandComparison": [
    { "brandId":1, "brandName":"Budget Blinds", "archetype":"project_installation",
      "territoryCount":8, "compositeHealthScore":78, "financialScore":null,
      "customerScore":74, "growthScore":79, "complianceScore":88,
      "watchlistCount":3, "topIssue":"NPS deterioration" } ],
  "dataNotes": [ { "severity":"info",
    "message":"Financial metrics are illustrative/seeded and lag measured operational metrics." } ] }
```

### `GET /api/territories/{id}/health-score?period`
```json
{ "territoryId":1, "territoryName":"Orange County North", "brandName":"Budget Blinds",
  "regionName":"West", "periodId":202605, "scoreStatus":"partial",
  "scoreVersion": { "scoreVersionId":"franchise_ops_v1", "ownerTeam":"Franchise Ops" },
  "scores": { "composite":67, "financial":null, "customer":42, "growth":71, "compliance":85 },
  "scoreNotes": [ { "type":"missing_input",
    "message":"Financial score pending — current royalty-cycle reporting not received." } ],
  "drivers": [
    { "subScore":"customer", "metricKey":"nps_score", "label":"NPS", "value":34,
      "benchmark":58, "impact":"negative", "severity":"high",
      "provenanceType":"seeded", "asOfDate":"2026-06-12" },
    { "subScore":"growth", "metricKey":"slot_fill_rate", "label":"Slot Fill Rate",
      "value":0.81, "benchmark":0.76, "impact":"positive", "severity":"low",
      "provenanceType":"measured", "asOfDate":"2026-06-12" } ] }
```

### `GET /api/dashboard/watchlist?brandId&regionId&severity&category&status&period`
```json
{ "items": [
  { "watchlistFlagId":"WF-9001", "territoryId":1, "territoryName":"Orange County North",
    "brandName":"Budget Blinds", "regionName":"West", "flagKey":"nps_below_threshold",
    "category":"customer", "severity":"high", "status":"open",
    "currentValue":34, "thresholdValue":50, "detectedAt":"2026-06-12T08:30:00Z",
    "explanation":"NPS below brand threshold; declined two consecutive periods." } ],
  "totalCount":1 }
```

---

## 3. Health score rules (Alpha implements; all leads must agree)

- **Sub-scores** each 0–100 from their metric group, normalized vs brand benchmark,
  **tenure-adjusted** (launch/ramping territories compared to a ramp curve, not the
  mature benchmark). Persist `tenure_band`.
- **Financial sub-score = `null`** whenever required reported inputs are missing →
  `score_status = pending_financial_reporting`. Never fabricate it from seeds for the
  *score* (seeds may still display as labeled tiles).
- **Composite** = weighted mean of *available* sub-scores; used **only** for
  sort/color/map. The scorecard always shows the four sub-scores + top ± drivers.
- **Weights** live in one documented constant block tagged `score_version =
  "franchise_ops_v1"`. (Track 2 moves them to `score_weight_config`.)

## 4. Watchlist rules (Alpha computes in the job; config-driven shape)

Stored as rows; **event publish (`TerritoryFlagged`) is Track 2** (reuses Slice C's
backbone). Demo rules: `nps_below_threshold` (<50), `revenue_deterioration`
(<60% brand avg ×3 periods — seeded), `no_show_spike` (>threshold ×2 periods),
`pending_financial_reporting` (no reported revenue this cycle).

## 5. Coordination rules

1. **Contract changes** = edit this file, bump version, ping the other two leads.
2. **Bravo** may stub the read model (in-memory rows shaped like §1) until Alpha
   lands, then wire to `territory_period_summary`.
3. **Charlie** builds against fixture JSON copied verbatim from §2, then swaps the
   `api.service` base to live Bravo endpoints.
4. **Demo now / real later:** every seeded metric must be *swappable* to measured
   with a data-source change only — no shape changes. If a task forces a shape
   change to support Track 2, it belongs in Track 2.
