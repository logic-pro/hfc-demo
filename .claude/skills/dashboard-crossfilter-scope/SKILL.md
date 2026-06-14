---
name: dashboard-crossfilter-scope
description: Design, implement, or review shared dashboard scope/selection state so a BI dashboard behaves like one cockpit instead of assembled widgets. Use when brand/territory/period/risk-band selection should cross-filter every panel (hero, map, distribution, watchlist, table, scorecard), when lifting per-widget state into one shared scope signal, or when a click on a brand row only filters one panel and the rest go stale. Framework-aware: Angular signals/services, React state/context, or reducer patterns.
---

# Dashboard Cross-Filter Scope

## 1. When to use this skill

Use this skill when the dashboard "feels like assembled widgets instead of a
single decision instrument" — clicking a brand row filters only the
distribution while the map, hero, table, and brand breakdown stay on a
different, stale view.

Reach for it when:

* Brand, territory, period, and risk-band selection live independently inside
  each panel and disagree with each other.
* You are lifting selection into **one shared dashboard scope** that every panel
  reads.
* You are wiring cross-filtering, hero re-scoping, map highlighting, table
  filtering, or drill-down consistency.
* A review needs to confirm there is no hidden, conflicting copy of brand/
  territory/period selection.

Stack reality (verify before editing): this dashboard is **Angular 20**,
standalone, **signals** (`signal()`, `computed()`), `OnPush`. The corporate
landing page is `web/src/app/corporate/portfolio-page.component.ts`
(`PortfolioPageComponent`, holds `hero`/`loading`/`error` signals + a `cards`
computed); data via `web/src/app/corporate/corporate-api.service.ts`
(`CorporateApiService`). Prefer the existing **signals + a small injectable
service** pattern over a global state library. This skill is framework-aware,
but in *this* repo the answer is **an Angular signal-based scope service**.

Related skills: `ceo-dashboard-intervention-loop` (the watchlist that risk-band
scope opens), `dashboard-trust-provenance-polish` (how scope-driven period
controls must not pretend to be wired), `franchise-ceo-dashboard-strategist`
(what each scoped view should answer).

## 2. Core architecture principle

**One scope object defines the current dashboard view. Every panel reads from
it; no panel keeps a private, conflicting copy.**

* Selection is *lifted* into a single shared scope (a signal/service), not owned
  by whichever panel was clicked.
* Panels are **projections** of scope: hero re-scopes, map highlights,
  distribution filters, watchlist filters, table filters, scorecard opens — all
  derived (`computed`) from the same source.
* Scope changes flow through **named actions/events**, not ad-hoc setters
  scattered across panels, so the transitions are testable and consistent.
* Keep it simple: do **not** reach for NgRx/Redux/Zustand unless the scope graph
  genuinely outgrows signals/context. For this dashboard, it does not.

## 3. Shared scope model

```typescript
export type DashboardPeriod = 'MTD' | 'QTD' | 'YTD' | 'LTM';

/** null = "all" / portfolio view for that axis. */
export interface BrandSelection {
  brand: string | null;          // "Two Maids" | null = all brands
}
export interface TerritorySelection {
  territoryId: string | null;    // selected territory → opens/highlights scorecard
}
export interface RiskBandSelection {
  band: 'critical' | 'at-risk' | 'watch' | null; // null = no band filter
}

/** The single source of truth for the whole dashboard view. */
export interface DashboardScope {
  brand: BrandSelection['brand'];
  territory: TerritorySelection['territoryId'];
  band: RiskBandSelection['band'];
  period: DashboardPeriod;
}

/** Portfolio default: everything unscoped, current quarter. */
export const PORTFOLIO_SCOPE: DashboardScope = {
  brand: null,
  territory: null,
  band: null,
  period: 'QTD',
};
```

## 4. Scope actions / events

Mutate scope only through a small, named action set — never by poking
individual fields from random panels.

```typescript
export type DashboardScopeAction =
  | { type: 'selectBrand'; brand: string | null }
  | { type: 'selectTerritory'; territoryId: string | null }
  | { type: 'selectRiskBand'; band: 'critical' | 'at-risk' | 'watch' | null }
  | { type: 'setPeriod'; period: DashboardPeriod }
  | { type: 'clearFilters' };          // → PORTFOLIO_SCOPE
```

