---
name: ceo-dashboard-intervention-loop
description: Design, implement, or review the intervention/action layer of a franchisor CEO dashboard — the at-risk watchlist, severity-sorted territory queue, flag reasons, and territory scorecard drill-down (D15). Use when the dashboard surfaces risk ("Territories at Risk: 4") but gives the CEO/admin nowhere to act, when building the watchlist/action queue, when wiring hero tiles to drill into the queue, or when reviewing whether passive reporting has been turned into an intervention workflow.
---

# CEO Dashboard — Intervention Loop (D15)

## 1. When to use this skill

Use this skill when you are building or reviewing the **action layer** of the
franchisor CEO dashboard — the part that turns "there are 4 at-risk territories"
into "here are the 4, why each is flagged, and what to do next."

Reach for it when:

* The dashboard reports risk (`Territories at Risk: 4`) but the watchlist is a
  placeholder and the CEO has nowhere to act.
* You are implementing the **D15 watchlist / action queue**.
* You are wiring the at-risk hero tile to drill into the queue.
* You are designing the **territory scorecard** drill-down.
* A review needs to confirm the dashboard closes the action loop instead of
  stopping at passive reporting.

Stack reality (verify before editing): the dashboard is **Angular 20**,
standalone components, **signals** (`signal()`, `computed()`), `OnPush`. The
corporate landing screen is
`web/src/app/corporate/portfolio-page.component.ts` (`PortfolioPageComponent`,
with `hero`/`loading`/`error` signals and a `cards` computed). Data comes from
`web/src/app/corporate/corporate-api.service.ts` (`CorporateApiService`,
returns `Observable<…>`). KPI tiles are `components/kpi-card.component.ts`
(`KpiCardVm`) rendered by `components/kpi-grid.component.ts`. Reuse these — do
not introduce a second state pattern.

Related skills: pair with `franchise-ceo-dashboard-strategist` (what the CEO
should see), `dashboard-crossfilter-scope` (how risk-band selection re-scopes
every panel), and `dashboard-trust-provenance-polish` (honest scoring when
revenue is a proxy). This skill owns the **act-on-risk** loop specifically.

## 2. Dashboard / product principles

* **The CEO runs the network, not the jobs.** Every watchlist row exists to
  serve one of the four executive decisions: invest, **intervene**, grow,
  forecast/collect. The watchlist is the intervention instrument.
* **Risk without a next action is vanity.** A count tile that cannot be acted
  on is worse than no tile — it implies the system is handling it.
* **Every row answers one question:** *who needs action, and why?* Territory,
  brand, market, a reason, and a way to open the scorecard. A score alone is
  not a reason.
* **Severity is the sort key, not score.** A "Critical, declining fast" 49 is
  more urgent than a "Watch, stable" 41. Band first, then score within band.
* **Aggregate roll-up only.** The watchlist reads territory/brand-level
  roll-ups (see `corporate-rollup-readmodel-architect`). Never expose raw
  franchisee operational rows, individual appointments, or customer PII.
* **Honest scoring.** Until completed-job invoice revenue + territory royalty
  rate exist, the risk score is a labelled **proxy**, not revenue. Say so.

## 3. Required watchlist data model

The action queue needs a row type rich enough to render a reason and the metric
deltas that justify it, plus a filter type for scope.

```typescript
/** Severity band, ordered most-urgent first. Drives sort + color. */
export type RiskBand = 'critical' | 'at-risk' | 'watch';

/** A single, named reason a territory is flagged. Never show a score alone. */
export interface RiskReason {
  /** Stable key for tests/i18n, e.g. 'conversion-decline', 'nps-drop'. */
  code: string;
  /** One-line human-readable cause: "Conversion down 11pts QoQ". */
  label: string;
  /** Which leading indicator drove it (links the reason to the scorecard). */
  metric:
    | 'bookings'
    | 'conversion'
    | 'utilization'
    | 'nps'
    | 'growth'
    | 'ramp'
    | 'collection';
  /** Signed change for the driving metric, already formatted for display. */
  deltaLabel: string | null;
  /** Worse (most reasons) vs better; drives ▲/▼ + red/green. */
  direction: 'worse' | 'better';
}

/** One actionable row in the at-risk watchlist / action queue. */
export interface TerritoryRiskItem {
  territoryId: string;
  territoryName: string;   // "Tucson"
  brand: string;           // "Two Maids"
  market: string;          // "Tucson, AZ"
  /** Composite risk score 0–100 (lower = worse). Proxy until real revenue. */
  score: number;
  band: RiskBand;
  /** At least one. Ordered most-severe reason first. */
  reasons: RiskReason[];
  /** Tenure / ramp context — a 90-day territory ≠ a struggling 5-year one. */
  tenureStatus: 'ramping' | 'established' | 'mature';
  /** Provenance of the score so the UI can mark it proxy/partial. */
  scoreQuality: 'actual' | 'proxy' | 'partial' | 'estimated' | 'unavailable';
}

/** Current scope of the watchlist (driven by shared dashboard scope). */
export interface WatchlistFilter {
  brand: string | null;          // null = all brands
  band: RiskBand | null;         // null = all flagged bands
  market: string | null;
  /** Period the score/deltas are computed over. */
  period: 'MTD' | 'QTD' | 'YTD' | 'LTM';
}
```

