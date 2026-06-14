---
name: corporate-rollup-readmodel-architect
description: Design the data architecture for a franchisor executive dashboard or corporate reporting layer. Use when designing read-model/roll-up tables, consolidated reporting flows, aggregation cadence, read-only corporate APIs, data-quality flags, or enforcing the franchisee-as-data-controller boundary. Ensures the dashboard reads from a pre-aggregated corporate read model, not raw franchisee operational tables.
---

# Corporate Roll-Up Read Model Architect

## Purpose

Use this skill when designing the data architecture for a franchisor executive dashboard, corporate reporting layer, or consolidated read model.

This skill ensures the dashboard reads from the corporate roll-up plane instead of raw franchisee operational tables.

It protects the franchisee-as-data-controller boundary while still giving corporate leadership useful aggregate insight.

---

## Core architecture rule

The franchisor CEO dashboard must read from a pre-aggregated corporate read model.

It should not run live analytical queries directly against franchisee operational tables.

Use an upward consolidated reporting flow:

```text
Franchisee operational systems
  → controlled aggregation/extraction
  → corporate reporting/read model
  → executive dashboard
```

The CEO dashboard should consume:

* aggregate metrics
* bands
* summary rows
* territory-level rollups
* brand-level rollups
* portfolio-level rollups

It should not consume raw operational records unless there is a specific approved governance reason.

---

## Why this matters

This architecture supports:

* franchisee data boundary discipline
* lower production query risk
* consistent KPI definitions
* faster dashboard performance
* reduced accidental PII exposure
* auditability
* stable executive reporting
* easier snapshotting and historical comparisons
* simpler forecasting

It also prevents the CEO dashboard from becoming a live operational spying tool.

---

## Recommended architecture

Use a consolidated reporting/read-model design.

```text
Operational Plane
  Appointment
  Estimate
  NpsSurvey
  Referral
  Slot
  Territory
  Franchise Development Lead
  Billing/AR
  Completed Job Revenue

Aggregation Layer
  nightly ETL or scheduled job
  validation
  metric calculation
  data quality checks
  snapshot creation

Corporate Read Model
  portfolio_daily_summary
  brand_daily_summary
  territory_daily_summary
  territory_monthly_summary
  franchise_pipeline_summary
  royalty_ar_summary
  territory_performance_band
  executive_kpi_snapshot

Dashboard/API Layer
  CEO landing API
  brand drilldown API
  territory ranking API
  map API
  KPI trend API
```

---

## Read-model design principles

### 1. Aggregate first

Store the CEO dashboard's primary metrics as precomputed rows.

Avoid recalculating expensive metrics on every dashboard request.

---

### 2. Preserve metric grain

Each row should have clear grain.

Examples:

```text
portfolio + day
brand + day
territory + day
territory + month
brand + quarter
```

Do not mix grains in one table.

---

### 3. Snapshot definitions

Executive reporting should be reproducible.

Store:

* period start
* period end
* calculation timestamp
* source extraction timestamp
* metric version
* data quality status

---

### 4. Separate current view from historical snapshots

Use:

* current summary for fast dashboard tiles
* historical summary for trends and YoY comparisons

---

### 5. Support drill-down without exposing raw operations

The drill path should reveal:

```text
portfolio → brand → territory → aggregate leading indicators
```

Not:

```text
portfolio → brand → territory → individual customer appointments
```

---

## Suggested read-model tables

### executive_kpi_snapshot

Purpose:

Stores the hero KPI row for the CEO dashboard.

Suggested grain:

```text
portfolio + period
```

Fields:

```text
id
period_type
period_start
period_end
system_wide_gross_sales
royalty_revenue
same_territory_growth_pct
active_territory_count
active_territory_net_change
at_risk_territory_count
network_nps
new_franchise_sales_count
royalty_collection_rate
created_at
metric_version
data_quality_status
```

Notes:

* revenue fields may be null until completed-job revenue exists
* include data_quality_status to avoid false confidence

---

### brand_daily_summary

Purpose:

Compares brands across the portfolio.

Suggested grain:

```text
brand + day
```

Fields:

```text
id
brand_id
brand_name
summary_date
gross_sales
royalty_revenue
booking_count
completed_job_count
lead_count
quote_count
quote_win_rate
completion_rate
cancellation_rate
no_show_rate
avg_ticket
nps_score
review_count
avg_review_rating
referral_count
active_territory_count
at_risk_territory_count
same_territory_growth_pct
created_at
metric_version
data_quality_status
```

---

### territory_monthly_summary

Purpose:

Ranks territories and supports same-territory growth.

Suggested grain:

```text
territory + month
```

Fields:

```text
id
territory_id
territory_name
brand_id
brand_name
market
state
month_start
month_end
status
gross_sales
royalty_revenue
royalty_rate
booking_count
completed_job_count
lead_count
quote_count
quote_win_rate
completion_rate
cancellation_rate
no_show_rate
slot_utilization_rate
avg_ticket
nps_score
review_count
avg_review_rating
referral_count
repeat_rate
performance_score
performance_quartile
risk_band
at_risk_reason
created_at
metric_version
data_quality_status
```

---

### territory_inventory_summary

Purpose:

Supports active/sold/available territory and white-space analysis.

Fields:

```text
territory_id
territory_name
brand_id
brand_name
market
state
geo_shape_id
territory_status
sold_date
open_date
franchisee_id
agreement_start_date
agreement_end_date
renewal_status
is_available
created_at
updated_at
```

Notes:

* available territory cannot be inferred only from missing activity
* requires actual territory inventory

---

### royalty_ar_summary

Purpose:

Tracks royalty billing and collection.

Fields:

```text
id
territory_id
brand_id
period_start
period_end
gross_sales
royalty_rate
royalty_billed
royalty_collected
royalty_outstanding
ar_bucket_0_30
ar_bucket_31_60
ar_bucket_61_90
ar_bucket_90_plus
collection_rate
last_payment_date
created_at
data_quality_status
```

Requires billing/AR data.

---

### franchise_pipeline_summary

Purpose:

Tracks franchise-development pipeline.

Fields:

```text
id
brand_id
market
state
period_start
period_end
lead_count
qualified_count
discovery_count
validation_count
agreement_sent_count
signed_count
conversion_rate
avg_cycle_days
created_at
```

---

## Highest-leverage schema addition

To unlock real CEO P&L metrics, add:

```text
completed_job.invoiceAmount
territory.royalty_rate
```

These unlock:

* system-wide gross sales
* royalty revenue
* same-territory growth
* average revenue per territory
* royalty forecast
* at-risk revenue bands

Do not treat deposits or estimates as final revenue.

---

## Aggregation cadence

Recommended v1 cadence:

```text
Nightly canonical summary
```

Use nightly rollups for:

* CEO landing
* same-territory growth
* territory ranking
* brand comparison
* royalty forecast
* at-risk territory list

Use near-real-time only for operational dashboards, not v1 CEO dashboard.

---

## API design

Create read-only corporate reporting APIs.

Suggested endpoints:

```text
GET /api/corporate-dashboard/hero
GET /api/corporate-dashboard/brands
GET /api/corporate-dashboard/territories/distribution
GET /api/corporate-dashboard/territories/rankings
GET /api/corporate-dashboard/map
GET /api/corporate-dashboard/forecast
```

API rules:

* read-only
* corporate/admin authorization required
* no raw customer records
* no raw appointment details
* no franchisee operational mutation
* stable response DTOs
* explicit period filters
* explicit brand/market filters
* cacheable where appropriate
* include data quality flags

---

## Example hero API response