Angular shape (recommended for this repo) — an injectable signal store:

```typescript
@Injectable({ providedIn: 'root' })
export class DashboardScopeService {
  private readonly _scope = signal<DashboardScope>(PORTFOLIO_SCOPE);
  readonly scope = this._scope.asReadonly();

  // Panels read derived projections, never raw private state.
  readonly brand = computed(() => this._scope().brand);
  readonly band = computed(() => this._scope().band);
  readonly period = computed(() => this._scope().period);
  readonly isScoped = computed(() => {
    const s = this._scope();
    return s.brand !== null || s.band !== null || s.territory !== null;
  });

  dispatch(action: DashboardScopeAction): void {
    this._scope.update((s) => reduceScope(s, action));
  }
}
```

`reduceScope` is a pure function — easy to unit-test every transition. For a
React port the same shape is `useReducer(reduceScope, PORTFOLIO_SCOPE)` exposed
via context; for a non-Angular/React surface, a plain reducer + observer. The
**reducer is the framework-portable core**; the signal/context is the binding.

## 5. Panel responsibilities

Each panel **reads** scope and **dispatches** actions. None stores its own copy
of brand/territory/period/band.

| Panel | Reads from scope | Dispatches |
|---|---|---|
| Hero KPI tiles | brand, band, period → re-scoped values | `selectRiskBand` (at-risk tile) |
| Brand breakdown rows | brand (highlights active row) | `selectBrand` |
| Territory distribution / histogram | brand, band, period | `selectRiskBand` (band click) |
| Territory map | brand, band (overlays), territory (highlight) | `selectBrand`, `selectTerritory` |
| Watchlist / action queue | brand, band, period | `selectTerritory` (open scorecard) |
| Provenance / trust panel | period, data mode | — (reflects, doesn't drive) |
| Territory scorecard | territory (which one to open) | `selectTerritory(null)` to close |

## 6. Cross-filtering behavior

* **Brand selection cross-filters everything:** `selectBrand('Two Maids')`
  re-scopes hero, highlights Two Maids on the map, filters the distribution,
  filters the watchlist, and marks the brand row active.
* **Risk-band selection** filters distribution + watchlist and updates hero
  context where appropriate (e.g. the at-risk tile reflects the filtered set);
  it does **not** silently change the period.
* **Period selection** re-scopes value-bearing panels (hero, distribution,
  watchlist) to MTD/QTD/YTD/LTM; it does not clear brand/territory/band.
* **Territory selection** opens/highlights the scorecard and highlights that
  territory across map + watchlist; it does not collapse the brand filter.
* **Orthogonality:** the four axes (brand / territory / band / period) compose.
  Selecting a band must not wipe the brand; selecting a territory must not reset
  the period. Test the cross-products.

## 7. Drill behavior

* Drill = a scope action, not a route swap that loses the rest of scope.
* **At-risk hero tile** → `selectRiskBand('critical')` (+ at-risk) and scrolls/
  opens the watchlist (handing off to `ceo-dashboard-intervention-loop`).
* **Map territory** → `selectTerritory(id)` opens the scorecard and highlights
  the territory in every relevant panel.
* **Brand row** → `selectBrand(brand)` re-scopes the whole cockpit.
* Drilling deeper **narrows** scope; it never resets unrelated axes. "Back" =
  dispatch the inverse action (e.g. `selectTerritory(null)`), not a full reset.

## 8. URL / query-param behavior (if appropriate)

* Make scope **shareable + reload-safe** by serializing it to query params:
  `?brand=two-maids&band=critical&period=QTD&territory=tucson`.
* Scope service is the source of truth; sync **scope → URL** on change and
  **URL → scope** once on load. Do not let the URL and the signal drift into two
  truths — the signal wins at runtime, the URL is a serialization.
* Omit null axes from the URL (clean portfolio URL has no scope params).
* In Angular, sync via the `Router`/`ActivatedRoute` in the scope service or a
  thin effect — never have each panel read query params independently.
* Keep it optional: if deep-linking isn't required for the demo, skip it rather
  than half-wiring it (and don't show a shareable URL that doesn't restore).

## 9. Accessibility and visible selection states

* **The selected scope must be visible.** Show active filter chips ("Two Maids ·
  Critical · QTD") with individual clear controls and a "Clear all".
* Active brand row / map territory / band segment render a clear selected state
  (text or shape, not color alone — WCAG 1.4.1).
* Selectable rows/segments/tiles are real controls (`button`/`a`,
  `aria-pressed`/`aria-current` where they act as toggles/selection).
* Changing scope should move focus sensibly (e.g. opening the scorecard focuses
  its heading) and announce the change for screen readers (an `aria-live`
  summary of the active scope is ideal).
* Keyboard parity: every scope action reachable by click is reachable by
  keyboard.

## 10. State reset behavior

* `clearFilters` returns scope to `PORTFOLIO_SCOPE` (brand/territory/band null,
  period back to the default `QTD`) — the portfolio cockpit view.
* A visible "Clear filters" control appears whenever `isScoped()` is true.
* Clearing a single axis (chip ✕) dispatches the targeted null action and leaves
  the others intact.
* Reset must be total and observable — no panel may keep a stale private
  selection after a clear (this is the #1 cross-filter bug; assert it in a test).

## 11. Testing strategy

* **Reducer unit tests** (framework-free): every `DashboardScopeAction` from
  representative starting scopes, including orthogonality (band doesn't clear
  brand; period doesn't clear territory) and `clearFilters` → `PORTFOLIO_SCOPE`.
* **Projection tests:** given a scope, each panel's derived `computed` yields the
  expected filtered set (e.g. brand=Two Maids → distribution shows only Two
  Maids territories).
* **No-hidden-state test:** after `clearFilters`, no panel reports a stale
  selection; hero/watchlist counts reconcile with each other.
* **Cross-filter integration:** click brand row → assert hero, map, distribution,
  watchlist all re-scope together.
* **URL round-trip** (if implemented): scope → params → scope is identity.

## 12. Code review checklist

* [ ] Exactly one scope source of truth (signal/service); no panel stores its
      own brand/territory/period/band.
* [ ] All mutations go through named `DashboardScopeAction`s + a pure reducer.
* [ ] Panels read via `computed`/derived projections, not by copying scope into
      local fields.
* [ ] Brand selection re-scopes hero, map, distribution, watchlist, table.
* [ ] Axes are orthogonal — selecting one doesn't silently reset another
      (covered by tests).
* [ ] Selected scope is visible (chips) and `clearFilters` fully resets.
* [ ] Selection states are color-independent and keyboard-operable.
* [ ] No global state library added unless justified; reducer is portable.
* [ ] URL sync (if present) is one-way-truth (signal wins) and reload-safe.
* [ ] Drill narrows scope without resetting unrelated axes.

## 13. Anti-patterns

* **Widget islands** — each panel owns its own selection; clicking one updates
  one.
* **Hidden conflicting copies** — the map's brand ≠ the table's brand.
* **Setter sprawl** — panels poke scope fields directly instead of dispatching
  actions, so transitions are untestable.
* **Drill-as-reset** — opening a scorecard wipes the brand/period.
* **Axis bleed** — selecting a risk band silently changes the period.
* **Invisible scope** — the data is filtered but the user can't see to what.
* **Premature global store** — NgRx/Redux for a four-field scope.
* **Half-wired deep links** — a shareable URL that doesn't restore the view.

## 14. Final response format

When you design or review cross-filter scope, respond with:

```markdown
## Cross-Filter Scope Review

### Single source of truth?
[One scope object/service, or scattered per-widget state? where it leaks]

### Scope model + actions
[Fields, action set, reducer purity]

### Panel projections
[Each panel reads scope + dispatches correct actions — table of who reads what]

### Cross-filter correctness
[Brand re-scopes all? band filters + hero context? period? territory→scorecard?]

### Orthogonality
[Do axes compose without resetting each other? failing pairs]

### Visibility + reset
[Active scope visible (chips)? clearFilters fully resets? per-axis clear?]

### Accessibility
[Selection states color-independent, keyboard-operable, focus/announce]

### URL/deep-link
[If present: one-way truth, reload-safe; if absent: correctly omitted not half-wired]

### Recommended next step:
### Biggest risk:
### Architecture decision:
### Skill/concept to study next:
```
