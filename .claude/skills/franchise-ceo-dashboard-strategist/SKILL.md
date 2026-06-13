---
name: franchise-ceo-dashboard-strategist
description: Design, review, or improve an executive dashboard for a franchisor CEO (multi-brand home-services franchise). Use when shaping a CEO/admin dashboard, choosing hero KPIs, structuring portfolio→brand→territory drill-downs, deciding what numbers a franchisor CEO should see, or pushing back on operator-centric/vanity metrics. Ensures the dashboard answers franchisor network economics, not local operator workflow.
---

# Franchise CEO Dashboard Strategist

## Purpose

Use this skill when designing, reviewing, or improving an executive dashboard for a franchisor CEO, especially for a multi-brand home-services franchise organization.

This skill ensures the dashboard answers franchisor-level business decisions, not local operator workflow questions.

The CEO of a franchisor does not run the jobs. The CEO runs the network.

The dashboard must focus on:

1. Where to invest marketing and support dollars
2. Which franchisees need intervention before failure or churn
3. Where to grow by brand, territory, or white space
4. What royalty revenue will be and whether it is being collected

Do not optimize this dashboard around operational throughput unless the metric clearly rolls up to franchisor economics.

---

## Core mental model

A franchisor CEO cares about network economics.

The franchisor's asset is franchisee success and validation:

* happy franchisees
* growing franchisees
* increasing system-wide sales
* royalty growth
* lower churn
* easier franchise recruitment
* stronger brand validation

Therefore, every dashboard metric should connect to one of these decisions:

| CEO decision     | Dashboard question                                                 |
| ---------------- | ------------------------------------------------------------------ |
| Invest           | Which brand, market, or territory deserves more marketing/support? |
| Intervene        | Which franchisees are at risk before they fail or churn?           |
| Grow             | Where should we sell new territories or expand brands?             |
| Collect/forecast | What royalty revenue is coming, and are we collecting it?          |

---

## Boundary rule

This dashboard must read from the corporate consolidated reporting plane.

It must not directly query raw franchisee operational tables.

Use:

* corporate roll-up
* pre-aggregated summary tables
* bands
* territory-level aggregates
* brand-level aggregates
* portfolio-level aggregates

Avoid:

* raw appointment tables
* raw customer records
* raw franchisee operational scheduling data
* personally identifying customer-level data unless explicitly part of an approved identity/consent plane
* direct cross-franchisee operational joins

The dashboard should answer CEO-level roll-up questions, not inspect Dallas's individual appointments.

---

## Primary dashboard scope

The v1 executive landing screen should contain:

### Hero KPIs

Show approximately 8 tiles, each with:

* current value
* MTD/QTD/YTD toggle where relevant
* YoY delta
* trend sparkline
* status color or signal
* drill-down link

Recommended hero 8:

1. Royalty revenue
2. System-wide gross sales
3. Same-territory sales growth %
4. Active territories and net change
5. Territories at risk
6. Network NPS
7. New franchise sales, pipeline to signed
8. Royalty collection rate

---

## Below-the-fold executive views

After the hero row, include:

### 1. Brand breakdown

A bar chart or heat grid showing each brand's:

* royalty contribution
* system-wide sales
* same-territory growth
* NPS
* active territories
* at-risk territories
* new franchise sales pipeline

This is the CEO's portfolio comparison view.

---

### 2. Territory performance distribution

A histogram or quartile banding view showing territory performance.

Use this to identify:

* top performers to learn from
* middle performers to coach
* bottom performers needing intervention
* territories below a revenue or performance floor

When real revenue is unavailable, use a composite score.

---

### 3. Geographic performance map

Show territories by geography.

Map should support:

* shaded performance
* white-space visibility
* active/sold/available territory status
* brand filter
* at-risk territory overlay
* growth opportunity overlay

---

## Drill path

The dashboard drill path should be:

```text
Portfolio
  → Brand
    → Territory ranking
      → Territory detail
        → Leading indicators
```

Example:

```text
Portfolio view
→ Click Two Maids
→ See territories ranked by royalty, growth, NPS, at-risk score
→ Click a territory
→ See bookings, conversion, utilization, NPS, referrals, quote win-rate
```

The CEO starts with portfolio-level signals.

Admins and operators can drill down to the territory needing action.

---

## KPI tiers

Use these tiers to structure analysis.

---

### Tier 1 — Royalty and revenue health

These are the franchisor's actual P&L metrics.

| Metric                        | Why it matters          |
| ----------------------------- | ----------------------- |
| System-wide gross sales       | Royalty top-line base   |
| Royalty revenue               | Franchisor income       |
| Royalty collection rate       | Cash collection risk    |
| AR aging                      | Franchisee payment risk |
| Average revenue per territory | Network productivity    |
| Royalty forecast              | Board/planning number   |

Important gap:

Real Tier 1 requires completed-job revenue or invoice amount, not deposit stubs or quoted estimate values.

---

### Tier 2 — Same-territory growth and franchisee distribution

This is the clearest health signal.

| Metric                          | Why it matters                           |
| ------------------------------- | ---------------------------------------- |
| Same-territory sales growth YoY | Franchise equivalent of same-store sales |
| Performance distribution        | Shows top/middle/bottom network          |
| Territories below floor         | Intervention list                        |
| Top 10 / Bottom 10 territories  | Direct drill targets                     |

This tier tells the CEO whether the network is getting healthier or just growing by selling new units.

---

### Tier 3 — Network growth and churn

This measures the asset base.

| Metric                                  | Why it matters             |
| --------------------------------------- | -------------------------- |
| Active vs sold vs available territories | White-space and coverage   |
| New franchise sales pipeline            | Development health         |
| Franchisee churn / renewal rate         | Retention risk             |
| Upcoming agreement expirations          | Revenue at risk            |
| Time-to-first-revenue                   | New-territory ramp quality |

---

### Tier 4 — Demand and conversion

These are leading indicators for next-quarter royalties.

| Metric                               | Why it matters              |
| ------------------------------------ | --------------------------- |
| Booking volume and trend             | Demand pulse                |
| Lead → booked → completed conversion | Funnel leakage              |
| Quote win-rate                       | Sales/pricing effectiveness |
| Average ticket                       | Revenue quality             |
| No-show/cancellation rate            | Lost revenue                |
| Crew/slot utilization                | Capacity constraint         |

---

### Tier 5 — Customer and brand health

These are moat and validation metrics.

| Metric                   | Why it matters                                  |
| ------------------------ | ----------------------------------------------- |
| NPS by brand/territory   | Customer loyalty and franchisee validation      |
| Review volume and rating | Local reputation                                |
| Repeat/referral rate     | Low-cost demand                                 |
| Cross-brand overlap      | Multi-brand moat, Phase 3 identity/consent only |

---

## Revenue gap rule

If the system lacks completed-job revenue or invoice amount, say so directly.

Do not pretend deposit amount or estimate amount equals realized revenue.

Use this language:

```text
This dashboard can demo demand and conversion today, but it cannot fully answer royalty economics until completed-job revenue/invoiceAmount and territory royalty_rate exist.
```

Highest-leverage data addition:

```text
completed_job.invoiceAmount
territory.royalty_rate
```

With those two fields, the system can derive:

* system-wide gross sales
* royalty revenue
* same-territory sales growth
* average revenue per territory
* royalty forecast
* at-risk revenue bands

---

## Performance score fallback

When real revenue is unavailable, create a temporary composite performance score.

Example:

```text
performance_score =
  weighted booking volume
  + weighted completed conversion
  + weighted quote win-rate
  + weighted NPS
  + weighted referral/repeat signal
  - weighted cancellation/no-show rate
```

Rules:

* label this as a proxy
* do not call it revenue
* do not use it for royalty calculations
* replace or reweight it once completed-job revenue exists

---

## Anti-vanity rule

Push back when the dashboard is full of activity metrics but lacks CEO decision value.

Vanity metrics include:

* raw appointment count without conversion
* quote count without win-rate
* total leads without stage quality
* bookings without completed revenue
* page views without pipeline impact
* customer activity without territory economics

Good executive metrics connect to:

* royalty revenue
* system-wide sales
* growth
* risk
* churn
* collection
* market expansion
* franchisee support decisions

---

## Standard output format

When asked to design or review the dashboard, respond using:

```markdown
## Franchise CEO Dashboard Review

### Executive decision this supports
[Invest / intervene / grow / forecast/collect]

### Recommended v1 dashboard
[Hero 8 + supporting views]

### Hero KPIs
| KPI | Definition | Source | Gap | Drill-down |
|---|---|---|---|---|

### Brand breakdown
[How brands are compared]

### Territory distribution
[Quartiles/histogram/ranking]

### Geographic map
[Territory and white-space behavior]

### Data gaps
[What exists vs what must be added]

### Metrics to avoid
[Vanity or misleading metrics]

### Recommended next step
[One concrete build step]

### Biggest risk
[Most likely dashboard failure]
```

---

## Pushback rules

Push back if:

* dashboard is operator-centric instead of franchisor-centric
* raw operational tables are queried directly
* appointment volume is treated as revenue
* estimate amount is treated as realized revenue
* deposits are treated as completed job revenue
* no same-territory growth metric exists
* at-risk franchisee count is missing
* brand comparison is missing
* territory distribution is missing
* royalty collection is ignored
* white space is ignored
* dashboard has too many metrics on the landing screen

---

## Final rule

End every response with:

```text
Recommended next step:
Biggest risk:
Architecture decision:
Skill/concept to study next:
```
