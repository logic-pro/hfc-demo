# M6 — Angular 20 SPA

> Mastery doc for the HFC Senior Full Stack Cloud Developer interview.
> Every snippet below is quoted from the real `hfc-demo` `web/` app at `file:line`. Nothing here is invented.
> Cross-links: [[M3-api-contracts]] · [[M5-rbac-hierarchy]]

---

## 1. Mental model

The HFC SPA is a **single Angular 20 shell, four surfaces, one 4-tier scope hierarchy**. It is built on the *modern* Angular idioms, not the legacy ones:

- **No NgModules.** Every component is `standalone: true` and declares its own `imports`. Routing is `provideRouter`, HTTP is `provideHttpClient`. The whole app is wired by an `ApplicationConfig`, not a root module.
- **Signals are the state primitive.** Component state is `signal(...)`; derived state is `computed(...)`. No `BehaviorSubject` plumbing, no manual `OnPush` markForCheck — signals integrate with change detection natively (and the dashboard runs `ChangeDetectionStrategy.OnPush`).
- **One client-side auth seam: a functional HTTP interceptor.** Exactly one place attaches the bearer token to outgoing requests. Authorization itself lives on the server; the client just carries the credential.
- **Route guards gate by auth + scope.** `authGuard` (signed in?), `corporateGuard` (corporate scope?), `franchiseeGuard` (operator scope?). These mirror the server's RBAC so the wrong surface never even paints.
- **Strongly-typed view-models.** Components consume typed DTOs (`CorporateDashboard`, `TerritoryListItem`, `WatchlistFlag`) mapped through a single data service — never raw `any` blobs.
- **RxJS is the composition layer**, not the state layer: it sequences and combines async work (parallel loads, cancel-stale, error→state) and then *lands* the result into a signal.

The governing idea: **the client is a thin, scope-aware renderer of a server-authorized read model.** It decides what to *paint*; the server decides what you're *allowed to see*. (See [[M5-rbac-hierarchy]] for the brand→region→territory enforcement, and [[M3-api-contracts]] for the DTO shapes the client maps.)

---

## 2. Standalone components (no NgModules)

The app is composed without a single `@NgModule`. The shell is an `ApplicationConfig`:

```ts
// web/src/app/app.config.ts:7
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([tenantInterceptor])),
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
  ],
};
```

`provideHttpClient(withInterceptors([...]))` (app.config.ts:11) is the *functional* HTTP provider — it takes interceptor functions, not DI tokens. `provideRouter(routes, ...)` (app.config.ts:12) replaces `RouterModule.forRoot`.

Routes load **standalone components lazily**, each its own bundle chunk:

```ts
// web/src/app/app.routes.ts
{
  path: 'corporate',
  title: 'HFC · Network Operations Command Center',
  canActivate: [corporateGuard],
  loadComponent: () => import('./dashboard/dashboard').then((m) => m.DashboardComponent),
},
```

`loadComponent` (not `loadChildren` + a feature module) is the standalone lazy-load. The comment on `app.routes.ts` states the intent: *"The data-heavy surfaces are lazy standalone components — each its own chunk so the dashboard viz never weighs down the booking SPA."* The executive dashboard's chart/map code never ships to a franchisee who only opens `/booking`.

Components declare their own dependency graph inline:

```ts
// web/src/app/dashboard/dashboard.ts:19
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    KpiTileComponent, TerritoryMapComponent, ScorecardComponent,
    DistributionComponent, BrandTableComponent, ProvenanceComponent, WatchlistComponent,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent {
```

**Trade-off (standalone vs modules):** NgModules gave you one declaration surface and shared provider scopes, but cost a layer of indirection (which module declares this? which exports it?) and made lazy boundaries module-shaped. Standalone makes the *component* the unit: its imports are colocated, tree-shaking is per-component, and lazy chunks split at the component. The cost is you can re-import a shared component in many places — but the compiler dedupes and the ergonomics win. For a greenfield Angular 20 app there is no reason to reach for NgModules.

---

## 3. Signals for state (`signal` / `computed` / scope-aware derivation)

The dashboard holds **raw async results in writable signals** and **derives everything else with `computed`**:

