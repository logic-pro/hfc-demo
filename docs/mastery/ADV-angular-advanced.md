# ADV — Advanced Angular 20 (mastery)

> Goes **deeper** than [[M6-angular-spa]]. M6 covers the basics: standalone components,
> signals, the functional interceptor, route guards, the forkJoin/switchMap load,
> typed VMs, the login surface. This doc assumes all of that and drills into the
> mechanics a senior is expected to *defend under follow-ups*: RxJS flattening-operator
> selection, change detection internals (Zone.js → zoneless/signals), performance &
> bundle budgets, reactive forms + cross-field validation, testing (TestBed / harness /
> marble), and accessibility.
>
> **Label key:** `DEMO-PROVEN` = the code exists in `web/src/app` and is quoted at
> file:line. `BEST-PRACTICE` = correct senior answer, not yet in this repo (say so in
> the interview — honesty is a signal).
>
> Environment (verified): Angular `^20.3.0`, rxjs `~7.8.0`, zone.js `~0.15.0`
> (`web/package.json:27,31,33`). So this app is **Zone-based** change detection today,
> with signals layered on top — the "zoneless direction" below is where it's heading,
> not where it is.

---

## 1. Mental model (the one paragraph)

Angular has **two reactive systems running at once** in this codebase. RxJS owns
*async pipelines* (HTTP, debounce, cancel-stale, parallel fan-out) — anything with a
time dimension. Signals own *synchronous derived state* (filters → VM → template).
The bridge is `toObservable` / `toSignal`. The franchisee page is the canonical proof:
filter signals → `toObservable` → debounce/switchMap/forkJoin/catchError → `toSignal`
back into a `state` signal → `computed` VMs into an `OnPush` template
(`franchisee/dashboard-page.component.ts:181-225`). Get the seam right and you get
cancel-stale correctness, push-based rendering, and zero manual `subscribe`/`unsubscribe`
in the component. Get it wrong (wrong flattening operator, leaked subscription, CD
churn) and you get stale data, duplicate writes, and jank.

---

## 2. RxJS flattening operators in depth

All four take an outer stream and an inner Observable factory; they differ **only in
what they do when a new outer value arrives while an inner is still in flight.**

| Operator | On new outer value while inner active | Concurrency | Use when | Failure if misused |
|---|---|---|---|---|
| `switchMap` | **cancels** the in-flight inner, subscribes to the new one | 1 (latest wins) | Only the latest result matters: search, filters, navigation | Use for writes → cancels a save mid-flight; lost mutation |
| `mergeMap` (`flatMap`) | runs **both** concurrently | unbounded (or `concurrent` cap) | Independent parallel side-effects where order doesn't matter | Use for filters → stale response can land *after* fresh one (race); duplicate writes |
| `concatMap` | **queues** the new one, runs after current finishes | 1, FIFO | Order matters, no drops: sequential writes, ordered uploads | Use for typeahead → backlog grows, UI lags behind keystrokes |
| `exhaustMap` | **ignores** the new outer value until current finishes | 1, drop-new | Idempotent-ish "ignore double-fire": login button, submit, refresh | Use for filters → user's later selection is dropped |

### Mental decision tree
- "Do I only care about the **latest**?" → `switchMap`.
- "Must every one run, **in order**, none dropped?" → `concatMap`.
- "Run them **all at once**, order irrelevant?" → `mergeMap`.
- "**Ignore** re-fires while one is running?" → `exhaustMap`.

### DEMO-PROVEN: switchMap as cancel-stale

The franchisee load uses `switchMap` precisely because a fast operator changing
period → territory → period must not paint a stale territory's numbers:

```ts
// franchisee/dashboard-page.component.ts:181-201
private readonly load$ = toObservable(
  computed(() => ({ f: this.filters(), tick: this.reloadTick() })),
).pipe(
  debounceTime(150),
  distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  switchMap(({ f }) =>
    forkJoin({
      response: this.api.getDashboard(f),
      territories: this.api.getTerritories(),
    }).pipe(
      map(...),                 // DTO → VM (success state)
      startWith(initialState()),// emit loading immediately
      catchError(() => of(errorState)),
    ),
  ),
);
```

Why each piece earns its place:
- `debounceTime(150)` — coalesces a burst of filter clicks into one request.
- `distinctUntilChanged` (JSON compare) — a re-emit with *identical* filters is a no-op;
  prevents a wasted round-trip when the signal recomputes but the value is unchanged.
