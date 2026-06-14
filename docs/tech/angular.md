# Angular 20 — project notes & interview prep

## What it is

Angular 20 is a full-featured, opinionated front-end framework from Google. Its
headline changes since Angular 17 are:

- **Signals** — a fine-grained reactive primitive that replaces `BehaviorSubject`
  for synchronous view state. `signal()`, `computed()`, and `effect()` integrate
  directly into the template without a pipe.
- **New control flow** — `@if`, `@for`, `@switch` built into the template compiler,
  replacing `*ngIf`/`*ngFor` structural directives. Smaller bundle, better type
  narrowing.
- **Standalone-first** — components declare their own `imports`; `NgModule` is still
  supported but optional and largely absent from new code.
- **Functional interceptors** — `HttpInterceptorFn` replaces `HttpInterceptor` class
  implementations; registered via `withInterceptors([...])` in the app config.
- **Zoneless direction** — Zone.js coalescing (`eventCoalescing: true`) is the
  transitional step; full zoneless change detection is the stated roadmap.

## How it's used in the HFC demo

### Standalone component — no NgModules

`web/src/app/app.ts` is the only component in the app. It is decorated with
`@Component` and declares its own dependency:

```ts
@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit { ... }
```

There is no `AppModule`. The component is bootstrapped directly via
`bootstrapApplication(App, appConfig)` (standard Angular 20 standalone bootstrap).

### Signals for view state + computed derived state

All mutable UI state is held as signals in `app.ts`:

```ts
readonly brands           = signal<Brand[]>([]);
readonly slots            = signal<Slot[]>([]);
readonly appointments     = signal<Appointment[]>([]);
readonly selectedBrandId  = this.tenant.brandId;   // shared with interceptor
readonly customerName     = signal('Jane Doe');
readonly loading          = signal(false);
readonly error            = signal<string | null>(null);
readonly notice           = signal<string | null>(null);
```

Two computed signals derive from those primaries without any subscription boilerplate:

```ts
readonly selectedBrand = computed(() =>
  this.brands().find((b) => b.id === this.selectedBrandId()) ?? null,
);
readonly openSlots = computed(() => this.slots().filter((s) => !s.isBooked));
```

`TenantService` (`web/src/app/tenant.service.ts`) owns the single canonical
`brandId` signal. `App` aliases it (`this.tenant.brandId`) rather than copying it,
so the interceptor and the UI always read the same reference.

### RxJS `forkJoin` for parallel reads

When the user selects a brand, `refresh()` issues slots and appointments in
parallel and waits for **both** to complete before painting:

```ts
forkJoin({ slots: this.api.slots(), appointments: this.api.appointments() })
  .subscribe({
    next: ({ slots, appointments }) => {
      this.slots.set(slots);
      this.appointments.set(appointments);
      this.loading.set(false);
    },
    error: () => { ... },
  });
```

`forkJoin` is used — not `combineLatest` — because the API calls are
one-shot HTTP requests that complete after one emission. `combineLatest` would
re-emit on every new value from either source; that is the wrong semantic here.

### Functional HTTP interceptor — the single tenant seam

`web/src/app/tenant.interceptor.ts`:

```ts
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const brandId = inject(TenantService).brandId();
  if (!brandId) return next(req);
  return next(req.clone({ setHeaders: { 'X-Tenant-Id': brandId } }));
};
```

- Uses `inject()` inside the function body (valid in Angular's injection context
  for functional interceptors).
- Reads the signal synchronously — no subscription, no Observable overhead.
- Registered once in `app.config.ts` via `withInterceptors([tenantInterceptor])`.
- Is the **only** place in the codebase that knows about tenancy. Services and
  components are completely unaware of the header. In production, this one function
  is where an auth-token tenant claim would replace the explicit header.

### `inject()` DI

Both services are injected with the `inject()` function rather than constructor
parameters:

```ts
private api    = inject(ApiService);
private tenant = inject(TenantService);
```

This is the modern Angular pattern. It avoids verbose constructor signatures and
works identically in standalone components, functional interceptors, and guards.

### `@if` / `@for` control flow

`web/src/app/app.html` uses the Angular 17+ block syntax throughout:

```html
@for (b of brands(); track b.id) {
  <button [class.active]="b.id === selectedBrandId()" (click)="selectBrand(b.id)">
    {{ b.name }}
  </button>
}

@if (selectedBrand(); as brand) {
  ...
} @else {
  <p class="hint">Pick a brand above...</p>
}
```

Note `@if (selectedBrand(); as brand)` — the template engine narrows `brand` to
`Brand` (not `Brand | null`) inside the block. `@for` requires a `track` expression;
tracking by `b.id` enables efficient DOM diffing.