```ts
// web/src/app/dashboard/dashboard.ts:48
readonly corporate = signal<CorporateDashboard | null>(null);
readonly territories = signal<TerritoryListItem[]>([]);
readonly watchlist = signal<WatchlistFlag[]>([]);
readonly loading = signal(true);
readonly mapLoading = signal(true);
readonly watchlistLoading = signal(true);
readonly error = signal<string | null>(null);
```

Derived view-model slices are pure `computed` over those signals — they recompute only when their inputs change, and the template re-renders only what depends on them:

```ts
// web/src/app/dashboard/dashboard.ts:62
readonly vitalSigns = computed(() => this.corporate()?.vitalSigns ?? []);
readonly brandComparison = computed(() => this.corporate()?.brandComparison ?? []);
readonly dataNotes = computed(() => this.corporate()?.dataNotes ?? []);
readonly period = computed(() => this.corporate()?.period ?? null);
```

A `computed` can also turn one signal into a UI affordance — `scorecardOpen` is just "is a territory selected?":

```ts
// web/src/app/dashboard/dashboard.ts:60
readonly scorecardOpen = computed(() => this.selectedTerritoryId() !== null);
```

### Cross-filter via a single signal (HFC tie-in)

The portfolio→brand drill is one signal driving three panels at once — the franchisor's whole mental model ("show me just this brand") collapses to a `set()`:

```ts
// web/src/app/dashboard/dashboard.ts:70
readonly selectedBrandId = signal<number | null>(null);
readonly selectedBrand = computed(
  () => this.brandComparison().find((b) => b.brandId === this.selectedBrandId()) ?? null,
);
```

The comment names the design (dashboard.ts:67): *"ONE signal drives the map, the distribution and the brand table (D17): pick a brand in any of them and all three re-scope together. null = whole portfolio."* No event bus, no shared service subject — the click handler just does `this.selectedBrandId.set(brandId)` (dashboard.ts:123) and every `computed` reading it updates.

### Scope-aware header (corporate vs franchisee)

The **same** command center re-labels itself from the signed-in scope. This is the franchisee-vs-corporate distinction made legible:

```ts
// web/src/app/dashboard/dashboard.ts:36
readonly scopeEyebrow = computed(() => {
  const name = this.tenant.scopeName();
  switch (this.tenant.scope()) {
    case 'brand':
      return `${name} · Brand View`;
    case 'region':
      return `${name} · Region View`;
    default:
      return 'Franchisor Network · Portfolio View';
  }
});
```

The comment is the key tie-in (dashboard.ts:33): *"the SAME command center, re-scoped by the signed-in persona. The server already filters KPIs/map/watchlist/brand-table by the token's scope claim — this just makes the active scope legible."* The client does **not** re-filter the data — it trusts the server's scoped read model and only adjusts the chrome.

### `toSignal` / `computed` note

This codebase favors the **imperative bridge** (`subscribe` → `signal.set`, §6 below) over `toSignal()`, because each panel needs to flip its *own* loading/error signal on next/error — `toSignal` collapses that into one value. The interview-relevant point: `toSignal(obs$, { initialValue })` is the declarative alternative when you want an observable surfaced directly as a read-only signal and don't need per-stream loading/error branching; `computed` is for *deriving* from signals you already hold. Use `computed` for synchronous derivation, `toSignal` for async sources you want read-only.

**Trade-off (signals vs RxJS for state):** Signals are synchronous, glitch-free, and pull-based — perfect for *state* a template reads. RxJS is push-based and excels at *time*: cancellation, debounce, retry, combining streams. The clean split this app uses: **RxJS to compose the async event flow, signals to hold the settled state.** Putting everything in `BehaviorSubject`s forces `async` pipes everywhere and manual teardown; putting async coordination into signals (e.g. effects firing HTTP) is the classic footgun (effects that write signals and re-trigger themselves). Keep the seam where it is.

---

## 4. The functional interceptor — the single client-side auth seam

This is the one place on the client that touches credentials. It is a **functional interceptor** (`HttpInterceptorFn`), registered in `withInterceptors([...])`:

```ts
// web/src/app/tenant.interceptor.ts:12
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TenantService).token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
```

Three things to say about it in the room:

1. **`inject()` in a function.** Functional interceptors run inside Angular's injection context, so `inject(TenantService)` works with no constructor — and `.token()` is a *signal read*, so it always pulls the current session token.
2. **Cross-cutting, done once.** The file comment (tenant.interceptor.ts:5): *"Cross-cutting concern handled once, not in every service call."* No service hand-rolls an `Authorization` header.
3. **Always attach; server authorizes.** The comment (tenant.interceptor.ts:6): *"The server authorizes by the token's verified scope claim … so the client no longer needs to know which URLs are corporate vs franchisee."*

### The read-down evolution (a real bug)

The current interceptor is deliberately dumb — and that is the *fix*. The comment records what it replaced (tenant.interceptor.ts:9):

> *"(This replaces the old read-down strip-list, which mis-stripped the token from the franchisee's `/api/dashboard/territories` call.)"*

The earlier design tried to be clever on the client: it kept a list of "corporate" URL prefixes and **stripped the bearer token** from requests it judged to be non-corporate (`/api/dashboard/...`). When the franchisee operator dashboard legitimately called `/api/dashboard/territories`, the client stripped the token and the server saw an **unauthenticated** request — a 401 on a screen the user was entitled to.

The role-based redesign deletes the entire problem: **the client never decides authorization.** It always attaches the token; the server reads the verified scope claim and gates the read-down corporate endpoints vs the operator endpoints itself ([[M5-rbac-hierarchy]]). The interceptor shrank from a URL-matching strip-list to four lines. *Authorization logic on the client is duplicated logic, and duplicated logic drifts.*

**Failure mode to name:** any client-side allow/deny list over URLs is a latent bug — it must be kept in perfect sync with server routing forever, and the moment a new endpoint is added the list is wrong. The interceptor's job is *transport* (carry the credential), not *policy*.

---

## 5. Route guards — gating by auth and scope

Guards are functional `CanActivateFn`s, three of them, each returning `true` or a `UrlTree` redirect (a cancelled navigation, not a thrown error):

```ts
// web/src/app/auth/auth.guard.ts:7
export const authGuard: CanActivateFn = () => {
  const tenant = inject(TenantService);
  const router = inject(Router);
  return tenant.isAuthenticated() ? true : router.createUrlTree(['/login']);
};
```

```ts
// web/src/app/auth/auth.guard.ts:15
export const corporateGuard: CanActivateFn = () => {
  const tenant = inject(TenantService);
  const router = inject(Router);
  if (!tenant.isAuthenticated()) return router.createUrlTree(['/login']);
  return tenant.isCorporate() ? true : router.createUrlTree([tenant.homeRoute()]);
};
```

```ts
// web/src/app/auth/auth.guard.ts:26
export const franchiseeGuard: CanActivateFn = () => {
  const tenant = inject(TenantService);
  const router = inject(Router);
  if (!tenant.isAuthenticated()) return router.createUrlTree(['/login']);
  return tenant.scope() === 'franchisee' ? true : router.createUrlTree([tenant.homeRoute()]);
};
```

The HFC tie-in is precise:

- `corporateGuard` opens `/corporate` to the **three corporate scopes** (network / brand / region) and bounces a franchisee operator to *their* home (`homeRoute()`).
- `franchiseeGuard` opens `/dashboard` and `/booking` to **franchisee scope only** and bounces a corporate persona to the command center.

And critically, the guard is a **mirror, not the source of truth**. The `franchiseeGuard` comment (auth.guard.ts:24): *"The server enforces this too — this is the client-side mirror so the wrong surface never even paints."* If you bypassed the guard (edited the URL, patched the JS), you'd still get a 403 from the server. The guard is UX (don't flash a screen you can't use), not security.

**`UrlTree` over `router.navigate()`:** returning a `UrlTree` cancels the in-flight navigation *cleanly* and substitutes the redirect — no half-activated route, no flicker. The `authGuard` comment (auth.guard.ts:5): *"redirected to /login (as a UrlTree so the navigation is cancelled cleanly)."*

---

## 6. RxJS composition — parallel, cancel-stale, error→state

The dashboard's constructor loads **independent panels in parallel** so no single slow panel gates the page:

```ts
// web/src/app/dashboard/dashboard.ts:85
constructor() {
  // Independent panels load in parallel — neither blocks the other (no whole-page gate).
  this.data.corporate().subscribe({
    next: (c) => { this.corporate.set(c); this.loading.set(false); },
    error: () => { this.error.set('Could not load the corporate roll-up.'); this.loading.set(false); },
  });
  this.data.territories().subscribe({
    next: (r) => { this.territories.set(r.items); this.mapLoading.set(false); },
    error: () => { this.mapLoading.set(false); },
  });
  this.data.watchlist().subscribe({
    next: (w) => { this.watchlist.set(w.items); this.watchlistLoading.set(false); },
    error: () => { this.watchlistLoading.set(false); },
  });
}
```

Three subscriptions, three **independent loading signals** (`loading`, `mapLoading`, `watchlistLoading`), each flipping on its own next/error. This is the hand-rolled, panel-granular equivalent of running them concurrently — the hero KPIs can render while the map is still fetching.

> **`forkJoin` vs this pattern:** `forkJoin([a$, b$, c$])` is the idiom for "fire all in parallel, emit once *all* complete." Use it when the consumer needs the *combined* result atomically (e.g. one view-model assembled from three calls). Here each panel is *independently useful*, so independent subscriptions are the better call — `forkJoin` would make the fastest panel wait for the slowest. Knowing **why** you picked one over the other is the interview point.

### The drill-down: cancel-stale (the `switchMap` story)

Opening a territory scorecard fires a fetch and parks the result:

```ts
// web/src/app/dashboard/dashboard.ts:106
private openTerritory(territoryId: number): void {
  this.selectedTerritoryId.set(territoryId);
  this.scoreData.set(null);
  this.scoreLoading.set(true);
  this.data.healthScore(territoryId).subscribe({
    next: (s) => { this.scoreData.set(s); this.scoreLoading.set(false); },
    error: () => { this.scoreLoading.set(false); },
  });
}
```

**The lurking race:** if a user clicks territory A then quickly territory B, two `healthScore` requests are in flight. If A's response is slower and lands *after* B's, the scorecard shows A's data while the header says B — a **stale-request race**. The robust shape pipes the *selection signal* through `switchMap`, which unsubscribes the previous inner request the instant a new selection arrives:

```ts
// Robust form (the switchMap idiom this race calls for):
toObservable(this.selectedTerritoryId).pipe(
  filter((id): id is number => id !== null),
  tap(() => { this.scoreData.set(null); this.scoreLoading.set(true); }),
  switchMap((id) => this.data.healthScore(id).pipe(
    catchError(() => { this.scoreLoading.set(false); return EMPTY; }),
  )),
).subscribe((s) => { this.scoreData.set(s); this.scoreLoading.set(false); });
```

`switchMap` = "I only care about the latest" — exactly right for navigation/selection/typeahead. Contrast: `mergeMap` keeps all in flight (the race stays), `concatMap` queues them (slow, and you still apply the stale one), `exhaustMap` ignores new clicks until the current finishes (wrong for a fast drill).

### Debounce (the typeahead case)

The codebase doesn't ship a search box, but the interviewer will ask. The canonical shape for a filter/search input:

```ts
toObservable(this.searchTerm).pipe(
  debounceTime(250),            // wait for the typist to pause
  distinctUntilChanged(),       // ignore no-op keystrokes
  switchMap((q) => this.data.search(q).pipe(catchError(() => of([])))),
).subscribe((results) => this.results.set(results));
```

`debounceTime` collapses a burst of keystrokes into one request; `switchMap` cancels the previous query so results never arrive out of order. The combination is the standard "live search without hammering the API."

### Error → state, not exceptions

Every subscription above has an `error:` branch that flips a signal — there is no uncaught error path that blanks the screen. `corporate()` failure sets a human message (dashboard.ts:89); the map and watchlist failures just clear their loading flag so the panel shows its empty/error state instead of a spinner forever. The `catchError` in the robust forms returns `EMPTY`/`of([])` so the stream **completes into a state** rather than erroring out and tearing down the subscription.

---

## 7. Strongly-typed view-models mapped from DTOs

The single seam between the wire and the components is `DashboardDataService` — every method returns a **typed** `Observable<T>`, never `any`:

