# M4 — Data Modeling with SQL Server + EF Core

> Mastery doc for the HFC Senior Full Stack Cloud Developer interview.
> Every snippet below is quoted from the real `hfc-demo` source with `file:line`. Nothing here is invented.
> Cross-links: [[M1-multitenancy]] (the query filter as a *security* boundary) · [[M7-bi-readmodels]] (the corporate roll-up plane).

---

## 1. Mental model

HFC is a multi-brand home-services franchisor. The data model has to express **two planes at once**:

1. **The operational plane** — what a single franchisee owns and books: `Territory`, `Slot`, `Appointment`, `NpsSurvey`, `MonthlyReport`. Every row carries a `FranchiseeId` and is fenced behind a global query filter so one tenant can never read another's rows.
2. **The corporate read plane** — what the franchisor CEO sees: `TerritoryPeriodSummary`, `WatchlistFlag`. Pre-aggregated, wide, **deliberately un-filtered**, denormalized for fast slicing.

The data-modeling decisions are all in service of three jobs:

- **Express the hierarchy** `Brand → Region → Territory → Franchisee` so the dashboard can roll up and drill down.
- **Make tenancy a modeling concern, not an app concern** — the `HasQueryFilter` lives in the model, so every query is fenced by default.
- **Make the hot paths cheap** — unique indexes that enforce invariants at the DB, composite indexes that serve the dashboard `GROUP BY`s, and denormalized `BrandId`/`RegionId` so reads don't join.

Picture two boxes. The left box (operational) is many small, tenant-fenced tables that change constantly. The right box (corporate) is one wide table per (territory, period) that is rewritten by a batch roll-up. The only door between them is `RecomputeRollup`, which reads left cross-tenant (`IgnoreQueryFilters`) and writes right.

---

## 2. The hierarchy: Brand → Region → Territory → Franchisee

### Two axes, one of which is a boundary

The single most important modeling idea in HFC is stated in the domain header:

```csharp
// Two-axis tenancy. FranchiseeId is the ISOLATION key — the boundary a request
// can never cross (a Budget Blinds owner in Irvine must not see Budget Blinds
// Tustin). BrandId is the GROUPING — it bundles franchisees under a brand for
// corporate aggregates, but it is NOT the security boundary.
```
— `api/Domain.cs:6`

- **`FranchiseeId`** is the isolation key. It is the tenant boundary. (Detail in [[M1-multitenancy]].)
- **`BrandId`** is a grouping axis. It bundles franchisees for corporate aggregates but is **never** a security fence.

Confusing these is the classic multi-tenant bug: if you filtered by brand you'd leak Irvine's data to Tustin (same brand). The model encodes the distinction explicitly.

### The entities

| Entity | Role | Tenant-scoped? | Key |
|---|---|---|---|
| `Brand` | catalog/grouping | no | slug `Id` (PK), `Num` (numeric bridge) |
| `Region` | geographic grouping of territories | no | `int Id` |
| `Territory` | operational, in a region, owned by a franchisee | **yes** (`FranchiseeId`) | `int Id` |
| `Franchisee` | the tenancy boundary itself (data *controller*) | no (catalog) | slug `Id` |
| `Slot` | bookable time, carries concurrency token | **yes** | `int Id` |
| `Appointment` | a booked slot | **yes** | `int Id` |
| `NpsSurvey` | post-service survey | **yes** | `int Id` |

`Brand` carries a numeric bridge because the operational world keys on slugs but the corporate read model keys on integers:

```csharp
public string Id { get; set; } = "";   // slug, e.g. "budget-blinds" — PK
...
public int Num { get; set; }
```
— `api/Domain.cs:19` and `api/Domain.cs:27`

`Territory` is where the hierarchy converges — it carries both axes plus the region link and the geo coords the dashboard map clusters by:

```csharp
public int Id { get; set; }
public string FranchiseeId { get; set; } = "";   // isolation key
public string BrandId { get; set; } = "";        // grouping (denormalized)
...
public int? RegionId { get; set; }           // null = not in dashboard demo set
public double? Lat { get; set; }             // map coords, clustered by region
public double? Lng { get; set; }
```
— `api/Domain.cs:56`–`api/Domain.cs:65`

**Modeling note:** the hierarchy is *flattened by denormalization*, not expressed purely by FK navigation. `Territory` carries `BrandId` even though you could reach the brand via the franchisee. That is a deliberate read-speed choice (Section 5). `Franchisee` is described as the data **controller** — it owns the operational rows; corporate reads only the rolled-up plane, never raw franchisee rows:

```csharp
// The tenancy boundary (catalog/untenanted itself). A franchisee is the data
// CONTROLLER: it owns the operational rows; corporate reads only the rolled-up
// read model, never the franchisee's raw rows directly (see RecomputeRollup).
```
— `api/Domain.cs:37`

### HFC tie-in

This is the franchise business model in schema form. A franchisor doesn't own its franchisees' books — the franchisee is the data controller. So corporate cannot just `SELECT * FROM appointments`; it must read a *consented, rolled-up* plane. The model enforces that org boundary with the query filter on the left box and no filter on the right box.

---

## 3. The global query filter as a modeling concern

Tenancy in HFC is not "remember to add `WHERE FranchiseeId = …` in every handler." It is declared **once, in the model**, so it is applied automatically to every LINQ query against those entities:

```csharp
b.Entity<Territory>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<Slot>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<Appointment>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
...
b.Entity<NpsSurvey>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
...
b.Entity<MonthlyReport>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
```
— `api/AppDb.cs:46`–`api/AppDb.cs:55`

The filter keys off a scoped `TenantContext`, populated from the **verified token claim**, not a client header:

```csharp
public class TenantContext
{
    public string? FranchiseeId { get; set; }   // isolation key (boundary)
    public string? BrandId { get; set; }         // grouping (not a boundary)
}
```
— `api/AppDb.cs:8`–`api/AppDb.cs:12`

### Fail-closed

The crucial property is what happens with **no tenant set**:

```csharp
// With no franchisee set, EF
// compares against null and returns nothing — fail-closed, never cross-tenant.
```
— `api/AppDb.cs:44`

`x.FranchiseeId == null` matches nothing (a non-nullable column is never null). So an unauthenticated or mis-scoped request returns an **empty set**, not the whole table. That is the right default: a bug fails to *empty*, never to *leak*.

### Why this is a modeling concern, not a controller concern

- It is part of `OnModelCreating` — the same place as keys and indexes. Tenancy is a *shape* of the data, not a runtime afterthought.
- New endpoints inherit isolation for free; you cannot forget the `WHERE`.
- The one sanctioned escape hatch is explicit and greppable — `IgnoreQueryFilters()` in `RecomputeRollup`, called out in the comments:

```csharp
// MonthlyReport is franchisee-owned operational data — same tenant filter.
// Only RecomputeRollup reads it cross-tenant, via IgnoreQueryFilters().
```
— `api/AppDb.cs:53`

The corporate read model entities have **no filter at all** — by design:

```csharp
// ── Corporate read model: NO tenant query filter ─────────────────────
// ... these tables are deliberately OUTSIDE the
// FranchiseeId filter. ...
```
— `api/AppDb.cs:84`

See [[M1-multitenancy]] for the full token→claim→filter chain and the RBAC scope filter that Bravo layers on top of the corporate plane.

### Failure mode: a filter not applied