Signal values are called as functions in the template: `brands()`, `selectedBrandId()`,
`openSlots()`. Angular's signal-aware change detection re-renders only the parts of
the template that depend on a signal that changed.

### HttpClient typed services

`web/src/app/api.service.ts` is a thin, typed wrapper:

```ts
brands():      Observable<Brand[]>     { return this.http.get<Brand[]>(`${this.base}/api/brands`); }
slots():       Observable<Slot[]>      { return this.http.get<Slot[]>(`${this.base}/api/slots`); }
appointments():Observable<Appointment[]>{ return this.http.get<Appointment[]>(`${this.base}/api/appointments`); }
book(req):     Observable<Appointment> { return this.http.post<Appointment>(`${this.base}/api/appointments`, req); }
deposit(...):  Observable<Appointment> { return this.http.post<Appointment>(..., { headers: { 'Idempotency-Key': key } }); }
```

The service returns Observables so callers can compose with RxJS operators
(`retry`, `switchMap`) if needed. It does not subscribe — subscriptions happen in
the component.

### Runtime API-base override for same-origin prod

```ts
private base = (window as any).__API_BASE__ ?? 'http://localhost:5180';
```

In the deployed build, the SPA is served by the same App Service as the API
(`api/wwwroot`, `MapFallbackToFile`). `public/api-base.js` sets
`window.__API_BASE__` to the production origin at load time, no rebuild required.
In dev, the default `localhost:5180` is used.

### 409 / optimistic-concurrency handling

`book()` in `app.ts` distinguishes a 409 (slot taken by a concurrent user) from
other errors:

```ts
error: (e) => {
  this.error.set(e.status === 409 ? 'That slot was just taken — refreshed.' : 'Booking failed.');
  this.refresh();
},
```

A 409 triggers a re-sync rather than a dead-end error state — the UI recovers
gracefully.

### `provideHttpClient` with interceptors