```ts
// web/src/app/dashboard/dashboard-data.service.ts:31
corporate(period?: number, brandId?: number, regionId?: number): Observable<CorporateDashboard> {
  if (this.live) {
    return this.http.get<CorporateDashboard>(`${this.base}/api/dashboard/corporate`, {
      params: this.params({ period, brandId, regionId, trailingWindow: 12 }),
    });
  }
  return of(buildCorporateDashboard()).pipe(delay(this.FIXTURE_LATENCY));
}
```

```ts
// web/src/app/dashboard/dashboard-data.service.ts:49
healthScore(territoryId: number, period?: number): Observable<TerritoryHealthScore> {
  if (this.live) {
    return this.http.get<TerritoryHealthScore>(
      `${this.base}/api/territories/${territoryId}/health-score`,
      { params: this.params({ period }) },
    );
  }
  const score = buildHealthScore(territoryId);
  return of(score as TerritoryHealthScore).pipe(delay(160));
}
```

The generic on `http.get<CorporateDashboard>` flows the DTO type all the way to the `computed` slices in §3, so the template can't read a field that doesn't exist on the contract. The DTO shapes (`CorporateDashboard`, `TerritoryListResponse`, `WatchlistFlag`, `TerritoryHealthScore`) are the frozen contract from [[M3-api-contracts]] — the client mirrors them in `dashboard.models.ts`.

### The fixture/live seam (one flag)

A single boolean switches the whole app between deterministic fixtures and live Bravo, **because the shapes are identical**:

```ts
// web/src/app/dashboard/dashboard-data.service.ts:25
private base = (window as any).__API_BASE__ ?? 'http://localhost:5180';
private live = (window as any).__DASHBOARD_LIVE__ === true;
```

The comment (dashboard-data.service.ts:18): *"Single seam between fixtures and live Bravo (D17). The shapes are identical (CONTRACT §2), so flipping `live` is the only change required — no component touches this decision."* And note the deliberate `FIXTURE_LATENCY = 220` (dashboard-data.service.ts:29): *"Small fixture latency so loading states are real, not theoretical."* — i.e. the loading signals get genuinely exercised even in fixture mode. This is the contract-first discipline ([[M3-api-contracts]]) paying off on the client: one DTO, two backends, zero component changes.

---

## 8. The login surface — personas, signals, scoped tokens

`LoginComponent` is the public entry point: pick a persona across the 4 tiers, mint the matching scoped token, route by scope. Behavior lives **on the persona object**, not the template, so one handler drives every tier:

```ts
// web/src/app/auth/login.component.ts:11
interface Persona {
  id: string;
  name: string;
  role: string;
  mint: () => Observable<DevTokenResponse>;
  apply: (res: DevTokenResponse) => void;
  target: string;
}
```

The persona groups are a `computed` over three catalog signals (`brands`, `regions`, `franchisees`) — a tier is *hidden* when its catalog is empty:

```ts
// web/src/app/auth/login.component.ts:162
readonly groups = computed<PersonaGroup[]>(() => [
  {
    tier: 'Franchisor HQ',
    hint: 'network scope — every territory',
    personas: [
      {
        id: 'network',
        name: 'HFC CEO',
        role: 'Franchisor HQ — every territory',
        mint: () => this.api.networkToken(),
        apply: (res) =>
          this.tenant.setCorporateSession('network', res.token, 'HFC CEO', 'HFC Network'),
        target: '/corporate',
      },
    ],
  },
  // ... Brand / Region / Franchisee tiers built from the catalogs
```

One generic click handler mints and routes, with a `busy` signal disabling the rest of the picker mid-flight:

```ts
// web/src/app/auth/login.component.ts:244
run(p: Persona): void {
  if (this.busy()) return;
  this.error.set(null);
  this.busy.set(p.id);
  p.mint().subscribe({
    next: (res) => {
      p.apply(res);
      this.router.navigateByUrl(p.target);
    },
    error: () => {
      this.error.set(`Could not sign in as ${p.name}.`);
      this.busy.set(null);
    },
  });
}
```

HFC tie-in: a **franchisee** persona lands on `/dashboard` (operator), a **corporate** persona (network/brand/region) lands on `/corporate` (command center) — the `target` field encodes the read-down route choice ([[M5-rbac-hierarchy]]). And `ngOnInit` (login.component.ts:222) short-circuits an already-authenticated refresh straight to `homeRoute()`, never re-showing the picker. The catalog loads degrade quietly: a missing brand/region catalog just hides that tier (login.component.ts:240, the `error: () => {}` swallow), but a failed `franchisees()` call flips `apiDown` because it doubles as the API health check.