- `switchMap` — if a second filter arrives during the 350ms fetch, the first HTTP is
  **unsubscribed** (the browser actually cancels the XHR), so its response can never
  win the race.
- `forkJoin` — fires dashboard + territories **in parallel**, emits once when *both*
  complete (it's the RxJS analogue of `Promise.all`; it only emits on completion, which
  HTTP observables do — that's why it's safe here).
- `startWith` / `catchError` **inside** the switchMap — scoping them to the inner stream
  means the *outer* stream never errors and never completes, so the pipeline keeps
  reacting to future filter changes. `catchError` at the outer level would kill the
  whole stream on the first failure (classic bug).

### `concatMap` vs `switchMap` — the write case (BEST-PRACTICE, contrast)

`payDeposit` uses a plain imperative `.subscribe` (`dashboard-page.component.ts:287`),
which is fine for a one-shot. But if deposits were driven off a *stream* of click
events you would **not** use `switchMap` — a second click must not cancel an in-flight
charge. You'd use `exhaustMap` (ignore double-clicks while charging) or `concatMap`
(queue them), backed by the `Idempotency-Key` (`dashboard-page.component.ts:286`) so a
server-side retry is a no-op. This is the textbook "switchMap-for-reads, concat/exhaust-
for-writes" rule, and the Idempotency-Key is the safety net for the race RxJS can't fix.

### Error handling + retry (BEST-PRACTICE)

`catchError` recovers by **substituting a fallback Observable** — here `of(errorState)`,
which converts an exception into a *value* the UI renders (error → state, not a thrown
exception). For transient failures you add retry with backoff:

```ts
// retry only idempotent GETs; never blind-retry a POST
this.api.getDashboard(f).pipe(
  retry({ count: 3, delay: (err, n) => timer(2 ** n * 200) }), // exp backoff
  catchError(() => of(errorState)),
)
```
Defense points: `retry` *re-subscribes* (re-runs the whole inner), so it must wrap only
the HTTP call, not the mapping; and you gate it on status (don't retry a 4xx). The demo
chooses **manual** retry instead — a `reloadTick` signal the user bumps via the error
panel's retry button (`dashboard-page.component.ts:178,268-270,74`) — which is the right
call for a dashboard where the user wants control, not a silent loop.

### Multicasting / shareReplay (BEST-PRACTICE)

Cold HTTP observables **re-execute per subscriber**. If two parts of the template
subscribed to the same `getTerritories()` you'd fire two requests. Fixes:
- `shareReplay({ bufferSize: 1, refCount: true })` — multicast + replay the last value
  to late subscribers; `refCount:true` tears down the source when the last subscriber
  leaves (avoids a leak that keeps the HTTP cache alive forever).
- In *this* app the problem is sidestepped structurally: the page subscribes **once**
  (`toSignal` at `:203`) and every consumer reads the resulting `state` **signal**, which
  is itself a multicast cache. So signals are doing the `shareReplay` job for derived
  state. Say that — it shows you know *why* you don't need shareReplay here.

---

## 3. Change detection — Zone.js, OnPush, and the signals direction

### How CD works today (Zone-based)
`zone.js` monkey-patches every async API (`setTimeout`, `addEventListener`, XHR,
Promise). When any patched callback finishes, Zone tells Angular "something might have
changed" and Angular runs CD **top-down over the whole component tree**, re-evaluating
every template binding to see if it changed. This is correct-by-default but does *work
proportional to the whole tree on every async tick* — including ticks that changed
nothing relevant.

This app opts into **event coalescing** to blunt that:
```ts
// app.config.ts:10
provideZoneChangeDetection({ eventCoalescing: true })
```
Coalescing batches multiple events firing in the same tick into a single CD pass (e.g.
a click that triggers focus + input together → one CD run, not three).

### OnPush — the per-component opt-out
Every component in the dashboard declares `OnPush`
(`dashboard-page.component.ts:40`, `kpi-card.component.ts:12`,
`filter-bar.component.ts:9`, `brand-table.ts:24`). OnPush tells Angular: **skip this
component's CD unless** (a) an `@Input()`/`input()` reference changes, (b) an event fires
*from this component's template*, (c) an `async` pipe / signal read in the template emits,
or (d) `markForCheck()` is called explicitly. It turns "check everything every tick" into
"check only the subtrees that actually got new data."

**Why OnPush + immutable inputs + pre-formatted VMs go together:** OnPush compares inputs
by **reference**. The page maps DTO→VM once (`kpiVms` computed, `:208-210`) and passes
**new array/object references** only when the data genuinely changes, so OnPush's
reference check fires correctly. The KPI card does *zero* logic on raw data — value/delta
are pre-formatted (`kpi-card.component.ts` doc comment, `:6-7`); the only computeds derive
from the already-stable VM input. That's the OnPush contract honored end-to-end.

### Why signals reduce CD churn (the direction)
Signals are **fine-grained** reactivity: a `computed` tracks exactly which signals it
read, and only recomputes when *those* change; a signal read in a template registers a
precise dependency, so a signal write can mark *just the views that read it* dirty —
not the whole tree. With OnPush + signals, an unrelated `setTimeout` elsewhere no longer
forces this component to re-check. **Zoneless** Angular (`provideZonelessChangeDetection()`,
stable in v20) removes zone.js entirely: CD is driven *only* by signals, the `async` pipe,
`markForCheck`, and template events. The payoff: no monkey-patching, smaller bundle (drop
zone.js), and CD work proportional to *what changed* instead of *what ticked*.

**Where this app sits:** zone.js is still a dependency (`package.json:33`), so it's
Zone-based + OnPush + signals — the pragmatic middle. The migration path is small and
worth being able to narrate: switch `provideZoneChangeDetection` → `provideZonelessChange
Detection`, drop the `zone.js` polyfill, then fix any code that *relied* on zone auto-
detecting a mutation (i.e. anything that mutates without going through a signal/event).
Because state already flows through signals here, that migration is low-risk — a strong
thing to say.

### HFC tie-in
A BI dashboard is binding-heavy: KPI tiles, sparklines, a sortable brand table, a US map,
histograms, a watchlist, a scorecard drawer. Under default CD every Stripe webhook poll
or hover would re-check all of it. OnPush + signal-derived VMs keep CD work proportional
to the *one* panel a filter actually changed (cross-filter selecting a brand re-renders
the distribution, not the whole cockpit).

---

## 4. Performance — OnPush, trackBy, lazy routes, bundle budgets

### trackBy / `track` — DEMO-PROVEN
Control-flow `@for` **requires** a track expression; the demo tracks by stable identity
everywhere: `track t.id` (filter dropdown, `filter-bar.component.ts:36`),
`track r.brandId` (brand table, `brand-table.ts:64`), `track p.value`
(period buttons, `:15`). Without a stable key Angular destroys and recreates **every**
DOM node on each list change (losing focus, animation, and scroll state) instead of
moving the changed rows. Tracking by `$index` is the classic anti-pattern — reordering
re-renders everything and can bind the wrong row's handlers.

### Lazy-loaded routes — DEMO-PROVEN
Each data-heavy surface is its own lazily-loaded chunk:
```ts
// app.routes.ts:23,29-30 — loadComponent, not eager component
loadComponent: () => import('./dashboard/dashboard').then((m) => m.DashboardComponent),     // corporate
loadComponent: () => import('./franchisee/dashboard-page.component')...                       // franchisee
```
The route comment states the intent explicitly: *"The data-heavy surfaces are lazy
standalone components — each its own chunk so the dashboard viz never weighs down the
booking SPA"* (`app.routes.ts:10-11`). Standalone components make this trivial — no
NgModule to lazy-load, just `import()` of the component. Result: a franchisee who only
books never downloads the corporate command-center bundle (map, histograms, brand table).
The `login` surface is lazy too (`:17`), so the first paint is tiny.

### Bundle budgets — DEMO-PROVEN
```jsonc
// web/angular.json:61-72 (production)
{ "type": "initial",            "maximumWarning": "500kB", "maximumError": "1MB" },
{ "type": "anyComponentStyle",  "maximumWarning": "8kB",   "maximumError": "16kB" }
```
The build **fails CI** if the initial bundle exceeds 1 MB, or warns past 500 kB — a
hard guardrail against a careless `import` of a heavy charting lib silently bloating
first load. The component-style budget (16 kB error) discourages giant per-component
CSS. This is why the dashboards draw their own SVG (sparkline polyline in
`kpi-card.component.ts:80-92`, zero-dependency by design) instead of pulling in a
charting framework — staying under budget is an architectural constraint, not an
afterthought.

### Other levers (BEST-PRACTICE, name them)
- **`@defer`** blocks — defer below-the-fold panels (map, scorecard) until viewport/idle;
  natural next step for these dashboards.
- **`NgOptimizedImage`** for any raster assets.
- **Pure pipes over method calls in templates** — a method in a binding re-runs every
  CD; the demo sidesteps this entirely by pre-computing in `computed()` (e.g.
  `accentClass`, `sparkPoints` in `kpi-card.component.ts:60,80`).

---

## 5. Reactive forms + cross-field validation (BEST-PRACTICE)

The demo's filters are signal-driven, not a `FormGroup`, so this is honestly
*best-practice not demo-proven* — say so. The senior-level content is **cross-field**
validation, where one control's validity depends on another (the booking/deposit flows
are the natural home for this).

