# ADV — C# Language + .NET Runtime Mastery

> Cross-links: [[M2-aspnetcore-backend]] (the host, DI container, minimal-API pipeline) · [[M4-data-modeling-efcore]] (EF Core, query filters, translation).
>
> Scope: the C# language and .NET runtime features that actually carry the HFC demo — `async`/`await`, LINQ/`IQueryable`, records, nullable reference types, pattern matching, generics, DI lifetimes, minimal-API binding, GC/`IDisposable`. Every claim is grounded in real demo code (`file:line`) or explicitly labeled **role knowledge (not in demo)**.
>
> Target: net9.0 (`api/obj/.../net9.0`), nullable reference types ON, implicit usings ON.

---

## 0. The 30-second framing for the panel

> "C# here isn't trivia — it's the thing that keeps the tenancy seam honest and the SQL fast. The handlers are all `async` EF calls that I never block on. The query filter and the rollup live or die on `IQueryable` translating to SQL versus an accidental client-eval. The DTOs are records so the wire contract is immutable. Nullable reference types make the optional-claim and optional-DTO cases compiler-visible. And DI lifetimes are load-bearing: `TenantContext` is **scoped** so each request gets its own tenant, while the read model is a **singleton** baked once at boot — and I had to be deliberate about not capturing a scoped service inside it."

---

## 1. async / await / Task — and why I never block

### Mental model
`async`/`await` is **cooperative, single-machine concurrency for I/O**, not parallelism. When a handler hits `await db.SaveChangesAsync()`, the method returns its thread to the pool while the DB round-trips. The continuation (everything after the `await`) is scheduled to resume when the `Task` completes. A `Task<T>` is a *promise* of a future value; `await` unwraps it without blocking. The payoff is **throughput**: a server thread isn't parked on a socket, so the same thread pool serves far more concurrent requests.

### Real demo code
Every booking handler is `async` end-to-end and awaits the EF call:

```csharp
// api/Endpoints/BookingEndpoints.cs:38-59
app.MapPost("/api/appointments", async (BookRequest req, AppDb db, TenantContext t) =>
{
    var slot = await db.Slots.FirstOrDefaultAsync(s => s.Id == req.SlotId);
    ...
    db.Appointments.Add(appt);
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateConcurrencyException) { return Results.Conflict(...); }
```

The read handlers await materialization (`ToListAsync`):

```csharp
// api/Endpoints/BookingEndpoints.cs:17-21
var slots = await db.Slots
    .Join(db.Territories, s => s.TerritoryId, te => te.Id, (s, te) => new { s, te })
    .Select(x => new SlotDto(...))
    .ToListAsync();
```

The async chain even reaches the AI intake call, propagating a `CancellationToken` the whole way:

```csharp
// api/Intake.cs:94 / 114 / 185
public async Task<IntakeDraft> ParseAsync(string text, string? brandId, CancellationToken ct)
...
return await ExtractWithClaudeAsync(text, services, apiKey!, cts.Token);
...
var message = await client.Messages.Create(parameters, cancellationToken: ct);
```

And `Intake.cs:112-114` shows the right way to bound a slow dependency — a **linked CancellationTokenSource with a timeout**, not a blocking wait:

```csharp
using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
cts.CancelAfter(TimeoutMs);                 // latency cap
return await ExtractWithClaudeAsync(text, services, apiKey!, cts.Token);
```

### HFC tie-in
The whole API is I/O-bound (Azure SQL round-trips, a Stripe/Twilio/Anthropic call). Async is what lets one App Service instance hold many concurrent bookings and dashboard reads without exhausting the thread pool. The booking POST is the hot path: it's `async` so a slow DB write parks the I/O, not the thread.

### Trade-offs
- Async has a small per-call state-machine allocation overhead. For genuinely synchronous, CPU-trivial work (e.g. the in-memory `Rollup.Recompute` passes) staying synchronous is correct — and the demo does exactly that.
- `async void` is forbidden except for event handlers — exceptions escape to the synchronization context and crash the process. Always `async Task`.

### Failure mode — sync-over-async deadlock
Calling `.Result` or `.Wait()` on a `Task` blocks the current thread **while** the awaited continuation tries to resume on that same captured context — classic deadlock (most acute under a SynchronizationContext like legacy ASP.NET / WPF). ASP.NET Core has no request SynchronizationContext, so a hard deadlock is less likely, but `.Result` still **blocks a pool thread**, and under load that cascades into thread-pool starvation (every thread parked on a `.Result` waiting for a continuation that needs a free thread). The demo never does this — it `await`s everywhere. The fix is always "async all the way down."

### `ConfigureAwait(false)` — role knowledge (not in demo)
`ConfigureAwait(false)` tells the continuation it doesn't need to resume on the captured context. It matters most in **library** code that might run under a context (avoids the deadlock above and skips a context hop). In ASP.NET Core app code there's no request context to capture, so it's largely a no-op for correctness — I don't litter handlers with it. I'd add it in a reusable library targeting mixed hosts. The demo handlers omit it correctly because they run only under the contextless ASP.NET Core host.

### Interview defense
- **Q: Does async make the request faster?** No — it makes the *server* more scalable. A single request takes the same wall-clock time; async frees the thread during the wait so other requests proceed. Latency is unchanged; throughput and resilience under load improve.
- **Q: You're in a library and must call async code from a sync method. How?** Ideally don't — make the caller async. If truly forced, `Task.Run(() => FooAsync()).GetAwaiter().GetResult()` offloads to a pool thread to dodge the captured-context deadlock, but it still consumes a thread and is a code smell. I'd flag it for refactor.
- **Q: Why `CancellationToken` everywhere?** So a client disconnect or a timeout (`Intake.cs:113` `CancelAfter`) actually aborts the downstream work instead of orphaning a DB query or an HTTP call. It's cooperative — every `await` checks it.