`TerritoryRiskItem.scoreQuality` deliberately mirrors the existing
`DataQuality` union (`web/src/app/models.ts`) so the watchlist can render the
same `app-data-quality-badge` the KPI tiles use — do not invent a parallel
quality enum.

## 4. Required watchlist UI behavior

* **Severity-sorted queue.** Sort by `band` (critical → at-risk → watch), then
  by `score` ascending (worst first) within a band. The four critical
  territories (Tucson 49, Tampa Bay 47, Memphis 44, Las Vegas 41) appear in
  that order at the top.
* **Every row shows, left-to-right:** territory, brand, market, score, risk
  band (as a colored pill), primary reason, key metric delta(s), and an
  **Open scorecard** action.
* **Reason is mandatory.** If a row has no `reasons[0]`, it is a data bug —
  render a visible "reason unavailable" state, never a blank cell that implies
  "no problem."
* **Filter state is visible.** When scoped to a brand or band, show an active
  filter chip ("Two Maids · Critical") with a clear control. The queue and its
  header count must agree with the chip.
* **Counts reconcile.** The watchlist header count must equal the at-risk hero
  tile value for the same scope. If they diverge, that is a P1 trust bug.
* **Keyboard + pointer parity.** A row is a real button/link; Enter/Space opens
  the scorecard, same as click.

Angular shape: hold the queue in a `computed()` derived from the API signal +
the shared scope signal; never duplicate filter state inside the component.

## 5. Hero-tile drill behavior

The **At-risk territories** tile is the most action-oriented KPI on the screen.
Clicking it must close the loop, not just sit there:

* Clicking the tile sets the shared scope's risk band to the flagged set
  (critical + at-risk) and **scrolls to / filters to / opens** the watchlist
  (`scrollIntoView({ behavior: 'smooth', block: 'start' })` plus focus on the
  queue heading for screen-reader users).
* The tile is rendered as an interactive control (`role="button"`, focusable,
  Enter/Space) with a visible affordance (cursor, hover, "View watchlist →").
* After the drill, the watchlist header reflects the band filter and the active
  filter chip appears. Re-clicking or clearing returns to the full flagged set.
* Other at-risk surfaces (a map at-risk overlay, a distribution bottom-band)
  drill to the **same** watchlist via the same scope action — one queue, many
  entrances.

Wire this through `dashboard-crossfilter-scope`'s scope action, not a local
`@Output` that only the page knows about.

## 6. Territory scorecard expectations

Opening a row opens a **territory scorecard** — the CEO's intervention brief for
one territory. It must show leading indicators, not raw operations:

* **Header:** territory, brand, market, current score + band, tenure/ramp status.
* **Why flagged:** the full `reasons[]` list, each with its metric and delta —
  this is the spine of the scorecard.
* **Leading indicators** (each with value, period delta, and a provenance
  badge): bookings, lead→booked→completed conversion, crew/slot utilization,
  NPS, same-territory growth, tenure/ramp status. These are the levers an
  intervention pulls.
* **Honest gaps:** any indicator without a real source shows `unavailable` /
  `proxy`, not a fabricated number.
* **No raw rows:** never list individual appointments, customers, or PII. The
  scorecard is a roll-up brief, not an operational table.

```typescript
export interface TerritoryScorecardSummary {
  territoryId: string;
  territoryName: string;
  brand: string;
  market: string;
  score: number;
  band: RiskBand;
  tenureStatus: 'ramping' | 'established' | 'mature';
  reasonsFlagged: RiskReason[];
  indicators: Array<{
    key: 'bookings' | 'conversion' | 'utilization' | 'nps' | 'growth' | 'ramp';
    label: string;
    value: string;            // pre-formatted ("62%", "31", "−4 NPS")
    deltaLabel: string | null;
    direction: 'worse' | 'better' | 'flat';
    quality: 'actual' | 'proxy' | 'partial' | 'estimated' | 'unavailable';
  }>;
  /** Optional suggested next action, e.g. "Field-support visit". */
  recommendedAction: string | null;
}
```

## 7. Severity / risk-band logic

* **Bands are ordered:** `critical` (0) > `at-risk` (1) > `watch` (2). Encode the
  order once (a `BAND_ORDER` map) and reuse it for sorting and color — do not
  re-hardcode the ordering in each component.
* **Thresholds are config, not magic numbers.** Define score→band thresholds in
  one place; a reviewer must be able to point at the single source of truth.
* **Band drives color + label,** not the raw score. Critical = red, at-risk =
  amber, watch = slate. Keep color independent of a hardcoded numeric check
  scattered across templates.
* **Direction matters.** A 44 that is *recovering* is a different story from a
  44 that is *falling*. Where trend is known, reflect it in the reason, and
  consider it before sort-ties.
* **Proxy honesty:** if the score is a composite proxy, the band is a proxy band
  — badge it. Never let a proxy score read as a hard revenue verdict.

