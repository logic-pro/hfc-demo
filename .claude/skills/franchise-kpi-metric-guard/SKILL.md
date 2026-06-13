---
name: franchise-kpi-metric-guard
description: Define, review, or implement franchisor KPIs for an executive dashboard or corporate reporting layer. Use when writing KPI definitions/formulas, checking metric derivability and source-of-truth, catching misleading metrics (deposit/estimate treated as revenue, bookings as growth), or guarding against vanity dashboards. Enforces strict metric definitions tied to the four CEO decisions.
---

# Franchise KPI Metric Guard

## Purpose

Use this skill when defining, reviewing, or implementing franchisor KPIs for an executive dashboard, corporate reporting layer, or franchise performance analytics system.

This skill prevents misleading metrics, incorrect revenue assumptions, vanity dashboards, and operational metrics being mislabeled as franchisor economics.

It focuses on metric definitions, derivability, source-of-truth rules, and CEO decision value.

---

## Core principle

Every franchisor KPI must answer one of four CEO decisions:

1. Where should corporate invest marketing/support dollars?
2. Which franchisees need intervention before failure or churn?
3. Where should the company grow territories or brands?
4. What will royalty revenue be, and is it being collected?

If a metric does not support one of those decisions, it is secondary or should be removed from the executive landing screen.

---

## Metric classification

Classify every metric as one of:

| Type              | Meaning                                    |
| ----------------- | ------------------------------------------ |
| P&L metric        | Directly tied to franchisor revenue        |
| Health metric     | Measures franchisee/network performance    |
| Growth metric     | Measures network expansion or white space  |
| Leading indicator | Predicts future royalty or risk            |
| Brand moat metric | Measures loyalty/reputation                |
| Vanity metric     | Looks useful but does not drive CEO action |

---

## Required KPI dictionary format

When defining KPIs, use this format:

```markdown
## KPI: [Name]

### CEO decision
[Invest / intervene / grow / forecast/collect]

### Definition
[Plain-English definition]

### Formula
[Exact calculation]

### Grain
[Portfolio / brand / territory / franchisee / month / quarter]

### Required source fields
- [field]

### Derivable today?
Yes / No / Proxy only

### Current proxy, if needed
[Proxy metric and limitations]

### Drill-down
[Where CEO/admin goes next]

### Risks / caveats
[How this metric can mislead]

### Recommended visualization
[Tile / sparkline / bar / heat grid / histogram / map]
```

---

## Tier 1 — Royalty and revenue health

These metrics are the CEO's real franchisor economics.

### System-wide gross sales

Definition:

```text
Sum of completed-job realized revenue across all active franchise territories for the selected period.
```

Formula:

```text
system_wide_gross_sales = SUM(completed_job.invoiceAmount)
```

Required fields:

* completed job identifier
* completed status/date
* territory ID
* brand ID
* invoice amount or realized revenue

Do not use:

* deposit amount
* estimate amount
* quote amount
* open appointment value

unless explicitly labeled as a proxy.

---

### Royalty revenue

Definition:

```text
Franchisor royalty income calculated from franchisee gross sales and royalty rate.
```

Formula:

```text
royalty_revenue = SUM(completed_job.invoiceAmount * territory.royalty_rate)
```

Required fields:

* completed job invoice amount
* territory royalty rate
* completed date
* territory ID
* brand ID

Risk:

If royalty rates vary by brand, territory, legacy agreement, promotional period, or contract type, the rate must come from territory/agreement metadata.

---

### Royalty collection rate

Definition:

```text
Percentage of royalty billed that has been collected.
```

Formula:

```text
royalty_collection_rate = collected_royalties / billed_royalties
```

Required fields:

* royalty billed amount
* royalty collected amount
* due date
* paid date
* territory/franchisee ID

Requires billing/AR data.

---

### AR aging

Definition:

```text
Unpaid royalty balances grouped by age bucket.
```