`web/src/app/app.config.ts`:

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([tenantInterceptor])),
  ],
};
```

`withInterceptors` is the standalone / functional API. The older `HTTP_INTERCEPTORS`
multi-provider token is for class-based interceptors and is not used here.

## Why we chose it (and alternatives)

### Signals vs RxJS `BehaviorSubject` for synchronous view state

`TenantService.brandId` is a `signal<string | null>`, not a `BehaviorSubject`.
Reasons:

- The value is **synchronous state** — always available, no async delivery needed.
- Signals are read in the template with `brandId()` — no `async` pipe, no
  subscription lifecycle to manage.
- The interceptor reads the signal in a synchronous call; a `BehaviorSubject`
  would require `.getValue()` (less idiomatic) or an Observable pipe (wrong shape
  for an interceptor that must return synchronously).
- `computed()` derives from signals naturally; deriving from a `BehaviorSubject`
  requires `combineLatest` + `map` + `async` pipe.

RxJS Observables remain the right tool for **async event streams**: HTTP calls,
user input with debounce, WebSocket messages. The two primitives complement each
other rather than compete.

### Functional vs class-based interceptors

Functional interceptors (`HttpInterceptorFn`) were introduced in Angular 15 and
are the default in Angular 20. Advantages over class interceptors:

- Registered with `withInterceptors([fn])` — explicit, tree-shakeable, order-obvious.
- `inject()` works inside the function body without needing a constructor.
- Easier to unit-test: just call the function with mock `req` and `next`.
- Class interceptors required the `HTTP_INTERCEPTORS` multi-provider token,
  which is easy to misconfigure (wrong order, missing `multi: true`).

### Standalone vs NgModule

`NgModule` was Angular's composition unit until Angular 14. Standalone components
declare their own `imports` and can be bootstrapped directly. Benefits:

- No barrel `declarations` array to keep in sync.
- Better lazy loading — a standalone component is its own lazy-loadable chunk.
- Simpler mental model: what a component needs is declared where the component is.

For a single-component demo the difference is minor, but it reflects current
best practice for new Angular code.

### Angular 20 — Node 24 compatibility

`@angular/cli@18` raises an engine error on Node 24 ("not supported"). Angular 20
(CLI + framework) was released with Node 24 in its supported engine range.
Scaffolding with `@angular/cli@20` (`npx @angular/cli@20 new`) is the correct
command in a Node 24 environment.

## Core concepts to nail

### Signals vs Observables — when to use each

| Concern | Primitive |
|---|---|
| Synchronous UI state (selected item, loading flag) | `signal()` |
| Derived synchronous state | `computed()` |
| Side effects on signal change | `effect()` |
| HTTP calls (async, one-shot) | `Observable` (HttpClient) |
| Parallel async calls | `forkJoin` |
| Dependent async calls (result of A feeds B) | `switchMap` |
| Multiple ongoing streams | `combineLatest` |

Signals and Observables interop via `toObservable(signal)` and `toSignal(obs$)` from
`@angular/core/rxjs-interop`.

### Change detection / zoneless direction

Angular's classic change detection is Zone.js-based: Zone patches browser APIs
and triggers a check after any async event. `provideZoneChangeDetection({ eventCoalescing: true })`
reduces redundant checks by batching events in the same microtask.

The **zoneless** direction (`provideExperimentalZonelessChangeDetection()`,
available experimentally in Angular 18+) drops Zone.js entirely. Components opt
into push-based updates via signals and `ChangeDetectionStrategy.OnPush`. This
produces smaller bundles and more predictable performance. In a signal-heavy app
like this demo, most of the wiring is already zoneless-ready.

### RxJS operators

- **`forkJoin`** — waits for all source Observables to complete, emits one combined
  value. Correct for parallel one-shot HTTP calls.
- **`switchMap`** — cancels the previous inner Observable when the outer emits.
  Correct for dependent calls where only the latest outer value matters (e.g.,
  search-as-you-type).
- **`combineLatest`** — emits whenever any source emits, with the latest from all.
  Correct for live-updating derived state from multiple ongoing streams.
- **`catchError`** — intercepts errors in a pipe and returns a replacement
  Observable, enabling graceful degradation without unsubscribing.
- **`retry` / `retryWhen`** — re-subscribes on error, useful for transient network
  failures.

### Interceptors

An interceptor sits in the `HttpClient` pipeline. Every request passes through
registered interceptors in order before leaving the browser, and every response
passes through in reverse. Correct uses: authentication headers, logging, error
normalisation, retry logic. A functional interceptor returns `next(req.clone({...}))`
— always clone, never mutate the original request.

### Dependency injection

Angular's DI container is hierarchical (root → component). `inject()` resolves a
token in the current injection context. `@Injectable({ providedIn: 'root' })`
creates a singleton scoped to the root injector — appropriate for services shared
across the whole app (both `ApiService` and `TenantService` use this).

### Lifecycle hooks

- `ngOnInit` — runs after the first `ngOnChanges`; safe to call services and set
  initial state. Used in `app.ts` to fetch the brand list.
- `ngOnDestroy` — clean up subscriptions, timers, effects.
- `ngOnChanges` — receives `SimpleChanges` for `@Input` changes.
- `afterNextRender` / `afterRender` — zoneless-era hooks for DOM access.

### New control flow (`@if`, `@for`, `@switch`)

Compiled into the template IR; no directive import needed. `@for` requires `track`
for identity. `@if (expr; as local)` narrows the type inside the block. `@switch`
replaces `ngSwitch` without the extra wrapping element.

### `OnPush` change detection

`ChangeDetectionStrategy.OnPush` tells Angular to skip checking a component unless:
an `@Input` reference changes, an event originates inside the component, an async
pipe receives a new value, or a signal it reads changes. Combined with signals,
`OnPush` is effectively the default behaviour even without the decorator — signals
directly notify the scheduler.

## Gotchas we actually hit

### `@angular/cli@18` rejects Node 24

Scaffolding with Angular CLI 18 on a Node 24 host fails with an unsupported engine
error. Fix: scaffold with `npx @angular/cli@20 new`. Already resolved in this repo —
`web/` was created with Angular CLI 20.

### `ng serve` snapshots `public/` at startup

Angular dev server (`ng serve`) reads the `public/` directory once when it starts.
If you create `public/api-base.js` (the file that sets `window.__API_BASE__`) after
`ng serve` is already running, the file 404s and the browser logs a MIME-type error
for the missing `<script>` tag. Always restart `ng serve` after adding files to
`public/`. In production this is a non-issue because the file is in place before
the API App Service serves it.

## Interview Q&A

**Q1. What is a signal, and how does it differ from a `BehaviorSubject`?**

A signal is a reactive value container that Angular's change detection natively
understands. Reading a signal inside a template (or a `computed()`) registers a
dependency; when the signal is written, only the template nodes that depend on it
are re-evaluated. A `BehaviorSubject` is an RxJS Observable with a current-value
accessor. You subscribe to it; Angular knows nothing special about it unless you
use the `async` pipe. Signals are simpler for synchronous state: no subscription
management, no `async` pipe, no risk of memory leaks from forgotten unsubscribes.
Use signals for UI state; use Observables for async event streams.

**Q2. How does the `X-Tenant-Id` header get onto every HTTP request without every
service knowing about it?**

A single functional interceptor (`tenantInterceptor`) is registered in
`app.config.ts` via `provideHttpClient(withInterceptors([tenantInterceptor]))`.
Every `HttpClient` call passes through it. The interceptor reads the current
`brandId` signal from `TenantService`, clones the request with `setHeaders`, and
passes the clone to `next`. No service or component sets the header manually.
In production the interceptor would attach a JWT from an auth service instead,
and the server would extract the tenant claim from the token — one-line swap at one
seam.

**Q3. Why `forkJoin` and not `combineLatest` for the parallel slot/appointment fetch?**

`forkJoin` is designed for Observables that complete after a finite number of
emissions — exactly what `HttpClient.get` returns (one emission, then complete).
`forkJoin` emits a single combined value once all sources complete and is then done.
`combineLatest` re-emits every time any source emits a new value; it never
completes while its sources are alive. Using `combineLatest` with HTTP calls would
work for the first load but would not behave correctly if those Observables were
replaced with live streams later. `forkJoin` also errors immediately if any source
errors, which is the desired behaviour for a loading gate.

**Q4. What is `switchMap` for, and when would you use it instead of `forkJoin`?**

`switchMap` is for dependent, sequential async calls where only the latest outer
value matters. Example: a search box where the user types and each keystroke fires
a new HTTP call. `switchMap` cancels (unsubscribes from) the in-flight inner
Observable when the outer emits again, so only the latest query's result is
processed. Use `forkJoin` when calls are independent and parallel; use `switchMap`
when the result of one call is the input to another, or when you need cancellation.

**Q5. How would you add auth-token injection to this interceptor without touching
any service or component?**

Replace the `TenantService` read with an `AuthService` read:

```ts
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).accessToken();   // signal or sync getter
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { 'Authorization': `Bearer ${token}` } }));
};
```

If the token is async (requires a refresh), you return an Observable:

```ts
return from(inject(AuthService).getValidToken()).pipe(
  switchMap(token => next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))),
);
```

Everything else in the app is unchanged.

**Q6. What is the difference between `provideZoneChangeDetection({ eventCoalescing: true })`
and going fully zoneless?**

`eventCoalescing: true` keeps Zone.js but batches multiple DOM events that fire in
the same microtask into a single change detection run. It reduces redundant checks
without requiring code changes. Fully zoneless
(`provideExperimentalZonelessChangeDetection()`) removes Zone.js from the bundle
entirely — change detection runs only when signals change, `markForCheck()` is
called, or async pipes receive values. Zoneless apps are faster (no Zone patching
overhead), produce smaller bundles, and are SSR-friendly. The catch is that any
third-party code that relies on Zone interception must be adapted.

**Q7. Why use `inject()` instead of constructor injection?**

Functional effect: `inject()` works in functional interceptors, route guards as
functions, and factory providers — contexts where there is no constructor. In
components it is a style choice: `inject()` reduces boilerplate (no `constructor`
keyword, no parameter list), and field declarations read like other class fields.
Both styles are supported and functionally equivalent in components.

**Q8. How does `@if (selectedBrand(); as brand)` improve on `*ngIf="selectedBrand() as brand"`?**

Both narrow the type inside the block so `brand` is `Brand` rather than
`Brand | null`. The new control flow syntax does not create a host element (unlike
`<ng-template [ngIf]>`), compiles to more efficient IR, and does not require
`CommonModule` (or `NgIf`) to be imported. It also supports the `@else` branch
inline without a separate `ng-template #else` reference. Type narrowing is
identical but the new syntax is checked at compile time within the block by the
template type checker.