If you add a new tenant-scoped entity (say `Invoice`) and **forget** the `HasQueryFilter` line, that table has *no* tenancy at all — every tenant sees every other tenant's invoices. EF gives you no warning; the queries just work and quietly leak. Mitigations:
- A model-build test that asserts every entity carrying a `FranchiseeId` property has a query filter.
- Code review checklist: "new tenant entity ⇒ filter + index on `FranchiseeId`."
The inverse failure (a filter applied where it shouldn't be) is why the read model is explicitly *un*-filtered — if you'd left a filter on `TerritoryPeriodSummary`, the corporate dashboard would return nothing for a corporate (tenant-less) login.

---

## 4. Indexing strategy

### 4.1 The unique index that enforces "no double-book" at the database

```csharp
// A slot can only be booked once: unique appointment per slot.
b.Entity<Appointment>().HasIndex(x => x.SlotId).IsUnique();
```
— `api/AppDb.cs:60`–`api/AppDb.cs:61`

This is the single most defensible line in the file. It is **not** an optimization — it is an **invariant enforced by the database**. No matter how many app servers, how many concurrent requests, how buggy the handler, the DB will reject a second appointment row for the same `SlotId` with a unique-constraint violation.

This pairs with the optimistic-concurrency token on the slot:

```csharp
// Concurrency token for double-booking protection (see Slot.Version).
b.Entity<Slot>().Property(x => x.Version).IsConcurrencyToken();
```
— `api/AppDb.cs:57`–`api/AppDb.cs:58`

```csharp
// two writers racing
// for the same slot — the second one's UPDATE matches 0 rows and EF throws
// DbUpdateConcurrencyException, which we surface as HTTP 409.
public int Version { get; set; }
```
— `api/Domain.cs:125`–`api/Domain.cs:128`

**Two layers, two failure modes covered:**
- The concurrency token catches the **race** (two writers reach the slot at once) → `409`.
- The unique index is the **backstop** — even if the version check is bypassed, the DB still cannot create a duplicate appointment.

That defense-in-depth is exactly what a senior engineer is expected to articulate: *don't rely on application logic for a money/booking invariant; let the database be the source of truth.*

### 4.2 Composite indexes for the dashboard / ordered lists

```csharp
// Every tenant-scoped query carries WHERE FranchiseeId = @t; index it.
// Composite (FranchiseeId, StartUtc) serves the ordered slot/appt lists.
// BrandId is indexed too for cross-franchisee grouping (corporate aggregates).
b.Entity<Territory>().HasIndex(x => x.FranchiseeId);
b.Entity<Slot>().HasIndex(x => new { x.FranchiseeId, x.StartUtc });
b.Entity<Slot>().HasIndex(x => x.BrandId);
b.Entity<Appointment>().HasIndex(x => new { x.FranchiseeId, x.StartUtc });
b.Entity<Appointment>().HasIndex(x => x.BrandId);
```
— `api/AppDb.cs:63`–`api/AppDb.cs:70`

The reasoning, leftmost-column first:
- **Every query already filters by `FranchiseeId`** (the query filter injects it). So `FranchiseeId` is the natural leading column of the composite index — it serves the equality predicate.
- **`StartUtc` second** serves the `ORDER BY StartUtc` / range scan for "today's slots in start order." A single `(FranchiseeId, StartUtc)` index satisfies *both* the tenant filter and the sort, so SQL Server can seek to the tenant's rows and read them already ordered — no sort, no scan.
- **`BrandId` alone** serves the corporate aggregates that group *across* franchisees within a brand.

### 4.3 NPS — the "territory-resolvable" index

```csharp
b.Entity<NpsSurvey>().HasIndex(x => x.AppointmentId).IsUnique();
b.Entity<NpsSurvey>().HasIndex(x => new { x.FranchiseeId, x.TerritoryId });
b.Entity<NpsSurvey>().HasIndex(x => x.BrandId);
```
— `api/AppDb.cs:76`–`api/AppDb.cs:78`

- `AppointmentId` **unique** — one survey per appointment (the response is the unit of truth).
- `(FranchiseeId, TerritoryId)` backs the franchisee dashboard's *NPS-by-territory* `GROUP BY` — index covers filter + group key.

### 4.4 The reported plane and the read model

```csharp
b.Entity<MonthlyReport>().HasIndex(x => x.FranchiseeId);
b.Entity<MonthlyReport>().HasIndex(x => new { x.TerritoryId, x.PeriodId }).IsUnique();
```
— `api/AppDb.cs:81`–`api/AppDb.cs:82`

The unique `(TerritoryId, PeriodId)` enforces "one report per territory per month." The corporate read model uses a composite **primary key** of the same shape so a re-run clears+rewrites by it without duplicating:

```csharp
b.Entity<TerritoryPeriodSummary>().HasKey(x => new { x.TerritoryId, x.PeriodId });
b.Entity<TerritoryPeriodSummary>().HasIndex(x => x.PeriodId);
b.Entity<TerritoryPeriodSummary>().HasIndex(x => x.BrandId);
b.Entity<TerritoryPeriodSummary>().HasIndex(x => x.RegionId);
b.Entity<TerritoryPeriodSummary>().HasIndex(x => new { x.PeriodId, x.CompositeScore });
```
— `api/AppDb.cs:91`–`api/AppDb.cs:95`

That last one, `(PeriodId, CompositeScore)`, is the dashboard's sort index — "this period's territories, worst composite score first" is a single seek + ordered read. And the watchlist:

```csharp
b.Entity<WatchlistFlag>().HasIndex(x => new { x.PeriodId, x.Severity });
b.Entity<WatchlistFlag>().HasIndex(x => x.TerritoryId);
```
— `api/AppDb.cs:99`–`api/AppDb.cs:100`

`(PeriodId, Severity)` serves "show me this period's high-severity flags."

### Failure mode: missing index → table scan / lock escalation

Drop the `(FranchiseeId, StartUtc)` composite and the "today's slots" query becomes a **full table scan** filtered in memory, then an in-memory **sort**. On a busy franchisee's slot table that is O(rows) per request and gets worse linearly. Under SQL Server, large scans take more locks (and can escalate to a table lock), so a missing index doesn't just slow reads — it **blocks writes** (new bookings) behind a scanning reader. The symptom in prod is "the dashboard got slow and bookings started timing out" — one missing index causes both.

Drop the unique `Appointment.SlotId` index and you lose the *correctness* backstop, not just speed: a race that slips past the concurrency check now double-books a customer.

---

## 5. Denormalization for read speed

### Why `BrandId`/`RegionId`/`FranchiseeSlug` ride along on the summary

```csharp
public int TerritoryId { get; set; }          // FK   (composite key part 1)
public int BrandId { get; set; }              // Brand.Num, denormalized for fast filter
public int RegionId { get; set; }             // denormalized
public int FranchiseeId { get; set; }
...
public string FranchiseeSlug { get; set; } = "";
```
— `api/ReadModel.cs:18`–`api/ReadModel.cs:29`

The read model is a **wide, flat, single-table-per-grain** shape on purpose. The reasoning:

1. **No joins on the read path.** A CEO filtering "West region, project-installation brands, this period" hits one table with three equality predicates — all indexed (`BrandId`, `RegionId`, `PeriodId`). No join to `Territory` → `Region` → `Brand`. The dashboard is a read-mostly OLAP-ish surface; joins are the enemy of read latency.
2. **The numbers are already an aggregate.** A `TerritoryPeriodSummary` row is *computed once* by the roll-up and read many times. There's no normalization benefit to dedup brand/region — they never change for a (territory, period) row, and the row is rewritten wholesale each run.
3. **`FranchiseeSlug` is the RBAC bridge.** The token claim carries the slug; the read model keys franchisee by integer. Carrying the slug *denormalized* lets Bravo's scope filter match claim→row slug-to-slug instead of fail-closing:

```csharp
// The bridge for Bravo's RBAC franchisee lens: Slice A's token claim carries the
// slug (HfcClaims.FranchiseeId), while the read model keys franchisee by INTEGER.
// Carrying the slug here lets the scope filter match claim→row slug-to-slug
```
— `api/ReadModel.cs:24`–`api/ReadModel.cs:27`

The operational side does the same — `NpsSurvey` denormalizes `TerritoryId` and `BrandId` from the appointment so the franchisee dashboard aggregates NPS by territory **in one line, no join back**:

```csharp
// Denormalized from the appointment so the franchisee dashboards can aggregate
// NPS *by territory* in one line (a GROUP BY TerritoryId) without joining back
// to Appointment. This is the "territory-resolvable" guarantee Slice D rides on.
```
— `api/Domain.cs:162`–`api/Domain.cs:164`

### Trade-off: normalize vs denormalize

| | Normalized (3NF) | Denormalized (HFC read model) |
|---|---|---|
| Write | one place to update | must rewrite on every roll-up run |
| Read | joins, slower | single-table seek, fast |
| Storage | smaller | wider rows, redundant brand/region |
| Consistency risk | none (single source) | a copy can drift if not rewritten atomically |

HFC resolves the consistency risk by **never updating in place** — the roll-up *clears and rewrites* by composite key, so the denormalized copies are regenerated, never patched. That is the safe way to denormalize: treat the read model as a *derived, disposable projection*, not a second source of truth. The source of truth stays normalized (operational tables); the read model is a cache you can always rebuild. See [[M7-bi-readmodels]] for the roll-up mechanics and provenance/`refresh_status` design.

### HFC tie-in

A franchisor CEO dashboard is read-heavy and latency-sensitive (executives don't wait). Denormalizing the grouping keys onto the summary is what makes "slice the whole network four ways instantly" feasible without a star-schema warehouse — it's a pragmatic read model that lives in the same SQL Server.

---

## 6. Migrations vs `EnsureCreated` — and the SQLite/Azure SQL split

### What the demo does

The demo uses `EnsureCreated()` (the schema is materialized straight from the model on startup against SQLite). That is the right call **for a demo** and the wrong call **for prod**. A senior answer is to know exactly why and where the line is.

### The trade-off

| | `EnsureCreated()` | Migrations (`dotnet ef migrations` + `Migrate()`) |
|---|---|---|
| What it does | creates the schema to match the *current* model, once | applies an ordered, versioned set of schema deltas |
| Schema evolution | none — it will **not** alter an existing DB to match a changed model | designed for it — each change is a migration |
| Data preservation | drop-and-recreate in practice for dev | preserves data across schema changes |
| Provenance / review | none | migrations are code, reviewed in PRs, diffable |
| Rollback | none | `Update-Database <prev>` / down-migrations |
| Speed to start | instant, zero ceremony | requires generating + applying migrations |
| Coexistence | the two are mutually exclusive on the same DB | — |

**The trap:** `EnsureCreated` checks only *whether the database exists*, not whether it *matches the model*. If you change an entity (add `NpsSurvey.Comment`, widen a column) against an already-created DB, `EnsureCreated` is a no-op — your schema silently drifts from your model and you get runtime errors ("no such column"). In a demo you just delete the SQLite file and restart, so it's invisible. In prod that would mean data loss or an unbootable service.

### When you'd use migrations in prod (and how to switch HFC over)

You move to migrations the moment **either** is true: (a) the schema will change after data exists, or (b) more than one environment/instance shares a DB. For HFC prod that's day one. The migration path:

1. `dotnet ef migrations add InitialCreate` — capture the current model (all the indexes/filters above) as the baseline.
2. Replace `EnsureCreated()` with `db.Database.Migrate()` at startup, **or** (better for Azure SQL) apply migrations from the deploy pipeline so app instances don't race to migrate. Generate an idempotent SQL script (`dotnet ef migrations script --idempotent`) and run it as a release step.
3. Every model change after that = a new migration, reviewed in the PR. Note query filters and indexes are *model* configuration, so a new index like `(FranchiseeId, StartUtc)` shows up as a real `CREATE INDEX` in the migration — auditable.

Caveat worth saying out loud: the global query filter is *not* schema — it's a runtime predicate. Migrations capture the **index** that supports it but not the filter itself; the filter lives in `OnModelCreating` and is enforced at query time regardless.

### SQLite-local / Azure SQL-prod

- **Local: SQLite.** Zero-install, file-based, fast to spin up and tear down — ideal for the demo and for tests. Its limitations *shape the model*: SQLite has **no `rowversion`**, which is exactly why the concurrency token is a plain `int` bumped on update rather than a SQL Server `rowversion`:

```csharp
// Optimistic-concurrency token. SQLite has no rowversion, so we use an int
// marked IsConcurrencyToken and bump it on each update
```
— `api/Domain.cs:124`–`api/Domain.cs:126`

- **Prod: Azure SQL.** Managed SQL Server — gives you real `rowversion`, proper index statistics, lock/latch behavior, point-in-time restore, and the migration tooling story above. The provider swap is a connection-string / `UseSqlServer` vs `UseSqlite` change; the model is provider-agnostic, but a few things differ (collation, `rowversion` availability, max index key sizes), so you validate the migration against Azure SQL, not just SQLite.
- **Why it's safe to develop on SQLite and ship on Azure SQL:** EF Core abstracts the provider, and the demo deliberately codes to the lowest common denominator (int concurrency token). The risk to flag in interview: *provider parity* — test the actual migrations against Azure SQL in CI, because SQLite will happily accept things SQL Server rejects (and vice versa).

### Failure mode

Shipping `EnsureCreated()` to prod: first schema change after launch silently no-ops, the app throws "invalid column" at runtime, and there's no migration history to roll forward or back. Recovery is manual `ALTER`s with no review trail — the exact thing migrations exist to prevent.

---

## 7. Demo proof

You can demonstrate every claim above against the running demo:

- **Unique double-book index:** book a slot, then `POST` a second appointment for the same `SlotId` (bypass the UI). The DB rejects it with a unique-constraint violation — proof the invariant is enforced below the app. Pair with two concurrent booking requests to see the `409` from the concurrency token (`api/Domain.cs:128`).
- **Fail-closed filter:** call a tenant-scoped endpoint (e.g. list appointments) with **no token** / no franchisee claim. You get an empty list, not a `500` and not someone else's data (`api/AppDb.cs:44`).
- **Cross-tenant isolation:** get a dev token for `budget-blinds-irvine`, list slots, then get one for `budget-blinds-tustin` — disjoint sets even though same brand (`api/Domain.cs:6`).
- **Read model is un-filtered:** log in corporate (no tenant) and the dashboard returns the whole network from `TerritoryPeriodSummary` — proof the read plane has no tenant filter (`api/AppDb.cs:84`).
- **Index serves the GROUP BY:** run the dashboard's territory-by-score view; the `(PeriodId, CompositeScore)` index (`api/AppDb.cs:95`) makes "worst-scoring territories this period" an ordered seek. On SQLite you can `EXPLAIN QUERY PLAN`; on Azure SQL inspect the actual execution plan to confirm a seek, not a scan.
- **EnsureCreated drift:** add a property to an entity, restart **without** deleting the SQLite file — observe the no-op (no new column), the proof that demos need migrations before they ship.

---

## 8. Interview defense — follow-ups & answers

**Q1. "Why enforce no-double-book with a unique index instead of just checking in code?"**
Because a booking is a money/correctness invariant and application checks have a TOCTOU race — two requests both read "slot free," both insert. The unique index on `Appointment.SlotId` (`api/AppDb.cs:61`) makes the database the arbiter; the second insert *cannot* succeed regardless of timing or how many app instances run. I keep the optimistic-concurrency token (`Slot.Version`, `api/AppDb.cs:58`) as the first line so the loser gets a clean `409` instead of a constraint exception, but the index is the non-negotiable backstop. Defense in depth: race handling in the app, correctness guarantee in the DB.

**Q2. "Denormalizing `BrandId`/`RegionId` onto the summary duplicates data — isn't that a smell?"**
It would be in an OLTP table, but the summary is a *derived read model*, not a source of truth. The source (operational tables) stays normalized. The read model is rewritten wholesale by the roll-up keyed on `(TerritoryId, PeriodId)` (`api/AppDb.cs:91`), so the denormalized copies are regenerated every run — they can't drift the way a hand-maintained duplicate would. The payoff is no joins on the executive read path: a four-way filter is a single indexed seek. The rule is "denormalize derived, disposable projections; never denormalize the system of record."

**Q3. "The demo uses `EnsureCreated`. Would you ship that?"**
No. `EnsureCreated` only checks existence, not model-match — the first schema change after data exists silently no-ops and the app throws at runtime, with no history to roll forward or back. For prod I'd add an `InitialCreate` migration capturing this exact model (indexes and all), apply it from the deploy pipeline with an idempotent script so instances don't race, and make every later change a reviewed migration. `EnsureCreated` is correct for the demo and for throwaway test DBs — instant, zero ceremony — but the line is "data must survive a schema change," and that's day one in prod.

**Q4. (likely) "Why is the query filter on `FranchiseeId` and not `BrandId`?"**
Because brand is a grouping, not a boundary (`api/Domain.cs:6`). Two franchisees share a brand — filtering by brand would let Irvine read Tustin. `FranchiseeId` is the only key that uniquely fences a tenant, and the filter compares against the claim from the verified token so a missing tenant fails closed to empty (`api/AppDb.cs:44`). Brand is still indexed (`api/AppDb.cs:68`) — but for *aggregation*, not isolation.

**Q5. (likely) "You develop on SQLite but deploy on Azure SQL — what breaks?"**
The model is provider-agnostic but parity isn't free. SQLite has no `rowversion`, so the concurrency token is a plain `int` (`api/Domain.cs:124`) — which actually keeps it portable. The real risks are collation, max index-key sizes, and SQLite being more permissive than SQL Server, so I run the actual migrations against Azure SQL in CI rather than trusting that "works on SQLite" means "works in prod." The connection swap (`UseSqlite`→`UseSqlServer`) is trivial; validating provider behavior is the work.

---

## Flashcards

1. **Q:** What are HFC's two tenancy axes and which is the security boundary? **A:** `FranchiseeId` (isolation boundary) and `BrandId` (grouping only). `api/Domain.cs:6`.
2. **Q:** What happens to a tenant-scoped query when no franchisee is resolved? **A:** Fail-closed — `FranchiseeId == null` matches nothing, returns empty. `api/AppDb.cs:44`.
3. **Q:** Which single line enforces "a slot can be booked at most once" at the DB? **A:** `b.Entity<Appointment>().HasIndex(x => x.SlotId).IsUnique();` `api/AppDb.cs:61`.
4. **Q:** Why does `Slot.Version` exist and how does it surface? **A:** Optimistic-concurrency token (int, since SQLite lacks rowversion); a losing racer's UPDATE matches 0 rows → `DbUpdateConcurrencyException` → HTTP 409. `api/Domain.cs:124`.
5. **Q:** What does the composite `(FranchiseeId, StartUtc)` index buy you? **A:** Tenant equality seek + already-ordered read for the slot/appt lists — no scan, no sort. `api/AppDb.cs:67`.
6. **Q:** Why is `BrandId` indexed separately from the composite? **A:** Corporate aggregates group *across* franchisees within a brand. `api/AppDb.cs:68`.
7. **Q:** Why do the corporate read-model entities have **no** query filter? **A:** They're the franchisor's aggregated plane; the franchisee/corporate lens is an RBAC scope filter applied pre-query, not row-level tenancy. `api/AppDb.cs:84`.
8. **Q:** Why does `TerritoryPeriodSummary` carry `BrandId`/`RegionId`/`FranchiseeSlug`? **A:** Denormalized so the dashboard filters/RBAC-matches with no joins; rewritten wholesale each roll-up so copies can't drift. `api/ReadModel.cs:18`.
9. **Q:** What's the composite key of the read model and why? **A:** `(TerritoryId, PeriodId)` — a re-run clears+rewrites by it so re-runs never duplicate rows. `api/AppDb.cs:91`.
10. **Q:** What does `EnsureCreated` fail to do that migrations do? **A:** It only checks DB *existence*, not model-match — it won't alter an existing schema, so model changes silently drift. Migrations apply ordered, reviewable, reversible deltas.
11. **Q:** What's the one sanctioned cross-tenant read and how? **A:** `RecomputeRollup`, via `IgnoreQueryFilters()`. `api/AppDb.cs:53`.
12. **Q:** Why a plain `int` concurrency token instead of SQL Server `rowversion`? **A:** SQLite (local dev) has no `rowversion`; the int marked `IsConcurrencyToken` is portable across SQLite and Azure SQL. `api/Domain.cs:124`.

---

## Mock Q&A

**MQ1. "Walk me through how HFC models the brand→region→territory→franchisee hierarchy and why."**
Brand and Region are untenanted catalog/grouping rows; Territory is the operational convergence point carrying `FranchiseeId` (boundary), `BrandId` (grouping), and `RegionId` (`api/Domain.cs:56`). Franchisee is the boundary itself and the data *controller* (`api/Domain.cs:37`). The hierarchy is partly flattened by denormalization for read speed.
- *Follow-up:* "Why not pure FK navigation?" → A franchisor dashboard is read-heavy; joining territory→region→brand on every query is wasteful, and the grouping keys never change for a given row, so carrying them denormalized is cheap and join-free.

**MQ2. "How does HFC guarantee a slot is never double-booked under concurrency?"**
Two layers: optimistic-concurrency token `Slot.Version` catches the race and yields a `409` (`api/Domain.cs:128`); the unique index on `Appointment.SlotId` is the DB-level backstop that makes a duplicate physically impossible (`api/AppDb.cs:61`).
- *Follow-up:* "If you had to drop one, which?" → Keep the unique index. The token is UX (clean 409); the index is correctness, and correctness for a booking can't live in app code.

**MQ3. "Why are the read-model tables deliberately *outside* the tenant query filter?"**
They're the corporate aggregated plane — the CEO logs in tenant-less and must see the whole network (`api/AppDb.cs:84`). The franchisee-vs-corporate distinction there is an RBAC *scope* filter Bravo applies before the query, not row-level tenancy. `FranchiseeSlug` is denormalized onto the summary specifically to make that scope match slug-to-slug instead of fail-closing (`api/ReadModel.cs:24`).
- *Follow-up:* "Isn't an un-filtered table a leak risk?" → Only if the scope filter is skipped. The protection moved up a layer (RBAC pre-query) because the data model's job here is aggregation, not isolation; the *operational* tables remain row-fenced. (See [[M1-multitenancy]].)

**MQ4. "The demo uses EnsureCreated. Critique that and tell me your prod plan."**
`EnsureCreated` is instant and zero-ceremony — right for a demo/test DB — but it only checks existence, so the first post-launch schema change silently no-ops and the app throws at runtime with no rollback path. Prod plan: `InitialCreate` migration capturing this model, apply via idempotent script from the deploy pipeline (so instances don't race), every later change a reviewed migration.
- *Follow-up:* "Does the migration capture the tenant filter?" → No — the filter is a runtime predicate in `OnModelCreating`, not schema. Migrations capture the supporting *indexes* (e.g. the `FranchiseeId` index) but the filter is enforced at query time regardless of the DB.

**MQ5. "You build on SQLite, run on Azure SQL. What in the model is shaped by that, and what would you watch?"**
The clearest tell is the concurrency token: a plain `int` because SQLite has no `rowversion` (`api/Domain.cs:124`) — that choice keeps it portable to Azure SQL. What I'd watch: provider parity (collation, max index-key size, SQLite being more permissive), so I run the real migrations against Azure SQL in CI rather than trusting SQLite. The provider swap itself is just `UseSqlite`→`UseSqlServer`.
- *Follow-up:* "Would Azure SQL change any of your indexes?" → The index *shapes* stay (they're driven by query patterns, not provider). On Azure SQL I'd additionally lean on real statistics and consider covering/`INCLUDE` columns for the hottest dashboard reads — something SQLite doesn't model.