Buckets:

```text
0–30
31–60
61–90
90+
```

Use this to identify cash risk and franchisee stress.

---

### Average revenue per territory

Formula:

```text
avg_revenue_per_territory = system_wide_gross_sales / active_territory_count
```

Use with caution.

Always segment by:

* brand
* market maturity
* territory age
* geography
* seasonality

---

### Royalty forecast

Definition:

```text
Projected royalty revenue for next period using trailing revenue, pipeline, booking trends, completion rate, seasonality, and royalty rates.
```

Do not overstate confidence.

Include:

* forecast value
* confidence band
* key drivers
* assumptions

---

## Tier 2 — Same-territory growth and franchisee distribution

### Same-territory sales growth

This is one of the most important franchisor health metrics.

Definition:

```text
Year-over-year sales growth for territories active in both comparison periods.
```

Formula:

```text
same_territory_growth =
  (current_period_sales_same_territories - prior_period_sales_same_territories)
  / prior_period_sales_same_territories
```

Rules:

* compare only territories active in both periods
* do not include newly sold territories unless they meet inclusion criteria
* define territory maturity threshold
* segment by brand
* avoid masking weak existing territories with new-unit growth

---

### Performance distribution

Definition:

```text
Territories grouped into quartiles or bands based on revenue or performance score.
```

Recommended bands:

```text
Top quartile
Upper-middle quartile
Lower-middle quartile
Bottom quartile
Below floor / at risk
```

If revenue exists, rank by revenue and growth.

If revenue does not exist, rank by composite performance score.

---

### At-risk territories

Definition:

```text
Territories below a defined revenue, growth, conversion, NPS, or collection threshold.
```

Possible risk inputs:

* revenue below floor
* negative same-territory growth
* low booking volume
* low conversion
* high cancellation/no-show
* low NPS
* low review rating
* late royalty payments
* upcoming agreement expiration
* low utilization
* no first revenue after open date

Output should be an action list, not just a count.

---

### Top 10 / Bottom 10 territories

Use for drill-down.

Show:

* territory
* brand
* market
* revenue or proxy score
* growth %
* NPS
* conversion
* collection status
* reason flagged

---

## Tier 3 — Network growth and churn

### Active vs sold vs available territories

Definitions:

```text
Active = operating and producing revenue/activity
Sold = agreement signed but not necessarily active
Available = inventory not sold or assigned
```

Requires territory inventory.

Do not infer white space from absence of activity alone.

---

### New franchise sales

Use the franchise-development CRM pipeline.

Track:

```text
Lead → qualified → discovery → validation → agreement sent → signed
```

Metric examples:

* leads created
* qualified leads
* signed agreements
* conversion rate
* average cycle time
* pipeline value by brand/market

---

### Franchisee churn / renewal rate

Requires:

* agreement start date
* agreement expiration date
* renewal status
* termination status
* transfer status

This is a retention and revenue-risk metric.

---

### Time-to-first-revenue

Formula:

```text
time_to_first_revenue = first_completed_revenue_date - territory_open_date
```

This measures ramp quality.

---

## Tier 4 — Demand and conversion

These are leading indicators, not final franchisor P&L.

### Booking volume

Use as demand pulse.

Segment by:

* brand
* territory
* time period
* lead source

Do not treat bookings as revenue.

---

### Lead → booked → completed conversion

Recommended funnel:

```text
lead
→ quote/estimate
→ booked appointment
→ completed job
→ invoice/revenue
→ royalty billed
→ royalty collected
```

If invoice/revenue is missing, state the gap.

---

### Quote win-rate

Formula:

```text
quote_win_rate = booked_estimates / total_sent_estimates
```

Requires estimate status.

---

### Average ticket

Prefer:

```text
completed_job.invoiceAmount average
```

Fallback proxy:

```text
estimate amount average
```

Label the fallback clearly as quoted average ticket, not realized average ticket.