## 8. Empty / loading / error states

* **Loading:** skeleton rows (not a spinner that hides layout shift); the
  `loading` signal already exists on the page — reuse it.
* **Empty (no matches in scope):** explain the scope, e.g. *"No territories at
  risk for Two Maids this quarter."* — this is good news, state it as such, and
  offer "Clear filter" if a brand/band scope is active. Never render a bare
  empty table.
* **Empty (genuinely zero flagged, all scopes):** *"No territories currently
  flagged. Network is within risk thresholds."*
* **Error:** reuse the page `error` signal; show a retry, and never silently
  fall back to stale or fabricated rows.
* **Partial data:** if the queue loaded but some scores are `unavailable`, show
  the rows with honest per-row badges rather than dropping them.

## 9. Accessibility requirements

* Watchlist is a semantic list/table; each row's primary action is a real
  `button`/`a` with an accessible name ("Open scorecard for Tucson, Two Maids").
* Risk band is conveyed by **text + shape**, never color alone (pill carries the
  word "Critical"); meets WCAG 1.4.1 (use of color) and AA contrast.
* Hero tile drill target receives focus after the scroll, and the queue heading
  is reachable so screen-reader users land on the action context.
* Reasons and deltas are real text, not background images or color-only ▲/▼ —
  pair each arrow with a sign/label.
* Keyboard order is logical: tile → watchlist heading → rows → row action →
  scorecard.

## 10. Acceptance criteria (D15)

D15 is complete when:

* [ ] The **At-risk territories** hero tile drills into the watchlist (scroll +
      filter + focus).
* [ ] The watchlist shows the four critical territories (Tucson 49, Tampa Bay
      47, Memphis 44, Las Vegas 41).
* [ ] Rows are **severity-sorted** (band first, then worst score within band).
* [ ] Each row shows territory, brand, market, score, risk band, **reason**, key
      metric delta(s), and an **Open scorecard** action.
* [ ] Filter state is reflected visually (active chip; header count matches the
      hero tile for the same scope).
* [ ] The empty state explains when no territories match the selected scope and
      offers a way to clear it.
* [ ] Opening a row shows a territory scorecard with leading indicators
      (bookings, conversion, utilization, NPS, growth, tenure/ramp) and the
      reason(s) flagged.
* [ ] No raw franchisee/customer rows or PII appear anywhere in the loop.

## 11. Code review checklist

* [ ] Queue reads from the shared scope signal — no duplicated/hidden filter
      state inside the component.
* [ ] Sort uses a single `BAND_ORDER` source; thresholds live in one config.
* [ ] Every rendered row has a non-empty reason or an explicit "reason
      unavailable" state.
* [ ] Hero-tile drill uses the shared scope action, not a one-off `@Output`.
* [ ] Watchlist count == at-risk hero value for the same scope (assert in a
      test).
* [ ] Scores marked proxy/partial/unavailable carry the `app-data-quality-badge`
      consistent with their `scoreQuality`.
* [ ] No raw operational tables / PII reached this layer (data is roll-up).
* [ ] Loading/empty/error states all present and distinct; empty explains scope.
* [ ] Row action is keyboard-operable and has an accessible name; band conveyed
      by text not color alone.
* [ ] New view-model interfaces reuse `DataQuality` and existing `KpiCardVm`
      patterns instead of re-declaring parallel types.

## 12. Anti-patterns to avoid

* **Dead-end risk tile** — a count that is not clickable / leads nowhere.
* **Score-only rows** — a number with no reason; the CEO can't act on "49".
* **Sort by score, ignoring band** — buries a falling critical under a stable
  one.
* **Hidden/duplicated filter state** — the panel disagrees with the chip or the
  hero count.
* **Raw-row leakage** — listing appointments/customers/PII to "show detail."
* **Fabricated fills** — substituting estimates for unavailable indicators so
  the scorecard "looks complete."
* **Magic-number bands** — `score < 50` checks sprinkled across templates.
* **Vanity scorecard** — activity counts with no connection to invest/intervene/
  grow/collect.
* **Color-only severity** — band shown only as a red dot.

## 13. Final response format

When you design or review the intervention loop, respond with:

```markdown
## Intervention Loop Review (D15)

### Executive decision this serves
[Primarily: intervene — who needs action before churn/failure]

### Does it close the loop?
[Risk surfaced → reachable → reasoned → actionable? yes/no + where it breaks]

### Watchlist
[Sort correctness, reason coverage, count reconciliation with hero tile]

### Hero-tile drill
[Tile → scroll/filter/focus wired through shared scope? gaps]

### Territory scorecard
[Leading indicators present + honest? reasons surfaced? raw-row leakage?]

### Severity/band logic
[Single source of truth for order + thresholds? proxy honesty?]

### States
[Loading / empty-in-scope / empty-global / error / partial — present + distinct]

### Accessibility
[Keyboard, focus on drill, color-independent severity, accessible names]

### Acceptance criteria status
[Checklist pass/fail]

### Recommended next step:
### Biggest risk:
### Architecture decision:
### Skill/concept to study next:
```