```ts
// a typed reactive form with a group-level (cross-field) validator
const form = this.fb.group({
  depositCents: this.fb.control(0, { validators: [Validators.required, Validators.min(1)] }),
  totalCents:   this.fb.control(0, { validators: [Validators.required] }),
}, { validators: [depositNotExceedTotal] });   // <-- runs on the GROUP

function depositNotExceedTotal(g: AbstractControl): ValidationErrors | null {
  const dep = g.get('depositCents')!.value;
  const tot = g.get('totalCents')!.value;
  return dep > tot ? { depositExceedsTotal: true } : null;   // error lives on the group
}
```
Defense points:
- A **field** validator can't see siblings; cross-field rules belong on the **parent
  group** (or `FormArray`), and the error is read off the group, not a single control.
- **Typed forms** (Angular 14+, `NonNullableFormBuilder`) give `value`/`patchValue` real
  types — no more `any` leaking from form values into your API call.
- For server-dependent rules (e.g. "appointment slot still open") use an **async
  validator** returning `Observable<ValidationErrors|null>`, debounced, with the pending
  state driving a disabled submit button.
- Reactive (not template-driven) because it's testable, composable, and the validation
  logic is plain functions you can unit-test without the DOM.

When asked "signals or reactive forms?": signals for *derived UI state* (filters, view
toggles); reactive forms for *user input with validation lifecycle* (touched/dirty/
pending/errors). They coexist — bind a form's `valueChanges` into a signal via `toSignal`
if you need both.

---

## 6. Testing (BEST-PRACTICE — and be honest about the gap)

**Demo reality:** Karma + Jasmine are wired (`package.json:41-49`) but the schematics set
`"skipTests": true` (`angular.json:13-34`) and there are **no `*.spec.ts` files in
`src/app`**. So testing is the most important *honesty* topic in this doc — claim the
approach, not coverage. (See [[M9-cicd-prod]] for where these would run.)

### TestBed + component testing
```ts
TestBed.configureTestingModule({
  imports: [DashboardPageComponent],                       // standalone: import directly
  providers: [{ provide: DashboardApiService, useValue: fakeApi }], // swap the seam
});
const fixture = TestBed.createComponent(DashboardPageComponent);
fixture.detectChanges();                                   // run CD (OnPush-aware)
expect(fixture.componentInstance.kpiVms().length).toBe(4);
```
- Standalone components are **imported**, not declared — no NgModule boilerplate.
- The fixture/live seam (`USE_MOCK` / `__DASHBOARD_LIVE__`,
  `dashboard-api.service.ts:23`, `dashboard-data.service.ts:26`) is *built for testing*:
  provide a fake `DashboardApiService` and you exercise the real RxJS pipeline against
  deterministic data.
- With OnPush you must call `fixture.detectChanges()` after changing inputs — the test
  must trigger CD the same way the runtime would.

### Component Harnesses (`@angular/cdk/testing`)
Harnesses test **behavior through a stable API** instead of brittle CSS selectors —
`harness.click()` / `getText()` survive markup refactors. For HFC's accessible, keyboard-
driven tables and filter bars, harnesses (or Testing Library queries by role/label) are
the right tool: assert on `aria-pressed`, role, and visible text, not `.bt-row:nth-child`.