**Q9. What is `ChangeDetectionStrategy.OnPush` and is it needed here?**

`OnPush` tells Angular to skip checking a component's view unless an `@Input`
reference changes, an event originates inside it, an async pipe fires, or a signal
it reads is written. In a signals-only component this is effectively the behaviour
Angular already uses when signals drive rendering — Angular's signal-aware
scheduler bypasses Zone-based dirty-marking for signal updates. Explicitly adding
`OnPush` to this component would be belt-and-suspenders: good practice for a real
production component, not strictly necessary here since all reactive state is in
signals and Zone coalescing is enabled.

**Q10. The API base URL is set via `window.__API_BASE__` at runtime. What are the
trade-offs of this approach vs. an Angular environment file?**

Environment files (`src/environments/environment.ts`) are baked in at build time —
you need a separate build artifact per environment. The `window.__API_BASE__`
approach uses a small `public/api-base.js` script tag: same build artifact, swap
the script to point at a different API. This enables the deployed model used here:
one Angular prod bundle served by the API App Service (`api/wwwroot`), with the API
base already being the same origin so the variable can be omitted or set to `/`.
Trade-off: the runtime variable is untyped (`(window as any).__API_BASE__`), and
missing the script file silently falls back to `localhost:5180` in prod. Mitigation:
a startup check (or the `api-base.js` always present) and a type-safe wrapper
function that throws if the variable is absent in a prod build.