---

### No-show / cancellation rate

Formula:

```text
cancellation_or_no_show_rate =
  canceled_or_no_show_appointments / scheduled_appointments
```

This is a lost-demand and experience-quality signal.

---

### Crew/slot utilization

Formula:

```text
utilization = booked_slots / available_slots
```

Use carefully across franchisees because capacity definitions can vary.

---

## Tier 5 — Customer and brand health

### NPS

Track by:

* brand
* territory
* cohort
* period

Use as customer loyalty and franchisee validation signal.

---

### Review volume and rating

Track:

* average rating
* review count
* review velocity
* review response rate

This supports local demand and franchisee validation.

---

### Repeat/referral rate

Definition:

```text
Share of customers or jobs sourced from repeat business or referrals.
```

This is a low-cost demand indicator.

---

### Cross-brand customer overlap

Only use if identity and consent architecture supports it.

Do not join customer identities across brands without an approved identity plane and consent model.

---

## Derivability labels

For every metric, label it as:

```text
Derivable today
Derivable with proxy
Requires new field
Requires new system
Phase 3 / identity-consent required
```

Recommended interpretation:

| Metric                      | Label                                         |
| --------------------------- | --------------------------------------------- |
| Booking volume              | Derivable today                               |
| Conversion funnel           | Derivable today if statuses are reliable      |
| Quote win-rate              | Derivable today if Estimate status exists     |
| NPS                         | Derivable today if NpsSurvey exists           |
| Referral rate               | Derivable today if Referral exists            |
| Active territories          | Derivable today if territory status exists    |
| System-wide gross sales     | Requires completed-job revenue                |
| Royalty revenue             | Requires completed-job revenue + royalty rate |
| Royalty collection          | Requires billing/AR data                      |
| Same-territory sales growth | Requires revenue history                      |
| White space                 | Requires territory inventory                  |
| Churn/renewal               | Requires agreement metadata                   |
| Cross-brand overlap         | Requires identity plane + consent             |

---

## Misleading metric rules

Flag these immediately:

| Bad assumption                         | Correction                                               |
| -------------------------------------- | -------------------------------------------------------- |
| Deposit = revenue                      | Deposit is cash movement or placeholder, not gross sales |
| Estimate = revenue                     | Estimate is quoted potential, not realized revenue       |
| Booking count = growth                 | Growth must include completed revenue or validated proxy |
| New units = network health             | Existing-territory growth may still be weak              |
| Average hides distribution             | Use quartiles/histograms                                 |
| Active appointment = royalty           | Royalty requires completed revenue and rate              |
| Missing activity = available territory | White space needs territory inventory                    |
| Customer overlap is harmless           | Requires identity/consent governance                     |

---

## Standard output format

Use this format when reviewing metrics:

```markdown
## Franchise KPI Metric Guard

### Metric reviewed
[Metric name]

### CEO decision supported
[Invest / intervene / grow / forecast/collect]

### Correct definition
[Definition]

### Correct formula
[Formula]

### Grain
[Portfolio / brand / territory / period]

### Required fields
- [field]

### Derivable today?
[Yes / proxy / no]

### Proxy if needed
[Proxy + caveat]

### Misuse risk
[How this could mislead the CEO]

### Recommended visualization
[Tile / chart / heat grid / histogram / map]

### Recommendation
[Use / use with caveat / do not use / add data field first]
```

---

## Preferred stance

Be strict.

A CEO dashboard must not look full while answering the wrong questions.

Prioritize:

1. royalty economics
2. same-territory growth
3. at-risk territories
4. brand comparison
5. territory distribution
6. white space
7. leading indicators

Reject or demote:

* raw activity counts
* vanity funnel metrics
* unsegmented averages
* operational details without executive action
* revenue proxies labeled as revenue

---

## Final rule

End every response with:

```text
Metric recommendation:
Data gap:
CEO decision supported:
Next step:
```