### Marble testing (RxJS)
The `load$` pipeline (debounce + switchMap cancel-stale) is exactly what marble tests
exist for — they make **virtual time** explicit:
```ts
testScheduler.run(({ cold, expectObservable }) => {
  // two rapid filter emissions: the first inner must be CANCELLED
  const filters$ = cold('a 50ms b|');
  const result$  = filters$.pipe(debounceTime(150, sched), switchMap(go));
  expectObservable(result$).toBe('...');   // assert only b's result lands
});
```
This is how you *prove* the cancel-stale guarantee deterministically — no flaky
`setTimeout`. Name `TestScheduler`, cold vs hot, and the ASCII frames as the senior
vocabulary.

---

## 7. Accessibility — the gaps we're fixing (DEMO-PROVEN gaps)

The dashboards do several things **right** already, and have named gaps a senior should
own honestly.

**Done right (quote these):**
- Status is never colour-alone: KPI accent bar **plus** a glyph + text
  (`kpi-card.component.ts:71-77`, `:6-7` doc), brand-table health colour *plus* numeric
  value (`brand-table.ts:87`).
- Keyboard-operable custom controls: brand rows are `role="button"`, `tabindex="0"`,
  with `(keydown.enter)` mirroring `(click)` and `[attr.aria-pressed]`/`aria-label`
  (`brand-table.ts:64-73`). Period buttons expose `aria-pressed`
  (`filter-bar.component.ts:18`), the group has `role="group" aria-label="Period"`
  (`:13`).
- Real `<label>` association: territory select wraps a `<label>` with an `sr-only`
  span so the control is named even when the text is visually hidden
  (`filter-bar.component.ts:28-30`).
- Decorative SVG marked `aria-hidden="true"` (sparkline, `kpi-card.component.ts:43`).
- Insight text computed for screen readers / executive scanning
  (`dashboard-page.component.ts:240-256`).

**Gaps being fixed (say these honestly):**
1. **No skip-nav link.** `grep -rni skip ... | grep nav` returns nothing across
   `src/app`. Keyboard users tab through the whole filter bar before reaching content.
   Fix: a visually-hidden-until-focused `<a href="#main">Skip to content</a>` as the
   first focusable element, targeting `<main id="main">`.
2. **Heading-per-surface, not per-page-region.** Each surface has exactly one `<h1>`
   (good: franchisee `:54`, corporate `dashboard.html:6`, login), but section panels
   use styled text without programmatic `<h2>` structure everywhere, so the heading
   outline a screen reader builds is thin. Fix: ensure each `app-chart-panel`/`section`
   renders a real `<h2>`/`<h3>`.
3. **Live regions for async results.** When `switchMap` swaps in new KPI numbers, a
   screen-reader user gets no announcement. Fix: `aria-live="polite"` on the results
   region (and the error panel) so updates and "Unable to load…" are announced.

HFC tie-in: this is a franchisor admin/exec tool — accessibility is both a legal
(WCAG/ADA) and a usability bar for a tool used all day. Naming the gaps *with the grep
that proves them* is exactly the credibility move an interviewer rewards.

---

## 8. Typed view-model mapping (DEMO-PROVEN, deeper than M6)

The discipline: **the wire DTO never reaches a template.** The page owns a `DashboardVm`
interface (`dashboard-page.component.ts:26-29`) and maps DTO→VM exactly once, in a
`computed`, so formatting/derivation happens in one typed place:

```ts
// dashboard-page.component.ts:208-225
readonly kpiVms = computed<KpiCardVm[]>(() =>
  (this.data()?.response.kpis ?? []).map((k) => this.toKpiVm(k)));

private toKpiVm(k: KpiDto): KpiCardVm {
  return { ...k.passthrough,
    formattedValue: formatKpiValue(k.value, k.unit),
    deltaLabel: formatDeltaPercent(k.deltaPercent),
    deltaStatus: deltaStatus(k.deltaPercent, k.higherIsBetter), ... };
}
```
Why it matters:
- **The DTO is the frozen contract** ([[M3-api-contracts]]); the VM is the UI's private
  shape. Decoupling them means a contract-additive change (M3 §3) doesn't ripple into
  templates, and a UI re-skin doesn't pressure the API.
- **Presentational components stay dumb:** `KpiCardComponent` takes `KpiCardVm` and does
  no business logic (`kpi-card.component.ts:6-7,49-50`) — only view-derived computeds.