---

## 9. Failure modes (say these out loud)

| Failure | Symptom | Fix in this codebase |
|---|---|---|
| **Token-strip bug** (the read-down strip-list) | Franchisee's `/api/dashboard/territories` returns 401 on a screen they own | Deleted client-side URL policy; interceptor always attaches, server authorizes (tenant.interceptor.ts:9) |
| **Stale-request race** (no `switchMap`) | Fast double-click on territories shows A's scorecard under B's header | Pipe the selection signal through `switchMap` to cancel the prior fetch (§6) |
| **No loading state** | Blank screen or content flash while fetching | Per-panel `loading`/`mapLoading`/`watchlistLoading` signals + `FIXTURE_LATENCY` so they're exercised |
| **No error state** | Uncaught error blanks the page | Every `subscribe` has an `error:` branch → `error.set(...)`; robust forms `catchError → EMPTY/of([])` |
| **Client as authority** | Drift between client allow-list and server routes | Guards are a *mirror* (auth.guard.ts:24); real enforcement is server-side |
| **Whole-page gate** | One slow panel blocks all others | Independent parallel subscriptions, not one blocking `forkJoin` (dashboard.ts:86) |

---

## 10. Interview defense — follow-ups & answers

**Q1. Why a functional interceptor instead of a class-based `HttpInterceptor`?**
Functional interceptors (`HttpInterceptorFn`) are the Angular 15+ idiom: they're plain functions registered via `withInterceptors`, run inside the injection context so `inject()` works with no boilerplate constructor, compose in order, and are trivially testable (call the function with a fake `req`/`next`). Class interceptors need a DI token + `provide` registration. There's no capability the class form has that the function form lacks here — `tenant.interceptor.ts` is four lines.

**Q2. The interceptor attaches the token to *every* request. Isn't that a security risk — leaking the token to third parties?**
It attaches to every request *this client makes*, all of which go to our own API base. The token is a scoped JWT; the server validates the signature and reads the scope claim to authorize. The risk to manage is not "attaching too widely" but "attaching to a foreign origin" — which is why `base` is our own API (`dashboard-data.service.ts:25`) and we don't proxy arbitrary URLs through `HttpClient`. The old strip-list tried to be selective and produced a *worse* outcome (a real 401 bug). Selectivity belongs on the server, which sees the verified claim.

**Q3. You hold state in signals but compose with RxJS. Where exactly is the line, and why not pick one?**
RxJS owns *time and coordination*: parallel loads, cancellation (`switchMap`), debounce, retry, `catchError`. Signals own *settled synchronous state* the template reads, with `computed` for derivation. The bridge is the `subscribe`→`signal.set` at the edge (dashboard.ts:87). Going all-RxJS forces `async` pipes and manual teardown everywhere; going all-signals pushes you toward effects-that-fetch, which is the classic self-retriggering footgun. The split keeps each tool on its strength.

**Q4. How do you prevent the territory drill-down race, and why `switchMap` over the other flatteners?**
Pipe the `selectedTerritoryId` signal (via `toObservable`) into `switchMap(id => healthScore(id))`. `switchMap` unsubscribes the in-flight request the moment a new id arrives, so only the latest selection's response can land — the race is structurally impossible. `mergeMap` keeps both in flight (race remains), `concatMap` queues and still applies the stale one, `exhaustMap` drops new clicks until the current resolves (wrong for a responsive drill). "Latest wins" = `switchMap`.

**Q5. The guards run on the client — can't a user just bypass them?**
Yes, and that's fine, because the guards aren't the security boundary — the server is (auth.guard.ts:24, "The server enforces this too"). A franchisee who hand-edits the URL to `/corporate` gets bounced by `corporateGuard` for UX, but even if they patched the JS to skip it, the corporate endpoints would 403 on the token's scope claim. Guards exist so the wrong surface *never paints*; authorization lives where it can't be tampered with ([[M5-rbac-hierarchy]]).

---

## 11. Demo proof