### Demo proof
`grep -n "await" api/Endpoints/BookingEndpoints.cs` shows awaits on every EF call; `grep -rn "\.Result\|\.Wait()" api/` returns nothing — no sync-over-async anywhere.

---

## 2. LINQ — `IQueryable` vs `IEnumerable` (what becomes SQL)

### Mental model — the single most important EF distinction
- **`IQueryable<T>`** carries an *expression tree*. EF's provider translates that tree into SQL and runs it **in the database**. Filtering, sorting, projection, paging — all pushed to SQL Server.
- **`IEnumerable<T>`** is *already in memory*. LINQ over it runs LINQ-to-Objects **on the app server**, row by row, after the data is fetched.

The boundary is crossed by **materialization**: `ToList()`, `ToListAsync()`, `AsEnumerable()`, `foreach`, `First()`. Everything chained **before** materialization is SQL; everything **after** is in-memory C#. Get this wrong and you silently pull whole tables across the wire and filter in C# — "accidental client evaluation."

### Real demo code — a query that *fully* translates to SQL
The slots endpoint composes a join + order + projection on `IQueryable`, then materializes once with `ToListAsync()`:

```csharp
// api/Endpoints/BookingEndpoints.cs:17-21
var slots = await db.Slots
    .Join(db.Territories, s => s.TerritoryId, te => te.Id, (s, te) => new { s, te })
    .OrderBy(x => x.s.StartUtc)
    .Select(x => new SlotDto(x.s.Id, x.te.Id, x.te.Name, x.s.StartUtc, x.s.IsBooked))
    .ToListAsync();
```

This emits one `SELECT ... JOIN ... ORDER BY` — and crucially the **global query filter** (`AppDb.cs:47`, `WHERE FranchiseeId = @t`) is part of the same `IQueryable`, so it folds into that SQL. The `Select` projects to the `SlotDto` *in SQL*, so only the DTO columns come back, never whole entities.

### Real demo code — deliberate, documented client evaluation
`Rollup.Recompute` is the *opposite*: it pulls cross-tenant rows once, then does all the grouping/scoring in memory — and the comments say so:

```csharp
// api/Rollup.cs:73-90
var slots = db.Slots.IgnoreQueryFilters().AsNoTracking()
    .Where(s => terrIds.Contains(s.TerritoryId)).ToList();   // <-- materialize here
...
// "Pulled cross-tenant, grouped in memory by (territory, YYYYMM)."
var slotAgg = slots
    .GroupBy(s => (s.TerritoryId, Period: Pid(s.StartUtc)))   // in-memory: Pid() can't translate
    .ToDictionary(...);
```