- **`computed` memoizes the mapping** — it re-runs only when `data()` changes, not every
  CD pass, which is the performance half of the same decision.
- The fixture/live seam returns the **identical** `DashboardResponse` shape in both modes
  (`dashboard-api.service.ts:14,22`), so the VM mapping is the only translation layer and
  it's exercised the same way against mock or Bravo.

---

## 9. Trade-offs (say these out loud)

- **Signals vs RxJS for state.** Signals: synchronous, glitch-free, no subscription
  lifecycle, great for derived UI state — but no native time operators (debounce, retry,
  cancel). RxJS: rich async composition — but lifecycle you must manage and easy to leak.
  *Rule used here:* RxJS for the async pipeline, signals for everything downstream,
  bridged by `toSignal`/`toObservable` (`dashboard-page.component.ts:3,181,203`). Don't
  rebuild debounce/cancel in signals; don't model a filter dropdown as a Subject.
- **OnPush risks.** Faster, but it *trusts you to pass new references*. Mutating an array
  in place (`arr.push`) won't trip OnPush → stale UI. The mitigation is the immutable-
  update style the demo uses everywhere (`filters.update(f => ({...f, period}))`,
  `:260-263`). OnPush also means you sometimes need `markForCheck()` after an out-of-band
  update — a footgun for juniors.
- **Zoneless gain vs migration cost.** Smaller bundle + precise CD vs auditing every
  mutation that relied on zone auto-detection. Low cost *here* because state already
  flows through signals.
- **Manual retry vs auto-retry.** Manual (`reloadTick`) gives the user control and avoids
  hammering a down API; auto-`retry`+backoff is better for flaky-but-recoverable network
  blips. Choose per surface.

---

## 10. Failure modes (the ones interviewers probe)

1. **`mergeMap` where `switchMap` was needed.** Rapid filter changes → responses land
   out of order → the dashboard paints territory A's numbers under territory B's label.
   Or on a write: double-click → two charges. Fix: `switchMap` for latest-wins reads;
   `exhaustMap`/`concatMap` + Idempotency-Key for writes (`dashboard-page.component.ts:286`).
2. **CD performance death by binding.** Method calls in templates + default CD + no
   trackBy → every async tick re-runs every binding over the whole list. Fix: OnPush +
   `computed` (no method calls in bindings) + `track` by identity — all present in the
   demo (`:40,208`; `kpi-card.component.ts:80`; `filter-bar.component.ts:36`).
3. **Memory leaks from unsubscribed streams.** A manual `.subscribe()` that outlives the
   component keeps the component (and its DOM) alive forever. The demo avoids this by
   using `toSignal` (auto-unsubscribes with the injection context, `:203`) and the
   `async` pipe; the one manual subscribe (`payDeposit`, `:287`) is a finite one-shot
   that completes. BEST-PRACTICE alternative: `takeUntilDestroyed()`.
4. **`catchError` at the wrong level.** Placed on the outer stream, the first failure
   *completes* the pipeline and the dashboard stops reacting to filter changes. The demo
   scopes it **inside** the switchMap (`:195`) so the outer stream is immortal.
5. **`forkJoin` that never emits.** `forkJoin` only emits when *all* sources **complete**;
   a source that emits but doesn't complete hangs it forever. HTTP completes, so it's safe
   here — but pairing `forkJoin` with a long-lived Subject is a classic hang.

---

## 11. Interview defense — follow-ups & answers

**Q: You used `switchMap` for the load. What happens to the cancelled HTTP request — is
it really cancelled or just ignored?**
Really cancelled. `switchMap` unsubscribes the previous inner Observable; Angular's
`HttpClient` Observable is wired to `XMLHttpRequest.abort()` on unsubscribe, so the
browser aborts the in-flight request — server load is saved and the late response can't
arrive. Contrast: if I'd used `mergeMap`, the old XHR keeps running and could resolve
after the new one (`dashboard-page.component.ts:186`).

**Q: You're OnPush everywhere. How does the template even update when the signal changes
inside a switchMap?**
Two mechanisms cover it. Reading a **signal** in an OnPush template registers that view
as a dependency, so a signal write marks it dirty. Here `state` is a `toSignal` of the
stream (`:203`), so when `load$` emits, the signal updates and the OnPush view is marked
for check. Equivalently the `async` pipe calls `markForCheck()` on each emission. OnPush
only skips checks when *nothing* it depends on changed.

