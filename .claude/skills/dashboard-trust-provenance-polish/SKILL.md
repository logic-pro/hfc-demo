---
name: dashboard-trust-provenance-polish
description: Design, implement, or review honesty/trust/provenance behavior in a BI dashboard when some metrics are measured and others are illustrative, seeded, proxy, partial, stale, or unavailable. Use to stop illustrative numbers ($42.8M, 94.2%) from rendering as boldly as measured ones (18,520, 4), to fix a misleading "LIVE" badge over fixture data, to place provenance so it informs without burying decisions, and to catch small correctness/polish defects (histogram axis below tallest bar, redundant growth delta, missing map insight, fake period controls) that erode executive trust.
---

# Dashboard Trust & Provenance Polish

## 1. When to use this skill

Use this skill whenever a dashboard mixes **measured** data with **illustrative
/ seeded / proxy / partial / stale / unavailable** data and the UI doesn't make
that difference obvious — the fastest way to lose an executive's trust.

Concrete triggers (the current dashboard's actual issues):

* Illustrative hero numbers (`$42.8M`, `$3.0M`, `94.2%`, `4.3%`) render as
  boldly as measured ones (`18,520`, `24`, `4`).
* A top-right **"LIVE"** badge shows while the dashboard runs on fixtures.
* Provenance sits too high and pushes decision content down.
* The growth tile says "Same-Territory Growth 4.3%" **and** "▲ 4.3% YoY" —
  redundant/confusing.
* Histogram y-axis max is below the tallest bar.
* The map lacks a one-line executive insight.
* The period/scope control is static while the dashboard implies time-based
  reporting.

Stack reality (verify before editing): **Angular 20**, signals, `OnPush`. There
is already a `web/src/app/corporate/components/data-quality-badge.component.ts`
(`DataQualityBadgeComponent`) bound to the `DataQuality` union in
`web/src/app/models.ts` (`'actual' | 'proxy' | 'partial' | 'estimated' |
'stale' | 'unavailable'`). **Build on these — do not invent a parallel quality
enum.** The KPI tiles (`components/kpi-card.component.ts`, `KpiCardVm`) and page
(`portfolio-page.component.ts`) already distinguish `measured`/`financial`
helpers; reuse them.

Related skills: `franchise-ceo-dashboard-strategist` (the revenue-gap rule +
proxy-score fallback this skill renders honestly), `franchise-kpi-metric-guard`
(metric definitions), `ceo-dashboard-intervention-loop` (proxy risk scores).

## 2. Data honesty principles

* **Separate what is measured from what is reported or illustrative.** This is
  the dashboard's whole thesis — the UI must visibly honor it.
* **Visual authority must match epistemic authority.** A measured `4` outranks
  an illustrative `$42.8M`. Bold, full-contrast type is earned by real data.
* **Never substitute silently.** A proxy or estimate is labelled as such, in
  place, every time. No proxy wears a measured number's clothes.
* **Unavailable is a first-class, honest state** — show "unavailable," don't
  fabricate or hide the tile.
* **The badge tells the truth about the data, not the deploy.** "LIVE" means a
  live source, not "the app is running."
* **Provenance informs, it doesn't obstruct.** Trust context belongs near the
  decision or in a footer/expandable — not stacked on top of the KPIs.

## 3. Data quality states

Reuse the existing per-metric `DataQuality` union; this skill's interfaces wrap
it with display meaning. The two are distinct levels — **per-metric quality** vs
**whole-dashboard mode**:

```typescript
/** Per-metric provenance — mirrors the existing DataQuality union. */
export type DataQualityState =
  | 'actual'        // measured, app-native, near real-time
  | 'proxy'         // labelled stand-in for the real metric
  | 'illustrative'  // demo/seeded value, NOT measured (visually de-emphasized)
  | 'partial'       // real but incomplete coverage for the period
  | 'estimated'     // modeled estimate
  | 'stale'         // last known value, past refresh window
  | 'unavailable';  // source not wired — shown honestly, not substituted

/** Whole-dashboard data mode → drives the top-right badge. */
export type DashboardDataMode =
  | 'live'       // real sources, fresh
  | 'demo'       // DEMO DATA — illustrative throughout
  | 'fixtures'   // FIXTURES — deterministic test data
  | 'proxy'      // PROXY — composite scores stand in for revenue
  | 'partial';   // PARTIAL — some panels live, some not

export interface MetricProvenance {
  quality: DataQualityState;
  /** Short caveat shown near the metric, e.g. the proxy/unavailable copy. */
  caveat: string | null;
  /** When the underlying value was last refreshed (for stale/live). */
  lastRefreshed: string | null;   // ISO timestamp
  /** Optional human label for the source ("booking-weighted score"). */
  source: string | null;
}

export interface KpiDisplayMeta {
  /** Lower visual authority for non-measured values. */
  emphasis: 'measured' | 'muted';
  provenance: MetricProvenance;
  /** True only for 'actual' (and arguably 'partial') — gates bold styling. */
  isMeasured: boolean;
}
```

`DataQualityState` adds `'illustrative'` to the existing union for demo/seeded
values; if the codebase prefers to keep the existing six, map illustrative →
a `muted` emphasis flag rather than a new enum member. Either way, **one source
of truth** — extend `DataQuality`, don't fork it.

## 4. Styling rules for measured vs illustrative / proxy / unavailable

* **Measured (`actual`):** full weight, full contrast, primary color. This is
  the baseline of authority.
* **Illustrative / proxy / estimated:** **lower visual authority** — reduced
  weight, muted/secondary color, and an inline badge. The number must read as
  "for illustration / stand-in," not as fact. Never bold an illustrative
  `$42.8M` the same as a measured `18,520`.
* **Partial:** measured styling **plus** a "partial" badge and coverage note.
* **Stale:** measured styling dimmed slightly **plus** "Last refreshed: …".
* **Unavailable:** the existing dashed/muted treatment from
  `DataQualityBadgeComponent` — clearly "not wired," visually distinct from a
  red "bad value" and from an error.
* **Consistency:** drive all of this from `KpiDisplayMeta.emphasis` +
  `MetricProvenance.quality`, not per-tile hardcoded styles, so the rule is
  enforced in one place.

## 5. LIVE / DEMO / FIXTURES badge rules

* **Tie the badge to the actual `DashboardDataMode`, never to "the app is up."**
* Allowed states: `LIVE`, `DEMO DATA`, `FIXTURES`, `PROXY`, `PARTIAL`. Pick the
  one that matches the data actually feeding the panels.
* **Do not label fixture/demo data as LIVE.** This is the single most
  trust-destroying defect on the dashboard — fix it first.
* `PARTIAL` when some panels are live and some are not; the badge should be
  hoverable/expandable to say which.
* The badge derives from the same provenance source the tiles use — if any hero
  value is illustrative/fixture, the dashboard is not `LIVE`.
* Badge copy is uppercase, short, and color-coded by trust (green live, amber
  partial/proxy, slate demo/fixtures), with text — never color alone.

## 6. KPI copy rules

* **No redundant metric + delta.** "Same-Territory Growth 4.3%" with "▲ 4.3%
  YoY" repeats one number as both value and delta — meaningless. The delta must
  compare against a *different* reference: prior period or plan/target
  (e.g. value `4.3%`, delta **"vs 5.0% plan"**).
* Every value states its unit and period; deltas state their comparison basis
  ("vs last quarter", "vs 5.0% plan"), never a bare arrow.
* Illustrative values get a short caveat ("Illustrative — pending invoice
  revenue"), not a confident standalone figure.
* Proxy values name what they stand in for ("Proxy: booking-weighted score until
  invoice revenue is available").
* Unavailable values say what's missing ("Revenue unavailable — requires
  completed-job invoice amount"), never `$0` or `—` with no explanation.

## 7. Provenance panel placement guidance

* **Provenance must not push decisions below the fold.** Move the full
  provenance block to a **trust footer** or an **expandable "Data details"**
  panel; keep only lightweight per-metric badges + the mode badge up top.
* The hero KPIs and the at-risk surfaces are the top of the page; provenance is
  context, so it sits beneath or behind a disclosure.
* A one-line trust summary ("Mostly demo data; demand/conversion measured,
  revenue illustrative — see Data details") is the right top-of-page footprint.
* Expandable details list each metric's source, quality, and last-refreshed —
  the honesty is fully available, just not blocking.

## 8. Chart correctness rules

* **Axis must include the data.** Histogram/bar y-axis max ≥ the tallest bar
  (round up to a sensible tick). A bar clipped by the axis reads as a bug and
  undermines every other number. Compute the domain from the data, not a magic
  constant.
* No truncated/baseline-shifted axes that exaggerate change unless explicitly
  labelled.
* Bands/quartiles in the distribution use the same thresholds as the watchlist
  (single source — see `ceo-dashboard-intervention-loop`).
* Empty/insufficient-data charts show an honest "not enough data" state, not a
  flat misleading line.

## 9. Map insight sentence rules

* The map must carry a **one-line executive insight**, e.g.
  *"4 territories at risk, concentrated in the Mountain West and Southeast."*
* The sentence is **derived from the data**, not hardcoded — it updates with
  scope (brand/band/period) and with the actual at-risk set.
* It states the *so-what* (where the risk concentrates / where white space is),
  not a restatement of the legend.
* If the underlying figures are proxy/illustrative, the insight inherits that
  caveat (don't assert a confident geographic claim over demo data).

## 10. Period / scope control rules

* If the dashboard implies time-based reporting, the period control
  (MTD/QTD/YTD/LTM) must be **visible**.
* **Honesty over theater:** a control that isn't wired yet must not *pretend* to
  be. Either wire it (preferred — hand off to `dashboard-crossfilter-scope`'s
  `setPeriod`) or render it visibly disabled with "coming soon"/tooltip.
* The shown period label must match the data actually rendered (don't show "QTD"
  over YTD numbers).
* Period changes re-scope value-bearing panels and update the "Last refreshed" /
  period label together.

## 11. Accessibility requirements

* Provenance and mode are conveyed by **text + shape**, not color alone (the
  existing badge already pairs label text with color — keep that).
* Muted/illustrative styling must still meet AA contrast — "lower authority" ≠
  "unreadable."
* Badges have accessible names/tooltips ("Proxy measure — labelled stand-in")
  reachable by keyboard and screen reader (the existing `title` map is a good
  base; ensure it's also exposed to AT, not just hover).
* Expandable provenance panel is keyboard-operable with proper
  `aria-expanded`/`aria-controls`.
* Disabled period controls expose their disabled state and reason to AT.

## 12. Acceptance criteria

* [ ] No illustrative value renders with the same visual authority as a measured
      value (illustrative/proxy are muted + badged).
* [ ] The top-right badge reflects the real `DashboardDataMode`; fixture/demo
      data is **never** labelled `LIVE`.
* [ ] Every hero metric carries an honest provenance marker (actual / proxy /
      illustrative / partial / stale / unavailable).
* [ ] Provenance detail lives in a footer/expandable; KPIs/decisions are not
      pushed below the fold.
* [ ] The growth tile compares against a different reference (plan/prior period),
      not the same number twice ("4.3%" + "vs 5.0% plan").
* [ ] Histogram/bar axis max includes the tallest bar.
* [ ] The map shows a data-derived one-line executive insight.
* [ ] The period control is visible and either wired or honestly disabled (never
      fake-wired); its label matches the data shown.
* [ ] Financial metrics without completed-job revenue read "unavailable" with a
      reason — no proxy silently substituted for revenue.

## 13. Code review checklist

* [ ] Styling authority is driven by `KpiDisplayMeta`/`DataQuality`, not
      per-tile hardcoding.
* [ ] Mode badge derives from the same provenance source as the tiles (can't go
      `LIVE` while a hero value is fixture/illustrative).
* [ ] No metric reuses its own value as its delta; deltas name a comparison
      basis.
* [ ] Chart axis domain computed from data (≥ max bar); thresholds shared with
      the watchlist.
* [ ] Map insight is derived + scope-aware, not a hardcoded string.
* [ ] Period control state (wired vs disabled) matches reality; label matches
      rendered data.
* [ ] Reuses existing `DataQuality` / `DataQualityBadgeComponent` rather than a
      new parallel enum/component.
* [ ] Provenance detail is below/behind a disclosure; trust summary one-liner up
      top.
* [ ] All states meet AA contrast and expose provenance to AT, not color/hover
      only.
* [ ] Unavailable financials show a reason, never `$0`/proxy-as-revenue.

## 14. Anti-patterns

* **Fixtures labelled LIVE** — the cardinal trust sin.
* **Equal-authority illustrative numbers** — `$42.8M` as bold as `18,520`.
* **Silent proxy substitution** — a composite score shown as "revenue."
* **Redundant metric=delta** — "4.3%" and "▲ 4.3% YoY" on the same tile.
* **Provenance wall on top** — trust context burying the decisions it supports.
* **Clipped axis** — tallest bar above the y-max.
* **Decorative map** — geography with no executive insight.
* **Theater controls** — a period switcher that looks wired but does nothing.
* **`$0` for unavailable** — fabricating a number instead of stating the gap.
* **Color-only provenance** — quality conveyed by hue alone.

## 15. Final response format

When you design or review trust/provenance, respond with:

```markdown
## Trust & Provenance Review

### Honesty thesis intact?
[Is measured visibly separated from illustrative/proxy/unavailable? where it breaks]

### Badge ↔ reality
[Does the LIVE/DEMO/FIXTURES/PROXY/PARTIAL badge match the actual data mode?]

### Visual authority
[Illustrative/proxy muted vs measured? any equal-authority offenders]

### KPI copy
[Redundant metric=delta? deltas name a basis? proxy/unavailable copy present?]

### Provenance placement
[Footer/expandable vs blocking wall; decisions below fold?]

### Chart + map correctness
[Axis includes max bar? map carries a derived insight sentence?]

### Period/scope control
[Visible? wired or honestly disabled? label matches data?]

### Reuse
[Built on existing DataQuality/DataQualityBadgeComponent, or forked?]

### Acceptance criteria status
[Checklist pass/fail]

### Recommended next step:
### Biggest risk:
### Architecture decision:
### Skill/concept to study next:
```