```json
{
  "period": {
    "type": "QTD",
    "start": "2026-04-01",
    "end": "2026-06-30"
  },
  "metrics": {
    "royaltyRevenue": {
      "value": 1250000,
      "yoyDeltaPct": 0.082,
      "sparkline": [110000, 115000, 119000, 123000],
      "dataQuality": "actual"
    },
    "systemWideGrossSales": {
      "value": 25000000,
      "yoyDeltaPct": 0.064,
      "dataQuality": "actual"
    },
    "sameTerritoryGrowthPct": {
      "value": 0.043,
      "dataQuality": "actual"
    },
    "activeTerritories": {
      "value": 412,
      "netChange": 8,
      "dataQuality": "actual"
    },
    "atRiskTerritories": {
      "value": 37,
      "dataQuality": "actual"
    },
    "networkNps": {
      "value": 61,
      "dataQuality": "actual"
    },
    "newFranchiseSales": {
      "value": 14,
      "dataQuality": "actual"
    },
    "royaltyCollectionRate": {
      "value": 0.947,
      "dataQuality": "actual"
    }
  }
}
```

If revenue is unavailable, use nulls and proxy metadata:

```json
{
  "royaltyRevenue": {
    "value": null,
    "dataQuality": "unavailable",
    "gap": "Requires completed_job.invoiceAmount and territory.royalty_rate"
  }
}
```

---

## Data quality flags

Use explicit flags:

```text
actual
proxy
partial
unavailable
estimated
stale
```

Rules:

* do not hide unavailable Tier 1 revenue fields
* do not silently substitute estimate or deposit values
* expose the gap to the UI
* make proxy metrics visually distinct from actual financial metrics

---

## Security and governance rules

Dashboard data must be:

* corporate authorized
* read-only
* aggregated
* auditable
* separated from franchisee operational writes
* free of raw PII unless approved
* scoped by user role
* logged for access if sensitive
* built from approved reporting tables

Avoid:

* raw appointment-level drilldown
* customer-level records
* unapproved cross-brand identity joins
* direct franchisee database access from dashboard
* live queries that stress operational systems
* operational writes from the reporting dashboard

---

## Recommended v1 build scope

Build:

1. hero 8 KPI API
2. brand breakdown API
3. territory distribution API
4. territory ranking API
5. map aggregate API
6. nightly rollup job
7. data quality flags
8. completed-job revenue/invoiceAmount field
9. territory royalty_rate field

Do not build first:

* complex ML forecast
* cross-brand customer overlap
* raw appointment drilldown
* real-time operational command center
* overly detailed franchisee CRM
* full AR module unless billing data already exists

---

## Standard output format

When asked to design architecture or schema, respond with:

```markdown
## Corporate Roll-Up Read Model Architecture

### Business goal
[CEO decision supported]

### Recommended architecture
[Read model / rollup approach]

### Source systems
[Operational inputs]

### Read-model tables
| Table | Grain | Purpose |
|---|---|---|

### Required fields
[Fields needed to unlock Tier 1/Tier 2]

### Aggregation cadence
[Nightly / hourly / event-driven]

### API endpoints
[Read-only corporate endpoints]

### Data quality strategy
[Actual/proxy/unavailable flags]

### Security/governance
[Boundary and access rules]

### Migration/build plan
[Phased implementation]

### Risks
| Risk | Severity | Mitigation |
|---|---|---|

### Recommendation
[Concrete next step]
```

---

## Pushback rules

Push back if:

* dashboard queries raw franchisee operational tables
* CEO dashboard runs live heavy joins
* appointment records are exposed directly
* customer identities are joined across brands without consent plane
* estimates/deposits are treated as revenue
* no data quality flags exist
* same-territory growth cannot be reproduced
* metrics are calculated differently across pages
* no metric versioning exists
* there is no territory inventory for white-space analysis
* the read model does not support historical comparison

---

## Final rule

End every response with:

```text
Recommended architecture:
Highest-leverage data addition:
Governance risk:
Next step:
```