**Q: This app still ships zone.js. Is that a problem, and how would you go zoneless?**
Not a problem — it's the pragmatic state: Zone + OnPush + signals (`app.config.ts:10`,
`package.json:33`). To go zoneless I'd swap `provideZoneChangeDetection` for
`provideZonelessChangeDetection()`, drop the zone.js polyfill, and audit for any state
mutated *outside* a signal/event/async-pipe (those relied on zone auto-detect and would
need `markForCheck` or a signal). Risk is low here because state already flows through
signals — that's the whole point of the architecture.

**Q: Your bundle budget errors at 1 MB. What do you do when a new chart lib blows it?**
First, is it on the *initial* chunk or a lazy route? Lazy-load the surface so the cost is
deferred (`app.routes.ts:23`). If still over, `@defer` the heavy panel, tree-shake/check
for a lighter lib, or — as the demo does for sparklines — draw SVG directly
(`kpi-card.component.ts:80-92`). The budget failing the build is the *feature*: it forces
that conversation before users pay for it.

**Q: Where are your tests?**
Honest answer: the harness is configured (Karma/Jasmine, `package.json:41-49`) but
schematics set `skipTests:true` and I haven't written component specs yet — that's a
known gap. The code is *built* to be tested: the fixture/live seam
(`dashboard-api.service.ts:23`) injects deterministic data, the RxJS pipeline is
marble-testable, and OnPush components test cleanly through TestBed + harnesses. I'd
prioritize a marble test on `load$` (cancel-stale is the riskiest logic) and a TestBed
test that the error path renders the retry panel.

---

## 12. Demo proof (commands & file map)

```
RxJS pipeline (switchMap/forkJoin/debounce/catchError/startWith):
  web/src/app/franchisee/dashboard-page.component.ts:181-201
DTO→VM mapping (computed, once):           dashboard-page.component.ts:208-225
Manual retry via signal nonce:             dashboard-page.component.ts:178,268-270
Write w/ Idempotency-Key:                  dashboard-page.component.ts:286-287
Fixture/live seams:                        dashboard-api.service.ts:23 ; dashboard-data.service.ts:26
Zone CD + event coalescing:                app.config.ts:10
OnPush:                                     dashboard-page.component.ts:40 ; kpi-card.component.ts:12 ; filter-bar.component.ts:9 ; brand-table.ts:24
trackBy / @for track:                       filter-bar.component.ts:36 ; brand-table.ts:64
Lazy routes + budgets:                      app.routes.ts:23,29-30 ; angular.json:61-72
a11y done right:                            kpi-card.component.ts:43,71-77 ; brand-table.ts:64-73 ; filter-bar.component.ts:13,28-30
a11y gaps:                                  no skip-nav (grep) ; thin <h2> outline ; no aria-live
Testing (configured, unwritten):            package.json:41-49 ; angular.json:13-34 (skipTests:true)
```

---

## Flashcards

1. **switchMap vs mergeMap?** switchMap *cancels* the in-flight inner on a new outer
   value (latest-wins, for reads); mergeMap runs all concurrently (order-agnostic
   side-effects). mergeMap on filters → stale response races in.
2. **concatMap vs exhaustMap?** concatMap *queues* (sequential, none dropped — ordered
   writes); exhaustMap *ignores* new outer values while one is running (drop double-
   clicks — submit/login).
3. **Why is `catchError` inside the switchMap, not outside?** Outside, the first error
   *completes* the outer stream and the page stops reacting to filters. Inside, the outer
   stream is immortal (`dashboard-page.component.ts:195`).
4. **What does `forkJoin` wait for?** All sources to **complete**, then emits once
   (Promise.all analogue). Pair with a non-completing source → hangs forever.
5. **OnPush triggers?** Input *reference* change, template event, signal/async-pipe
   emission, or explicit `markForCheck()`. Otherwise the subtree is skipped.
6. **Why immutable updates with OnPush?** OnPush compares inputs by reference; an
   in-place `arr.push` won't trip it → stale UI. Demo uses `update(f => ({...f}))`.
7. **What is zone.js doing?** Monkey-patches async APIs to tell Angular "tick" → full-tree
   CD by default. `eventCoalescing:true` batches same-tick events (`app.config.ts:10`).