- **Token-strip fix:** sign in as a **franchisee**, open `/dashboard` — the operator panels load (no 401). Then read `tenant.interceptor.ts:9` aloud: this used to break exactly this call. The interceptor now has zero URL logic.
- **Scope-aware re-skin:** sign in as **HFC CEO** (network) → `/corporate` header reads "Franchisor Network · Portfolio View"; sign in as a **Brand President** → same surface, header reads "{Brand} · Brand View" (dashboard.ts:36). Same components, server-scoped data.
- **Guard bounce:** while signed in as a franchisee, manually navigate to `/corporate` → bounced to `/dashboard` by `corporateGuard`. While corporate, navigate to `/booking` → bounced to `/corporate`.
- **Parallel loads + loading state:** open `/corporate` with throttled network → hero KPIs, map, and watchlist resolve independently (each its own spinner), thanks to the three separate subscriptions and `FIXTURE_LATENCY = 220`.
- **Cross-filter:** click a brand in the brand table → map, distribution, and brand table all re-scope together (one `selectedBrandId` signal).
- **Lazy chunks:** build the app and inspect the bundle — `/corporate` (dashboard) and `/dashboard` (franchisee) are separate `loadComponent` chunks (app.routes.ts).

---

## Flashcards

1. **Q:** How is the HFC SPA wired without NgModules? **A:** An `ApplicationConfig` with `provideHttpClient(withInterceptors([...]))` + `provideRouter(routes)`; every component is `standalone: true` with its own `imports` (app.config.ts:7).

2. **Q:** What does the tenant interceptor do, in four lines? **A:** Reads the session token signal; if present, clones the request adding `Authorization: Bearer <token>`; else passes through. Always attach, server authorizes (tenant.interceptor.ts:12).

3. **Q:** What was the read-down bug the interceptor fixed? **A:** An old URL strip-list mis-stripped the token from the franchisee's `/api/dashboard/territories` call → 401 on a screen they owned (tenant.interceptor.ts:9).

4. **Q:** Why does the interceptor not need to know corporate vs franchisee URLs? **A:** The server reads the verified scope claim and authorizes; client-side URL policy is duplicated logic that drifts.

5. **Q:** What do the three route guards gate? **A:** `authGuard` = signed in; `corporateGuard` = network/brand/region scope; `franchiseeGuard` = franchisee scope. Each returns `true` or a redirect `UrlTree` (auth.guard.ts).

6. **Q:** Why return a `UrlTree` from a guard instead of calling `router.navigate`? **A:** It cancels the in-flight navigation cleanly and substitutes the redirect — no half-activated route, no flicker (auth.guard.ts:5).

7. **Q:** Are the guards a security boundary? **A:** No — they're a client-side *mirror* for UX; the server enforces the same scope rules (auth.guard.ts:24).

8. **Q:** Where's the signals/RxJS line in the dashboard? **A:** RxJS composes async (parallel loads, cancel, debounce, error); signals hold settled state; `computed` derives. Bridge = `subscribe → signal.set` (dashboard.ts:87).

9. **Q:** Why three independent subscriptions instead of `forkJoin` on the dashboard? **A:** Panels are independently useful — `forkJoin` would make the fast panel wait for the slow one. Each has its own loading/error signal (dashboard.ts:86).

10. **Q:** Which RxJS operator fixes the territory drill-down race, and why? **A:** `switchMap` — it cancels the prior in-flight request so only the latest selection's response can land ("latest wins").

11. **Q:** How does one signal cross-filter three panels? **A:** `selectedBrandId` is set on click; map, distribution, and brand table each read it via `computed`, so all re-scope together (dashboard.ts:70).

12. **Q:** How does the app switch between fixtures and live Bravo with no component changes? **A:** One flag `__DASHBOARD_LIVE__` in `DashboardDataService`; DTO shapes are identical, so only that boolean flips (dashboard-data.service.ts:18).

---

## Mock Q&A

**1. Walk me through what happens when a franchisee clicks their persona on the login screen.**
`run(p)` sets `busy` to that persona's id (disabling the others), calls `p.mint()` — for a franchisee that's `api.token(f.id)` — and subscribes (login.component.ts:244). On success, `p.apply(res)` calls `tenant.setSession(...)` to store the scoped token, then `router.navigateByUrl('/dashboard')`. The `franchiseeGuard` re-checks scope on activation and lets them through. Every subsequent HTTP call gets the bearer token via the interceptor; the server returns the franchisee-scoped read model.
- *Follow-up: what if the mint fails?* The `error:` branch sets a message ("Could not sign in as …") and clears `busy` so the picker is usable again (login.component.ts:253).
- *Follow-up: what if they refresh the page?* `ngOnInit` sees `tenant.isAuthenticated()` and routes straight to `homeRoute()`, skipping the picker (login.component.ts:222).