`Pid(s.StartUtc)` (`Rollup.cs:334`, a C# helper) **cannot** be translated to SQL — which is exactly why the `.ToList()` comes first. This is a *correct, intentional* client-eval: the rollup is a batch job over a bounded set, run once at boot. The danger is doing this *by accident* in a request handler.

### HFC tie-in
The dashboard read model is built precisely so request-time handlers stay projection-only on `IQueryable` (`EfDashboardReadModel.cs:21` comment: "Request-time handlers stay projection-only (filter / sort / paginate / scope)"), while the heavy in-memory aggregation happens once at boot in `Rollup` / the read-model constructor. That's the BI read-model pattern: expensive client-eval is a one-time bake, hot reads are SQL-translatable projections.

### Trade-offs
- Push-down to SQL = less data over the wire, index usage, DB does the work. Almost always right for request-time reads.
- In-memory = full LINQ/C# expressiveness (call any method, use tuples), but you must have already narrowed the rowset. Fine for bounded batch jobs.

### Failure mode — accidental `IQueryable → IEnumerable`
The classic bug:
```csharp
// BAD (hypothetical): AsEnumerable() before the filter
var open = db.Slots.AsEnumerable().Where(s => !s.IsBooked).ToList();
// -> SELECT * FROM Slots (ALL rows, all tenants if no filter) pulled to memory, THEN filtered in C#.
```
Older EF Core would *silently* client-evaluate an untranslatable `Where`; EF Core 3.0+ **throws** for the top-level `Where`/`OrderBy` instead of silently degrading — but it will still happily client-evaluate the *final projection*, and calling `.ToList()`/`.AsEnumerable()` too early always reverts to LINQ-to-Objects. In a tenant-scoped app this is doubly dangerous: pulling the table to memory before the query filter applies could leak across tenants and tank performance. Defense: keep the query as `IQueryable` until the single `ToListAsync()`, and confirm via the generated SQL / logging.

### Interview defense
- **Q: How do you know a query ran in SQL vs memory?** It's `IQueryable<T>` and stays so until one `ToListAsync()` — and I'd verify with EF's logged SQL (`LogTo`) or the SQL Server profiler. If I see `SELECT *` with no `WHERE`, something materialized too early.
- **Q: Why does `Pid(s.StartUtc)` force memory in the rollup?** It's a custom C# method — EF can't translate an arbitrary method into SQL. That's why `Rollup.cs:73` materializes with `.ToList()` *before* grouping. Intentional, bounded, runs once.
- **Q: `IEnumerable` vs `IQueryable` as a method return type?** Returning `IQueryable` lets the caller compose more SQL (good for repositories that defer). Returning `IEnumerable`/`IReadOnlyList` signals "already materialized, in memory" — which is what the read model exposes (`EfDashboardReadModel.cs:44` `IReadOnlyList<TerritoryDim>`), because the data was baked at boot.

### Demo proof
`BookingEndpoints.cs:17-21` (translates) vs `Rollup.cs:73-90` (deliberate materialize-then-group). `EfDashboardReadModel.cs:77` `db.TerritoryPeriodSummaries.AsNoTracking().ToList()` — read model materializes once in its constructor.

---

## 3. Records & init-only — the DTOs

### Mental model
A positional `record` is a reference type with **value semantics**: compiler-generated constructor, `Equals`/`GetHashCode` by value, `ToString`, deconstruction, and a `with` expression for non-destructive copy. Properties are **init-only** (settable in an initializer, immutable thereafter). They're the ideal **DTO / wire-contract** type: immutable, comparable, terse.

### Real demo code
The entire API contract is records (`Domain.cs:175-191`), with the comment stating the intent — "never expose entities directly; keeps the contract stable":

```csharp
// api/Domain.cs:176-181
public record BrandDto(string Id, string Name, string Tagline);
public record SlotDto(int Id, int TerritoryId, string TerritoryName, DateTime StartUtc, bool IsBooked);
public record BookRequest(int SlotId, string CustomerName, string Service);
public record AppointmentDto(int Id, int TerritoryId, DateTime StartUtc, string CustomerName, string Service, int DepositCents, bool DepositPaid);
```

The `with` expression (non-destructive mutation of an immutable record) is used in the read model to clone the corporate rollup with request-specific fields:

```csharp
// api/Dashboard/EfDashboardReadModel.cs:62-68
return _corporate with
{
    PeriodId = periodId,
    TrailingWindowMonths = trailingWindow,
    BrandComparison = brands,
    DataNotes = notes,
};
```

Note the contrast: **entities** (`Brand`, `Slot`, `Appointment` in `Domain.cs:17-155`) are plain mutable classes with `get; set;` — because EF needs to materialize and track/mutate them (e.g. `slot.IsBooked = true; slot.Version++;` at `BookingEndpoints.cs:44-45`). **DTOs** are records because they're immutable snapshots. That split is deliberate.

### HFC tie-in
Records keep the OpenAPI contract honest: an `AppointmentDto` can't be mutated after construction, so a handler can't accidentally reshape a response mid-flight. The `with` on the rollup means each request gets its own immutable view scoped to its period/brand without re-aggregating — the baked corporate object stays untouched and shareable across requests (safe because it's immutable).

### Trade-offs
- Records give free value equality and immutability — great for DTOs, cache keys, and message contracts. The demo even uses a `record struct` for a hot value type: `private record struct Bench(double Gross, double Fill, double Nps);` (`Rollup.cs:358`) — a stack-allocated value type with value semantics for the benchmark tuple.
- Don't use records for EF entities you mutate/track — you want mutable classes there. The demo respects this exactly.

### Failure mode
`with` is a **shallow** copy. `EfDashboardReadModel.cs:62` is safe because it replaces the reference-type members (`BrandComparison`, `DataNotes`) with freshly built lists. If you `with`-copied and then mutated a *shared* referenced list, every copy would see it. Records protect the top level, not nested mutable state.

### Interview defense
- **Q: Why records for DTOs but classes for entities?** DTOs are immutable contracts (value equality, `with`); entities are mutated and tracked by EF (`slot.Version++`). Different jobs, different types.
- **Q: `record` vs `record struct`?** `record` is a reference type (heap, nullable, shared by reference); `record struct` is a value type (stack/inline, copied by value) — I use the struct form for small, short-lived value bags like `Bench` (`Rollup.cs:358`) to avoid heap allocation in a tight aggregation loop.
- **Q: Are init-only properties truly immutable?** The *property* can't be reassigned after construction. A mutable reference it holds (a `List<>`) can still be mutated — immutability is shallow.

### Demo proof
`Domain.cs:176-191` (record DTOs) vs `Domain.cs:17-155` (mutable class entities); `EfDashboardReadModel.cs:62` (`with`); `Rollup.cs:358` (`record struct`).

---

## 4. Nullable reference types (NRTs)

### Mental model
With `<Nullable>enable</Nullable>`, `string` means "non-null by contract" and `string?` means "may be null." The compiler does flow analysis and warns when you dereference a maybe-null without checking. It's **compile-time** discipline (warnings, not runtime enforcement) — it makes "can this be absent?" a visible, checked part of the type.

### Real demo code
The optionality is encoded right in the DTO. `DevTokenRequest` makes both fields optional because a caller sends *either* a franchisee selection *or* a corporate role:

```csharp
// api/Domain.cs:186-187
public record DevTokenRequest(string? FranchiseeId = null, string? Role = null);
public record DevTokenResponse(string Token, string? FranchiseeId, string? BrandId);
```

The handler then *must* handle the null cases — the `?` is what forces it:

```csharp
// api/Endpoints/CatalogEndpoints.cs:40 / 48
if (string.Equals(req.Role, HfcClaims.CorporateRole, StringComparison.OrdinalIgnoreCase)) { ... }
if (string.IsNullOrWhiteSpace(req.FranchiseeId))
    return Results.BadRequest("Provide either role=corporate or a franchiseeId.");
```

The tenancy seam is the canonical fail-closed null story: `TenantContext.FranchiseeId` is `string?` (`AppDb.cs:10`), and a missing claim leaves it null, which makes the query filter match nothing:

```csharp
// api/Auth.cs:62-66
public static void Populate(TenantContext tenant, ClaimsPrincipal? user)
{
    if (user?.Identity?.IsAuthenticated != true) return;   // null-safe: no identity → no tenant
    tenant.FranchiseeId = user.FindFirst(HfcClaims.FranchiseeId)?.Value;   // ?. propagates null
```

```csharp
// api/AppDb.cs:46  — null tenant compares against null column => zero rows (fail-closed)
b.Entity<Territory>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
```

The `DepositKey` field is `string?` because an unpaid appointment has none — and the handler pattern-matches on null:

```csharp
// api/Domain.cs:144 ; api/Endpoints/BookingEndpoints.cs:85
public string? DepositKey { get; set; }
if (appt.DepositKey is not null) { /* already paid */ }
```

The null-forgiving `!` operator appears once, deliberately, after a guard proves non-null: `apiKey!` at `Intake.cs:114` (the code already returned early if `apiKey` was null/blank at `Intake.cs:106`).

### HFC tie-in
NRTs make the *security-critical* "absent claim" case a typed, compiler-visible thing. `FranchiseeId` being `string?` and `?.Value` propagating null is the type system *enforcing fail-closed*: there's no path where a null tenant accidentally becomes a non-null query. The optional-DTO shape (`DevTokenRequest`) documents the two-mode login (operator vs corporate) in the contract itself.

### Trade-offs
- NRTs catch a whole class of `NullReferenceException` at compile time and document intent. Cost: discipline (no spraying `!` to silence warnings).
- They don't run at runtime — a JSON body deserialized from an untrusted client can still violate a non-null annotation. That's why the handler still *validates* (`CatalogEndpoints.cs:48`) rather than trusting the type.

### Failure mode
Suppressing with `!` to quiet a warning when the value really *can* be null reintroduces NREs and defeats the feature. The demo's single `apiKey!` is safe only because of the preceding guard — that's the correct discipline, not a workaround.

### Interview defense
- **Q: Do NRTs prevent null at runtime?** No — they're compile-time flow analysis. A deserialized request can still arrive null, so I validate at the edge (`CatalogEndpoints.cs:48`) in addition to annotating.
- **Q: When is `!` acceptable?** Only when you've *proven* non-null the compiler can't see — like `apiKey!` after an early-return guard (`Intake.cs:106/114`). Never to silence a genuine maybe-null.
- **Q: Why is `string?` on `FranchiseeId` a security feature?** Because the absence of a tenant is a real, expected state (unauthenticated / corporate principal), and the type forces every consumer to handle it — and the query filter turns null into zero rows. Fail-closed by type.

### Demo proof
`Domain.cs:186` (`string?` DTO), `AppDb.cs:10/46` (nullable tenant → fail-closed filter), `Auth.cs:62-66` (`?.` null-safe claim read), `Intake.cs:114` (justified `!`).

---

## 5. Pattern matching & switch expressions

### Mental model
Pattern matching tests a value's shape/type/value and binds in one expression. The `switch` *expression* (arms `=>`, exhaustive, returns a value) replaces verbose `if/else` chains and is great for pure mappings.

### Real demo code
The tenure-factor lookup is a textbook switch expression:

```csharp
// api/Rollup.cs:35-41
private static double TenureFactor(string band) => band switch
{
    "launch"      => 0.55,
    "ramping"     => 0.78,
    "established" => 0.95,
    _             => 1.00, // mature  (discard pattern = default)
};
```

`is`-patterns for null/type checks appear throughout:

```csharp
// api/Endpoints/BookingEndpoints.cs:41 / 85
if (slot is null) return Results.NotFound();
if (appt.DepositKey is not null) { ... }      // not-null pattern
```

A type/`is int` pattern with capture in the read model:

```csharp
// api/Dashboard/EfDashboardReadModel.cs:97
var region = t.RegionId is int rid ? regionById.GetValueOrDefault(rid) : null;  // unwrap int? to int rid
```

And `is not null` guarding a nullable-double in the score combiner:

```csharp
// api/Rollup.cs:327
if (fin is not null) { acc += WFinancial * fin.Value; wsum += WFinancial; }
```

The ternary mapping for score status is pattern-flavored conditional logic:

```csharp
// api/Rollup.cs:196-197
string status = !x.Reported ? "pending_financial_reporting"
              : financial == null ? "partial" : "complete";
```

### HFC tie-in
The score/status mappings (`TenureFactor`, `RefreshStatus` at `Rollup.cs:237`) are exactly where switch/conditional patterns shine: pure, exhaustive, explainable business rules. `is int rid` cleanly unwraps the nullable `RegionId` (a territory not in the dashboard set has `RegionId == null`).

### Trade-offs
- Switch expressions are exhaustive and side-effect-free — ideal for mapping. The `_` discard arm guarantees totality.
- For multi-statement branches with side effects (the watchlist flag building, `Rollup.cs:261-301`) the demo correctly uses `if` statements, not switch arms.

### Failure mode
A non-exhaustive switch *expression* with no `_` arm throws `SwitchExpressionException` at runtime on an unmatched value. `Rollup.cs:40` includes `_ => 1.00`, so an unknown band degrades to "mature" instead of throwing.

### Interview defense
- **Q: switch expression vs switch statement?** Expression returns a value, is exhaustive, no fall-through, no `break` — best for mappings (`TenureFactor`). Statement is for control flow with side effects.
- **Q: `is null` vs `== null`?** `is null` always uses the real null check and can't be hijacked by an overloaded `==` operator — safer and the demo's default (`BookingEndpoints.cs:41`).
- **Q: What's `is int rid` doing at `EfDashboardReadModel.cs:97`?** It tests that the `int?` `RegionId` has a value *and* binds the unwrapped `int` to `rid` in one step — no separate `.HasValue`/`.Value`.

### Demo proof
`Rollup.cs:35-41` (switch expr), `BookingEndpoints.cs:41/85` (`is null` / `is not null`), `EfDashboardReadModel.cs:97` (`is int rid`).

---

## 6. Generics

### Mental model
Generics give type-safe reuse without boxing or `object`. The framework is generics-soaked: `Task<T>`, `List<T>`, `Dictionary<K,V>`, `DbSet<TEntity>`, `IReadOnlyList<T>`, `IEnumerable<T>`. They preserve type identity through the call chain (so `await ...ToListAsync()` yields a `List<SlotDto>`, not `object`).

### Real demo code
The `DbContext` exposes strongly-typed `DbSet<T>` per entity:

```csharp
// api/AppDb.cs:20-25
public DbSet<Brand> Brands => Set<Brand>();
public DbSet<Slot> Slots => Set<Slot>();
public DbSet<Appointment> Appointments => Set<Appointment>();
```

DI registration is generic, carrying the concrete type into the container:

```csharp
// api/Program.cs:11-12 / 28
builder.Services.AddScoped<TenantContext>();
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(conn));
builder.Services.AddSingleton<IDashboardReadModel, EfDashboardReadModel>();   // <interface, impl>
```

Generic collections drive the rollup aggregation, keyed by a value tuple:

```csharp
// api/Rollup.cs:80-84
.ToDictionary(g => g.Key, g => (Total: g.Count(), Booked: g.Count(s => s.IsBooked), AsOf: g.Max(s => s.StartUtc)));
// api/Dashboard/EfDashboardReadModel.cs:44
public IReadOnlyList<TerritoryDim> Territories => _dims;   // generic read-only view
```

`GetRequiredService<T>()` (`Program.cs:50`, `EfDashboardReadModel.cs:74`) is a generic service-locator method returning the concrete `T`.

### HFC tie-in
`AddSingleton<IDashboardReadModel, EfDashboardReadModel>()` is the **swap seam** in one generic line: the contract (`IDashboardReadModel`) stays fixed while the implementation (EF vs stub) varies — generics make that substitution type-safe. The comment at `Program.cs:24-28` even calls out flipping it back to the stub by changing this one line.

### Trade-offs
- Generics = compile-time type safety + no boxing for value types (the value-tuple dictionaries in `Rollup` stay allocation-lean for the keys).
- Generic constraints (`where T : ...`) aren't needed in this demo's code — **role knowledge (not in demo)**: I'd reach for them when writing a generic repository or a constrained helper (`where T : class, IEntity`).

### Interview defense
- **Q: Why `DbSet<Brand>` instead of a non-generic set?** Type safety end-to-end: queries, projections, and tracking are all typed to `Brand`, so the compiler catches a wrong property at build time.
- **Q: What does the generic in `AddSingleton<IDashboardReadModel, EfDashboardReadModel>` buy you?** The container resolves the interface to the concrete type; consumers depend only on the abstraction, so I swap implementations without touching call sites — and it's type-checked.

### Demo proof
`AppDb.cs:20-25`, `Program.cs:11/12/28`, `EfDashboardReadModel.cs:44`.

---

## 7. DI lifetimes — scoped vs singleton, and the captive-dependency trap

### Mental model
Three lifetimes:
- **Transient** — new instance every resolution.
- **Scoped** — one instance per request scope (in ASP.NET Core, per HTTP request).
- **Singleton** — one instance for the app lifetime.

The **captive dependency** pitfall: a *singleton* that captures a *scoped* (or transient) service freezes the first instance forever, breaking per-request semantics — and for a tenant-scoped service, that's a **cross-tenant data leak**.

### Real demo code
`TenantContext` and the dashboard scope holder are **scoped** — one per request, so each request gets its own tenant:

```csharp
// api/Program.cs:11 / 29
builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<DashboardScopeHolder>();
```

`AppDb` is registered via `AddDbContext` (`Program.cs:12`), which is **scoped by default** — and it *constructor-injects the scoped `TenantContext`*:

```csharp
// api/AppDb.cs:17-18
public AppDb(DbContextOptions<AppDb> options, TenantContext tenant) : base(options)
    => _tenant = tenant;
```

Both are scoped, so this is **safe**: each request's `AppDb` gets that request's `TenantContext`, and the query filter (`AppDb.cs:46`) keys on the correct per-request tenant.

The read model and intake service are **singletons**:

```csharp
// api/Program.cs:20 / 28
builder.Services.AddSingleton<IntakeService>();
builder.Services.AddSingleton<IDashboardReadModel, EfDashboardReadModel>();
```

### The captive-dependency avoidance — the key insight
`EfDashboardReadModel` is a singleton but needs the (scoped) `AppDb` to read at boot. It **must not** constructor-inject `AppDb` directly — that would capture a scoped DbContext in a singleton (captive dependency: a disposed/stale, wrong-tenant context reused forever). Instead it injects `IServiceScopeFactory` and **opens its own scope** to resolve `AppDb` transiently for the bake:

```csharp
// api/Dashboard/EfDashboardReadModel.cs:71-78
public EfDashboardReadModel(IServiceScopeFactory scopeFactory)
{
    using var scope = scopeFactory.CreateScope();          // own scope, disposed after the bake
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    var summaries = db.TerritoryPeriodSummaries.AsNoTracking().ToList();
    var flags = db.WatchlistFlags.AsNoTracking().ToList();
    ...
}
```

This is the **correct** pattern: a singleton that needs a scoped service creates a transient scope rather than capturing one. And it's safe to read tenant-scoped tables here only because the corporate read model tables have **no** query filter (`AppDb.cs:84-91`) and dimensions use `IgnoreQueryFilters()` (`EfDashboardReadModel.cs:85`) — the sanctioned cross-tenant read.

### HFC tie-in
This is the literal tenancy-safety lever. If `TenantContext` were a singleton, the *first* request's tenant would be frozen and every later request would query as that franchisee — a total isolation breach. Scoped is non-negotiable here. The booking startup seed scope (`Program.cs:48`) is the mirror image: the host has no request scope at boot, so it manually creates one.

### Failure mode — captive dependency
```csharp
// BAD (hypothetical): singleton capturing scoped TenantContext
builder.Services.AddSingleton<SomeCache>();   // SomeCache ctor takes TenantContext
// -> first request's TenantContext is frozen into the singleton forever => every
//    tenant sees the first tenant's data. Cross-tenant leak.
```
.NET's `ValidateScopes` (on by default in Development) throws at resolution if a singleton directly depends on a scoped service — that's the runtime guardrail. The demo sidesteps it correctly with `IServiceScopeFactory`.

### Interview defense
- **Q: Why is `TenantContext` scoped and not singleton?** It holds the *current request's* tenant. Singleton would freeze one tenant for the whole app — a cross-tenant leak. Scoped guarantees one tenant per request.
- **Q: How does a singleton read the scoped DbContext safely?** It injects `IServiceScopeFactory`, calls `CreateScope()`, resolves `AppDb` inside a `using` scope, and disposes it — never captures the scoped instance. That's `EfDashboardReadModel.cs:71-78`.
- **Q: Why is `AddDbContext` scoped by default?** A DbContext is a unit-of-work / change-tracker for one logical operation; it's not thread-safe and shouldn't be shared across requests. Scoped = one per request.

### Demo proof
`Program.cs:11/12/29` (scoped), `Program.cs:20/28` (singleton), `AppDb.cs:17` (scoped ctor injection), `EfDashboardReadModel.cs:71-78` (scope factory — captive-dependency avoidance).

---

## 8. Minimal-API parameter binding

### Mental model
Minimal APIs bind handler parameters by **source inference**: route values by name, `[FromBody]` for the (single) complex JSON type, services from DI, and special types (`HttpRequest`, `HttpContext`, `CancellationToken`) directly. No controllers, no attributes needed for the common cases.

### Real demo code — every binding source in one handler
```csharp
// api/Endpoints/BookingEndpoints.cs:76-79
app.MapPost("/api/appointments/{id:int}/deposit",
    async (int id, DepositRequest req, HttpRequest http, AppDb db) =>
{
```
- `int id` ← **route** (matched to `{id:int}`, and `:int` is a route constraint that 404s a non-int before the handler runs).
- `DepositRequest req` ← **JSON body** (the one complex type is inferred from body).
- `HttpRequest http` ← the request object (used at line 79 to read the `Idempotency-Key` **header** manually).
- `AppDb db` ← **DI** (scoped DbContext).

The booking POST adds a DI'd `TenantContext t` (`BookingEndpoints.cs:38`); the dev-token POST binds the body `DevTokenRequest req` plus `AppDb db` (`CatalogEndpoints.cs:35`).

Auth metadata is chained fluently onto the route: `.RequireAuthorization()` (`BookingEndpoints.cs:23`), `.AllowAnonymous()` (`CatalogEndpoints.cs:19`), and policy-gating elsewhere via `.RequireAuthorization(HfcPolicies.Corporate)`.

### HFC tie-in
The endpoints are organized as module extension methods (`MapBooking`, `MapCatalog` at `Program.cs:91-96`) so binding + auth live next to each handler. The route constraint `{id:int}` is a free input-validation layer (a malformed id never reaches the DB). Header binding for `Idempotency-Key` (`BookingEndpoints.cs:79`) is manual because idempotency is a protocol concern, not a typed body field.

### Trade-offs
- Inference is terse and fast, but ambiguous sources need explicit attributes (`[FromQuery]`, `[FromHeader]`) — **role knowledge (not in demo)**: the demo reads the header off `HttpRequest` directly rather than `[FromHeader]`, which is equally valid and keeps the "missing key" branch explicit.
- Minimal APIs have less built-in model-validation than MVC; the demo validates manually at the edge (`BookingEndpoints.cs:79`, `CatalogEndpoints.cs:48`).

### Interview defense
- **Q: How does it know `DepositRequest` is the body and `id` is the route?** Route value `id` matches the `{id}` template; the single complex/unbound type binds from the JSON body by convention. Services come from DI.
- **Q: Why read `Idempotency-Key` off `HttpRequest` instead of a parameter?** It's an optional protocol header with a specific 400 path when missing (`BookingEndpoints.cs:79-80`); reading it explicitly keeps that control flow obvious. `[FromHeader] string? key` would also work.
- **Q: What does `{id:int}` give you?** A route constraint — non-integer ids fail to match and return 404 before any handler/DB work. Cheap, early validation.

### Demo proof
`BookingEndpoints.cs:76-79` (route + body + HttpRequest + DI in one signature), `Program.cs:91-96` (module composition).

---

## 9. GC / memory basics + `IDisposable` / `using`

### Mental model
.NET is **garbage-collected**: managed heap objects are reclaimed automatically by a generational, mark-and-compact GC (Gen0/1/2; large objects on the LOH). You don't free memory manually — but you **do** deterministically release *unmanaged / scope-bound* resources (DB connections, sockets, DI scopes, `CancellationTokenSource`) via `IDisposable` + `using`. `using` guarantees `Dispose()` runs on scope exit, even on exception.

### Real demo code — the seed scope
The startup block manually creates a DI scope to run the seed/rollup (there's no request scope at boot), and `using` disposes it deterministically:

```csharp
// api/Program.cs:48-55
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    Seed.Run(db);
    Rollup.Recompute(db);
}   // scope disposed here -> the scoped AppDb (and its DB connection) released
```

The read-model bake uses the `using var` form (disposed at end of the constructor):

```csharp
// api/Dashboard/EfDashboardReadModel.cs:73
using var scope = scopeFactory.CreateScope();
```

And the intake timeout `CancellationTokenSource` is `using`-scoped so its timer is released:

```csharp
// api/Intake.cs:112
using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
```

### HFC tie-in
The seed scope is essential: `AppDb` is **scoped**, so resolving it at boot *requires* an explicit scope — `app.Services` (the root provider) can't hand out a scoped service directly, and would leak it if it could. `using` ensures the boot-time DbContext and its connection are torn down before the app starts serving, so we don't carry a stray connection into the request lifecycle. The per-request `AppDb` is disposed automatically by the framework at end of request — we don't hand-dispose it.

### Trade-offs
- GC removes manual memory bugs (use-after-free, double-free) at the cost of non-deterministic collection timing. For *memory*, trust the GC. For *resources* (connections, handles, timers), be deterministic with `using`.
- `AsNoTracking()` (`Rollup.cs:53`, `EfDashboardReadModel.cs:77`) is a memory/perf lever: read-only queries skip the change tracker, so EF doesn't retain entity snapshots — less Gen0 pressure on big reads.

### Failure mode
Not disposing a scoped DbContext / scope leaks its DB connection back-pressure on the pool. Resolving a scoped service from the **root** provider (instead of a created scope) either throws (scope validation) or silently makes it a de-facto singleton — which for `AppDb`+`TenantContext` would be a tenancy hazard. The `using (var scope = app.Services.CreateScope())` pattern (`Program.cs:48`) is precisely the sanctioned way.

### Interview defense
- **Q: Do you ever call `GC.Collect()`?** Almost never — it's a code smell that usually hurts (forces a full collection, hurts throughput). I let the GC do its job and instead reduce allocations (`AsNoTracking`, `record struct Bench`) and dispose resources deterministically.
- **Q: Why `using` around the seed scope?** `AppDb` is scoped; at boot there's no request scope, so I create one, use it, and dispose it so the DbContext + connection are released before serving. `using` makes that exception-safe.
- **Q: `IDisposable` vs `IAsyncDisposable`?** For async resources (an async DB connection) `await using` runs `DisposeAsync` so cleanup itself doesn't block. **Role knowledge (not in demo)** — the demo's `using` scopes are synchronous-dispose-safe.

### Demo proof
`Program.cs:48-55` (seed scope, `using`), `EfDashboardReadModel.cs:73` (`using var` scope), `Intake.cs:112` (`using var cts`), `Rollup.cs:53` / `EfDashboardReadModel.cs:77` (`AsNoTracking` allocation lever).

---

## Flashcards

1. **Q:** In `BookingEndpoints.cs`, what makes the slots query run as SQL and not in memory?
   **A:** It stays `IQueryable` through `Join`/`OrderBy`/`Select` and only materializes at the single `ToListAsync()` (`BookingEndpoints.cs:21`). Everything before that — including the global query filter — folds into one `SELECT ... JOIN ... ORDER BY`.

2. **Q:** Why does `Rollup.cs:73` call `.ToList()` *before* the `GroupBy`?
   **A:** Because the grouping key uses `Pid(s.StartUtc)`, a custom C# method EF can't translate to SQL. Materializing first makes it a deliberate, bounded in-memory aggregation (batch job at boot).

3. **Q:** `TenantContext` lifetime, and what breaks if it were singleton?
   **A:** Scoped (`Program.cs:11`). As a singleton the first request's tenant would freeze for the app's life — every later request queries as that franchisee. Cross-tenant leak.

4. **Q:** How does the singleton `EfDashboardReadModel` read the scoped `AppDb` without a captive dependency?
   **A:** It injects `IServiceScopeFactory`, opens `using var scope = scopeFactory.CreateScope()`, resolves `AppDb` inside it, and disposes the scope (`EfDashboardReadModel.cs:71-78`).

5. **Q:** Why are DTOs `record` but entities `class` in `Domain.cs`?
   **A:** DTOs are immutable wire contracts (value equality, `with`); entities are mutated and change-tracked by EF (`slot.IsBooked = true; slot.Version++`). Different jobs.

6. **Q:** What does `string?` on `DevTokenRequest.FranchiseeId` (`Domain.cs:186`) force the handler to do?
   **A:** Handle the null case — `CatalogEndpoints.cs:48` `IsNullOrWhiteSpace` returns 400 when neither role nor franchiseeId is supplied. NRTs make the optionality compiler-visible.

7. **Q:** Why is a null `TenantContext.FranchiseeId` fail-closed?
   **A:** The query filter `x.FranchiseeId == _tenant.FranchiseeId` (`AppDb.cs:46`) compares a column to null → matches zero rows. No tenant → no data, never cross-tenant.

8. **Q:** What does `t.RegionId is int rid` do at `EfDashboardReadModel.cs:97`?
   **A:** Tests the `int?` has a value *and* binds the unwrapped `int` to `rid` in one pattern — no `.HasValue`/`.Value`.

9. **Q:** What's the deadlock risk in sync-over-async, and where does the demo avoid it?
   **A:** `.Result`/`.Wait()` block a thread waiting on a continuation that may need that thread (and deadlock under a captured context); under load → thread-pool starvation. The demo `await`s everywhere — `grep` for `.Result`/`.Wait()` finds nothing.

10. **Q:** Why `using` around the seed scope (`Program.cs:48`)?
    **A:** `AppDb` is scoped; at boot there's no request scope, so we create one to resolve it, and `using` disposes the DbContext + connection deterministically before serving.

11. **Q:** What is `record struct Bench` (`Rollup.cs:358`) and why a struct?
    **A:** A value type with record value semantics. Struct avoids a heap allocation for the small, short-lived benchmark tuple used inside the hot aggregation loop.

12. **Q:** When is the `!` null-forgiving operator acceptable, per the demo?
    **A:** Only after a guard proves non-null — `apiKey!` at `Intake.cs:114` is safe because `Intake.cs:106` already returned early on a null/blank key. Never to silence a real maybe-null.

---

## Mock Q&A

**Q1.** "Walk me through what SQL the slots endpoint generates, and how the tenant filter gets in there."
**A.** `BookingEndpoints.cs:17-21` composes `Slots.Join(Territories...).OrderBy(...).Select(SlotDto)` on `IQueryable`, materialized once at `ToListAsync()`. Because it's all one expression tree, EF translates a single `SELECT ... JOIN Territories ... ORDER BY StartUtc` projecting just the DTO columns. The global query filter from `AppDb.cs:47` (`WHERE Slots.FranchiseeId = @tenant`) is appended automatically — it's part of the same `IQueryable`, so isolation happens in SQL, not in C#.
> **Follow-up:** "What if I added `.AsEnumerable()` right after `db.Slots`?" — Then the rest runs in memory: EF would emit `SELECT * FROM Slots` (with the filter, but no join/projection push-down), pull every column to the app, and do the join/order/project in LINQ-to-Objects. Wasteful, and exactly the accidental client-eval trap. I'd catch it in the logged SQL.
> **Follow-up:** "How would you confirm in prod it's one query, not N+1?" — EF `LogTo`/`EnableSensitiveDataLogging` in non-prod, or Application Insights dependency tracking / SQL profiler in prod. The join is explicit here so there's no lazy-load N+1.

**Q2.** "Your dashboard read model is a singleton but reads the database. Isn't that a captive dependency?"
**A.** It would be if I constructor-injected the scoped `AppDb` — that captures a per-request DbContext into an app-lifetime object, which is stale, possibly disposed, and (if it carried a tenant) a cross-tenant leak; .NET's scope validation would even throw in Development. Instead `EfDashboardReadModel.cs:71-78` injects `IServiceScopeFactory`, opens `using var scope = scopeFactory.CreateScope()`, resolves `AppDb` inside that scope, reads, and disposes the scope. The DbContext lives only for the bake.
> **Follow-up:** "Why singleton at all?" — The corporate rollup is expensive to compute and immutable once baked; computing it once at boot and serving every request from memory is the BI read-model pattern (`EfDashboardReadModel.cs:21`). Request handlers stay projection-only.
> **Follow-up:** "What if the data changes after boot?" — The demo's cadence is one boot/on-demand rebuild (`Rollup.cs` header). In prod I'd rebuild on a Durable Functions timer / Service Bus event and swap the singleton (or move to a cache with invalidation) — see [[M8-azure-durable]].

**Q3.** "Why is `TenantContext` scoped, and what's the blast radius if someone changes it to singleton?"
**A.** Scoped means one instance per HTTP request (`Program.cs:11`), populated from the verified token claim by the tenancy seam (`Auth.cs:62`). `AppDb` injects it (`AppDb.cs:17`) and the query filter keys on it (`AppDb.cs:46`). If it became a singleton, the *first* request to hit the app would freeze its `FranchiseeId` into the shared instance, and every subsequent request — regardless of who's logged in — would query as that first franchisee. Total tenant-isolation failure, and it would pass a single-user smoke test silently.
> **Follow-up:** "How would a test catch this?" — A multi-tenant integration test: log in as franchisee A, create data, log in as B, assert B sees none of A's rows. With a singleton TenantContext, B would see A's data and the test fails. (`WebApplicationFactory`, enabled by `public partial class Program` at `Program.cs:104`.)
> **Follow-up:** "Why isn't `AddDbContext` registered as singleton for performance?" — A DbContext is a unit-of-work with a change tracker; it's not thread-safe and accumulates tracked state. Sharing it across requests corrupts tracking and isn't safe. Scoped per request is the contract.

**Q4.** "Records vs classes — show me where you used each and why it matters here."
**A.** DTOs are records (`Domain.cs:176-191`) — immutable wire contracts with value equality, so a response can't be reshaped after construction and the OpenAPI contract stays stable. Entities are mutable classes (`Domain.cs:17-155`) because EF materializes and mutates them — the booking handler does `slot.IsBooked = true; slot.Version++` (`BookingEndpoints.cs:44-45`), which an init-only record would forbid. I also used `record struct Bench` (`Rollup.cs:358`) for a small hot-loop value tuple to avoid heap allocation, and the `with` expression (`EfDashboardReadModel.cs:62`) to clone the immutable rollup per request without re-aggregating.
> **Follow-up:** "Is `with` safe if the record holds a `List`?" — `with` is a shallow copy. It's safe at `EfDashboardReadModel.cs:62` because I replace the list members with freshly built lists, not share-and-mutate. If I mutated a shared referenced list, all copies would see it.
> **Follow-up:** "Could you make the entities records with init + always-new copies?" — Technically, but you'd fight EF's change tracker (it needs to mutate tracked instances). Wrong tool; the demo keeps entities mutable on purpose.

**Q5.** "Where does async actually buy you something here, and where could it bite you?"
**A.** It buys throughput on every I/O hop: the booking POST awaits `SaveChangesAsync` (`BookingEndpoints.cs:59`), the reads await `ToListAsync`, and the AI intake awaits the HTTP call (`Intake.cs:185`) with a linked-token timeout (`Intake.cs:112-113`). Each `await` returns the thread to the pool during the wait, so one App Service instance serves many concurrent requests. It bites if you block on it — `.Result`/`.Wait()` parks a pool thread on a continuation, and under load that's thread-pool starvation; the demo avoids it entirely (no `.Result`/`.Wait()` anywhere).
> **Follow-up:** "ConfigureAwait(false) — why not in the handlers?" — ASP.NET Core has no request SynchronizationContext, so there's no context to capture; `ConfigureAwait(false)` is a near-no-op in app handlers. I'd use it in a reusable library that might run under a context, to avoid the deadlock and skip the hop. **(Role knowledge — not in the demo.)**
> **Follow-up:** "The intake call is slow and flaky — defend the design." — Linked `CancellationTokenSource` with `CancelAfter(TimeoutMs)` (`Intake.cs:112-113`) bounds latency; `OperationCanceledException`/`Exception` fall back to a local heuristic (`Intake.cs:116-125`) so a degraded AI never blocks a booking. Async + cancellation + graceful fallback — see [[M10-reliability-integrations]].

---

### Summary
Grounded a C#/.NET mastery doc entirely in the hfc-demo: async/await EF handlers (no sync-over-async), `IQueryable→SQL` vs deliberate in-memory rollup, record DTOs vs mutable entities, nullable fail-closed tenancy, pattern matching, generics, scoped-vs-singleton DI with the `IServiceScopeFactory` captive-dependency fix, minimal-API binding, and `using`-scoped resources — each with real `file:line` proof, failure modes, and interview follow-ups.