8. **Zoneless in one sentence?** Drop zone.js; CD driven only by signals + async pipe +
   events → smaller bundle, CD work proportional to what changed.
9. **Why does each `@for` need `track`?** Without a stable key Angular destroys/recreates
   every node on list change (loses focus/scroll). Track by identity, never `$index`.
10. **Bundle budget here?** initial 500 kB warn / 1 MB error; component style 8/16 kB —
    build *fails* over error (`angular.json:61-72`).
11. **Cross-field validation lives where?** On the parent `FormGroup` (a group-level
    validator), not on any single control — only the group can see siblings.
12. **No-leak subscription pattern?** `toSignal`/`async` pipe (auto-teardown) or
    `takeUntilDestroyed()`; never a bare `.subscribe()` that outlives the component.

---

## Mock Q&A

**1. Walk me through your dashboard's data-loading pipeline and justify every operator.**
Filter signals → `toObservable` → `debounceTime(150)` (coalesce bursts) →
`distinctUntilChanged` (skip no-op re-emits) → `switchMap` (cancel stale, latest-wins) →
`forkJoin` (parallel dashboard+territories, one emit on completion) → `map` to success
state, `startWith` loading, `catchError` to error state *inside* the switchMap → `toSignal`
into `state` → `computed` VMs into OnPush template (`:181-225`).
*Follow-up: why not handle errors with a global interceptor?* I do convert errors to
*state* for UX (retry panel), which an interceptor can't render per-surface; an
interceptor is right for cross-cutting concerns (auth header — see the tenant interceptor)
but the dashboard wants a local, retryable error view.

**2. The user clicks territory A then B fast. Prove A's data can't end up on screen.**
`switchMap` unsubscribes A's inner on B's emission; `HttpClient` aborts A's XHR on
unsubscribe, so A's response never arrives. Even without abort, switchMap discards the
old inner's emissions. I'd *prove* it with a marble test: two emissions inside the
debounce window, assert only B's result reaches the output (`:186`).
*Follow-up: what if these were saves, not loads?* Then switchMap is wrong — it'd cancel a
save. Use exhaustMap/concatMap + Idempotency-Key (`:286`) so a retry is a server no-op.

**3. Your dashboard feels janky as data streams in. Diagnose.**
Check CD: default strategy + method calls in templates + missing `track` → whole-tree
re-evaluation per tick. Fix = OnPush (`:40`), move logic into `computed` (no method
bindings, `kpi-card.component.ts:80`), `track` by id (`brand-table.ts:64`), and consider
`@defer` for below-fold panels. Confirm with Angular DevTools' CD profiler.
*Follow-up: OnPush didn't fix one panel — why?* Likely a mutated-in-place input; OnPush
needs a new reference. Switch to immutable update or `markForCheck()`.

**4. How would you test the riskiest part of this component without a browser?**
Marble-test `load$` with `TestScheduler`: assert cancel-stale and that an inner error
becomes an error *value* (stream stays alive). TestBed-test the component with a fake
`DashboardApiService` via the existing seam (`dashboard-api.service.ts:23`), call
`detectChanges()`, assert the retry panel renders on error. Harness/Testing-Library for
the accessible controls by role.
*Follow-up: coverage today?* None written — `skipTests:true`, no specs. Known gap; the
code is structured to be testable, and I'd start with the marble test.

**5. Make this dashboard accessible for a keyboard + screen-reader user.**
What's already there: keyboard-operable rows (`role=button`/`tabindex`/`keydown.enter`,
`brand-table.ts:64-73`), `aria-pressed` toggles, labeled select (`filter-bar:28-30`),
colour+text status (`kpi-card:71-77`), `aria-hidden` decorative SVG. Gaps I'd fix:
add a skip-nav link (none exists — grep proves it), ensure each panel renders a real
`<h2>` for the heading outline, and wrap async results + the error panel in
`aria-live="polite"` so swapped-in numbers and failures get announced.
*Follow-up: how do you keep a11y from regressing?* Lint with `@angular-eslint` a11y rules,
add axe checks in component tests, and assert roles/labels in harness tests rather than
CSS selectors.

---

### See also
- [[M6-angular-spa]] — basics this doc builds on (standalone, signals, interceptor, guards).
- [[M3-api-contracts]] — the frozen DTOs the VM mapping decouples the UI from.
- [[M9-cicd-prod]] — where Karma/budget checks run in the pipeline.