**2. The dashboard loads three things in the constructor. Critique that design.**
It's deliberate: three independent subscriptions, three independent loading signals, so the hero KPIs paint without waiting for the map or watchlist (dashboard.ts:85). The trade-off vs `forkJoin` is exactly right because the panels are independently useful. What I'd watch: the constructor is doing I/O — fine here, but if it grew I'd move it to an `ngOnInit` or a resource pattern; and the subscriptions aren't explicitly torn down — acceptable for HTTP (single emit, completes) but I'd use `takeUntilDestroyed()` if any became long-lived.
- *Follow-up: when WOULD you use `forkJoin` here?* If a single view-model needed all three atomically — e.g. a summary tile computed from corporate+territories+watchlist together. Then I'd `forkJoin` and set one combined signal.
- *Follow-up: how do you exercise the loading states in dev?* `FIXTURE_LATENCY = 220ms` delays fixture emissions so spinners are real, not theoretical (dashboard-data.service.ts:29).

**3. A user clicks territory A then B fast and sees A's data under B's title. Diagnose and fix.**
Stale-request race: `openTerritory` fires `healthScore(id).subscribe(...)` per click (dashboard.ts:106); if A is slower it lands last and overwrites B. Fix: drive it off the `selectedTerritoryId` signal through `toObservable(...).pipe(switchMap(id => healthScore(id)))` so each new selection cancels the prior request — only the latest can set `scoreData`. Add `catchError → EMPTY` inside the `switchMap` so a failed fetch clears loading without killing the stream.
- *Follow-up: why not `mergeMap`?* It keeps both requests alive — the race survives. `switchMap` is the only flattener that cancels the previous inner observable.
- *Follow-up: how would you unit-test this?* Marble-test the selection stream emitting A then B with A delayed; assert only B's value reaches the subscriber.

**4. Explain the auth seam end to end — login to authorized API call.**
Login mints a scoped JWT and stores it via `TenantService` (a signal). On every request the functional `tenantInterceptor` reads `tenant.token()` and attaches `Authorization: Bearer <token>` — once, for all requests (tenant.interceptor.ts:12). Route guards mirror the token's scope to gate which surface paints (auth.guard.ts). The server validates the signature and reads the scope claim to filter the read model. The client never decides authorization — that's the lesson from the deleted strip-list bug.
- *Follow-up: where would token refresh go?* Inside the interceptor or a paired one: catch a 401, refresh, retry the cloned request. The single seam is exactly where that belongs — no service would need to change.
- *Follow-up: how is this different from real Entra/B2C?* The persona picker stands in for a real IdP login (login.component.ts:26); swap `mint()` for an MSAL acquire-token call and the rest of the chain (interceptor, guards, server validation) is unchanged.

**5. Why standalone components and lazy `loadComponent` for HFC specifically?**
HFC ships two very different audiences from one app: corporate executives (data-heavy command center with maps/charts) and franchisee operators (booking/scheduling). With standalone + `loadComponent`, the dashboard's visualization code is its own chunk and never ships to a franchisee who only opens `/booking` (app.routes.ts). Standalone also colocates each component's `imports`, so the dependency graph is legible per-surface — important when corporate and operator surfaces evolve on different cadences.
- *Follow-up: downside of standalone?* You can re-import a shared component in many places; the compiler dedupes, but you lose the single "shared module" declaration point. Worth a shared barrel of common standalone components.
- *Follow-up: how do guards interact with lazy loading?* `canActivate` runs *before* the lazy chunk loads, so an unauthorized user never even downloads the bundle for a surface they can't see — a nice security/perf bonus.

---

*See also: [[M3-api-contracts]] (the DTO shapes the client maps and the fixture/live contract) · [[M5-rbac-hierarchy]] (the brand→region→territory scope claims the guards and interceptor defer to).*
