# EF Core — project notes & interview prep

Target audience: Senior Full Stack Cloud Developer candidate (.NET/Azure role).
All claims are grounded in the actual source files listed in parentheses.

---

## What it is

Entity Framework Core 9 (EF Core 9) is Microsoft's cross-platform ORM for .NET.
It sits between application code and the database, translating LINQ queries and
object-graph changes into SQL, tracking which entities are dirty, and managing
transactions through `SaveChanges` as a unit-of-work boundary. EF Core 9 is
provider-agnostic: the same `DbContext` code runs against SQLite locally and Azure
SQL in production by swapping one connection string and one `Use*` call.

---

## How it's used in the HFC demo

### Global query filter — tenant isolation, fail-closed

`AppDb` (`api/AppDb.cs`) applies `HasQueryFilter` to every tenant-scoped entity:

```csharp
b.Entity<Territory>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
b.Entity<Slot>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
b.Entity<Appointment>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
```

`_tenant` is a scoped `TenantContext` (`api/AppDb.cs`) whose `BrandId` is set by
middleware from the `X-Tenant-Id` request header (`api/Program.cs`, lines 39-45).
EF Core bakes the filter expression into every generated query at the model level,
so it cannot be forgotten by accident in a handler.

**Fail-closed behaviour:** when no tenant header is present, `BrandId` is `null`.
EF Core emits `WHERE BrandId = NULL`, which matches nothing — zero rows returned
across all tenant-scoped tables. A missing header never leaks another tenant's data;
it just returns empty sets (or the explicit 400 the endpoint guards enforce before
hitting the DB).

`Brand` is deliberately _not_ filtered — it is the catalog from which a client
chooses its tenant and must be visible before any `X-Tenant-Id` is set.

### Optimistic concurrency via `Slot.Version` + `IsConcurrencyToken`

`Slot` carries an `int Version` field (`api/Domain.cs`, lines 37-38):

```csharp
// Optimistic-concurrency token. SQLite has no rowversion, so we use an int
// marked IsConcurrencyToken and bump it on each update: two writers racing
// for the same slot — the second one's UPDATE matches 0 rows and EF throws
// DbUpdateConcurrencyException, which we surface as HTTP 409.
public int Version { get; set; }
```

`AppDb` registers it (`api/AppDb.cs`, line 35):

```csharp
b.Entity<Slot>().Property(x => x.Version).IsConcurrencyToken();
```

When a booking is attempted (`api/Program.cs`, lines 89-90), the handler
increments the token before saving:

```csharp
slot.IsBooked = true;
slot.Version++;   // bump the concurrency token
```

EF Core generates:

```sql
UPDATE Slots SET IsBooked = 1, Version = 2, ...
WHERE Id = @id AND Version = 1   -- the value EF read; must still match
```

If a concurrent request already committed (Version is now 2), this UPDATE affects
0 rows. EF Core detects the mismatch and throws `DbUpdateConcurrencyException`,
caught explicitly and returned as HTTP 409 (`api/Program.cs`, lines 105-108).

**Why `int`, not `rowversion`/`timestamp`:** SQLite has no native `rowversion` type.
SQL Server's `rowversion` is a database-managed 8-byte counter that EF Core reads
back automatically. On SQLite, that column type is silently ignored; the value never
changes, concurrency checking never fires. The workaround is an application-managed
`int` token that the code bumps explicitly on each write — portable across both
providers.

### Unique index on `SlotId` as a backstop

```csharp
b.Entity<Appointment>().HasIndex(x => x.SlotId).IsUnique();
```
(`api/AppDb.cs`, line 38)

Even if two requests somehow race past the `IsBooked` check and the concurrency
token (e.g., both read before either writes, so both see `Version = 1` but only one
commits first), the database-level unique constraint on `SlotId` prevents the second
`INSERT` from creating a duplicate appointment. The resulting `DbUpdateException` is
caught and returned as HTTP 409 (`api/Program.cs`, lines 109-112). This is a
defence-in-depth backstop, not the primary concurrency guard.

### Composite indexes for query performance

```csharp
b.Entity<Territory>().HasIndex(x => x.BrandId);
b.Entity<Slot>().HasIndex(x => new { x.BrandId, x.StartUtc });
b.Entity<Appointment>().HasIndex(x => new { x.BrandId, x.StartUtc });
```
(`api/AppDb.cs`, lines 42-44)

Every tenant-scoped query carries `WHERE BrandId = @t`; without an index this is a
full table scan. The composite `(BrandId, StartUtc)` index also covers the
`ORDER BY StartUtc` used on the slot and appointment listing endpoints, making the
ordering a free index traversal.

### Projection to DTOs

No endpoint returns raw entities. LINQ `.Select()` projects directly to record DTOs
before materialisation, e.g. for the brand list (`api/Program.cs`, lines 54-55):

```csharp
.Select(b => new BrandDto(b.Id, b.Name, b.Tagline)).ToListAsync()
```

And for slots with a join to territories (`api/Program.cs`, lines 62-66):

```csharp
db.Slots
  .Join(db.Territories, s => s.TerritoryId, te => te.Id, (s, te) => new { s, te })
  .OrderBy(x => x.s.StartUtc)
  .Select(x => new SlotDto(x.s.Id, x.te.Id, x.te.Name, x.s.StartUtc, x.s.IsBooked))
  .ToListAsync()
```

Projecting in-query (not after `.ToList()`) means EF Core selects only the needed
columns, the change tracker never tracks the materialised objects, and the DTO
shape is stable independently of internal entity refactors.

### `EnsureCreated` on-startup seeding

`Program.cs` (lines 30-34) creates a DI scope at startup and calls `Seed.Run`:

```csharp
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    Seed.Run(db);
}
```

`Seed.Run` (`api/Seed.cs`, lines 22-23) calls `EnsureCreated` then bails early if
data is already present:

```csharp
db.Database.EnsureCreated();
if (db.Brands.Any()) return;   // already seeded
```

This gives zero-setup local runs: delete `hfc-demo.db`, restart, and the schema and
demo data are recreated from the model. The trade-off is intentional — see below.

### Provider swap: SQLite locally, Azure SQL in production

`Program.cs` (lines 8-11):

```csharp
var conn = builder.Configuration.GetConnectionString("Default")
           ?? "Data Source=hfc-demo.db";
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(conn));
```

In Azure the `Default` connection string is overridden via App Service configuration
(managed identity connection string). The Bicep IaC (`infra/`) and deploy script
pass `deploySql=true` to switch to Azure SQL Server with `UseSqlServer`. No `AppDb`
or `Domain.cs` code changes; only the provider call and connection string differ.

---

## Why we chose it (and alternatives)

### EF Core vs Dapper / raw ADO.NET

EF Core was chosen because the domain has clear entity relationships (Brand →
Territory → Slot → Appointment), the model evolves as the demo grows, and features
like global query filters (tenant isolation) and optimistic concurrency are
first-class primitives rather than hand-rolled SQL. The LINQ-to-SQL translation,
change tracking, and unit-of-work via `SaveChanges` remove significant ceremony.

Dapper is a better fit when you need hand-tuned SQL for complex reporting queries,
when the team prefers SQL ownership, or when the schema diverges significantly from
the object model. For this demo, those needs do not arise.

### `EnsureCreated` vs Migrations, and the trade-off

`EnsureCreated` creates the schema from the current model snapshot in one call — no
migration history table, no migration files. It is idempotent (does nothing if the
schema exists) and ideal for local throwaway databases and demo resets.

The critical trade-off: **`EnsureCreated` cannot alter an existing schema.** Add a
column, run the app against an existing DB, and the column silently does not exist.
There is no migration path; the only remediation is drop-and-recreate. In
production this means data loss.

The correct production pattern is `dotnet ef migrations add`, code-review the
generated migration, and run `db.Database.MigrateAsync()` at startup (or as a
pre-deploy step in CI). This project uses `EnsureCreated` deliberately because the
SQLite file is ephemeral, and the demo emphasises the application patterns rather
than operational database lifecycle.

### SQLite locally vs Azure SQL (SQL Server) in production

SQLite requires zero infrastructure — no server process, no network, no credentials.
It makes the demo runnable with `dotnet run` from a clean clone. The same EF Core
model works against Azure SQL with managed-identity authentication and a connection
string swap because both providers implement the same EF Core interfaces.

SQLite differences to be aware of: no native `rowversion`, limited `ALTER TABLE`
support (no drop-column without table rebuild), single-writer WAL mode (see
Gotchas), and no support for `ROW_NUMBER` in some older provider versions. For
production multi-user workloads Azure SQL is the correct choice.

---

## Core concepts to nail

**Change tracking.** EF Core's `ChangeTracker` monitors every entity loaded through
the context. On `SaveChanges` it diffs the current state against the snapshot taken
at load time and emits the minimal set of INSERT/UPDATE/DELETE statements. In this
demo the booking endpoint reads `slot`, mutates it in memory, then calls
`SaveChangesAsync` — the tracker detects the change and generates the UPDATE.

**Global query filters.** Defined in `OnModelCreating` via `HasQueryFilter`, they
are appended as an AND clause to every LINQ query on that entity type. They apply
automatically, including through navigation properties. They can be bypassed with
`.IgnoreQueryFilters()` for admin/audit endpoints, but the HFC demo has none.

**Optimistic vs pessimistic concurrency.** Optimistic: read without locking, write
with a version check, retry or surface conflict on mismatch — low contention
overhead, scales well, but requires handling `DbUpdateConcurrencyException`. Used
here. Pessimistic: take a database lock at read time (`SELECT FOR UPDATE`); the
second reader blocks until the first commits — eliminates conflicts at the cost of
throughput and deadlock risk. EF Core has no native pessimistic locking helper;
it requires raw SQL or `FromSqlRaw`.

**N+1 and projections.** A classic N+1 loads a list of N entities then issues N
additional queries to load a related entity per item. The fix is either `.Include()`
(eager load join) or an in-query `.Select()` projection that joins and shapes the
result in one SQL statement. The slot listing uses a LINQ `Join` + `Select` —
one query, no N+1.

**Tracking vs no-tracking.** Tracked queries (default) snapshot entities for change
detection — correct for read-modify-write. No-tracking queries (`.AsNoTracking()`)
skip snapshotting and return faster, lower-memory results — correct for read-only
projections. Projecting to DTOs with `.Select()` implicitly avoids tracking because
the materialised type is not an entity EF Core knows about.

**Transactions and `SaveChanges` as unit-of-work.** All changes accumulated in a
`DbContext` instance are flushed in a single database transaction on `SaveChanges`.
The booking endpoint adds both the mutated `Slot` and the new `Appointment` in one
`SaveChangesAsync` call — both commit or both roll back. Explicit transactions
(`db.Database.BeginTransactionAsync`) are available when you need to span multiple
`SaveChanges` calls.

**Migrations.** `dotnet ef migrations add <Name>` diffs the current model against
the last migration snapshot and generates C# Up/Down methods. `dotnet ef database
update` applies pending migrations. `db.Database.MigrateAsync()` at startup applies
them automatically. The migration history table (`__EFMigrationsHistory`) records
which migrations have been applied. This demo bypasses migrations in favour of
`EnsureCreated` for simplicity.

**Async.** All database calls use async LINQ (`ToListAsync`, `FirstOrDefaultAsync`,
`SaveChangesAsync`). This keeps ASP.NET Core request threads free during I/O,
enabling higher throughput under load.

---

## Gotchas we actually hit

**Two processes over one SQLite file → `SQLite Error 10: disk I/O error`**
(`SKILL.md`, Gotchas section). If a prior `dotnet run` instance was not fully
killed before starting a second, both processes contested the same SQLite file in
WAL mode. SQLite's WAL allows one writer and multiple readers, but two concurrent
writers corrupt the WAL and trigger disk I/O errors. The fix: confirm nothing holds
port 5180 before launching (`ss -ltnp | grep :5180`), kill by PID (not by process
name, because the binary is named `api` not `api.dll`), and delete stale
`hfc-demo.db-wal` and `hfc-demo.db-shm` files before restarting.

**SQLite has no native `rowversion` column type.**
SQL Server's `rowversion` is a server-managed binary counter; EF Core reads it back
automatically after each write, and IsConcurrencyToken on a rowversion property
just works. On SQLite the `rowversion` column type is silently accepted but never
incremented by the database — the value stays at whatever was last written. This
means the WHERE clause in the UPDATE always matches, concurrency checking never
fires, and double-bookings are not prevented. The workaround (`Domain.cs`, Slot
class comment) is an application-managed `int Version` that the code increments
explicitly before each write, making it portable across both providers.

---

## Interview Q&A

**Q: How does the global query filter produce tenant isolation, and what happens
when the `X-Tenant-Id` header is missing?**

A: `HasQueryFilter` on `Territory`, `Slot`, and `Appointment` appends
`AND BrandId = @tenantId` to every query at the model level. The middleware sets
`TenantContext.BrandId` from the header. When the header is absent, `BrandId` is
`null`, and EF Core emits `WHERE BrandId IS NULL` — nothing matches. The system is
fail-closed: a misconfigured or unauthenticated request returns empty results, never
cross-tenant data. Endpoints also guard explicitly with `if (t.BrandId is null)
return NeedTenant()` before touching the DB, which surfaces a clean 400 rather than
a silent empty response.

**Q: Walk me through exactly how a double-booking attempt produces an HTTP 409.**

A: Two concurrent requests both call `GET /api/slots`, both read the same Slot with
`IsBooked = false` and `Version = 1`. Both enter the booking handler. Both set
`slot.IsBooked = true; slot.Version++`. The first `SaveChangesAsync` emits
`UPDATE Slots SET IsBooked=1, Version=2 WHERE Id=@id AND Version=1` — 1 row
affected, commits. The second emits the same WHERE clause, but `Version` is now 2
in the database, so 0 rows match. EF Core sees the affected-row count is 0 and
throws `DbUpdateConcurrencyException`. The handler catches it and returns
`Results.Conflict("Slot was just booked by someone else.")` — HTTP 409.

**Q: Why not use SQL Server's `rowversion` type for the concurrency token?**

A: This codebase must run against both SQLite (local dev) and Azure SQL (production)
with the same model. SQLite does not execute `rowversion` semantics — it accepts the
column type declaration but never increments the value, so the WHERE clause in
EF Core's UPDATE always matches and concurrency protection is silently disabled. An
application-managed `int Version` that is explicitly bumped in code works identically
on both providers.

**Q: Why is there a second concurrency guard — the unique index on `SlotId` — if
`Slot.Version` already prevents double-booking?**

A: Optimistic concurrency via `Version` covers the case where both writers read the
same slot state before either writes. But if both requests load the slot, both
increment `Version`, and both call `SaveChangesAsync` concurrently at the exact
same millisecond, there is a theoretical window where both UPDATE statements match
(database isolation level dependent). Additionally, a bug or a non-EF path (raw SQL,
a migration script) could bypass the version bump. The unique index on `SlotId` is
a database-enforced backstop: the second INSERT for the same `SlotId` fails
unconditionally, and the `DbUpdateException` is caught and returned as 409.

**Q: What is the difference between `EnsureCreated` and migrations, and why would
you not use `EnsureCreated` in production?**

A: `EnsureCreated` creates the schema from the current model if no database exists;
it does nothing if the database already exists. There is no migration history, no
up/down path, and no ability to apply incremental schema changes. Adding a column
and running against an existing database leaves the column missing with no error.
The only remediation is drop-and-recreate, which destroys data. In production, use
`dotnet ef migrations add` to generate versioned migration files and
`db.Database.MigrateAsync()` (or a pre-deploy CI step) to apply them safely.
`EnsureCreated` is appropriate for tests, demos, and ephemeral local databases
where data loss on schema change is acceptable.

**Q: What is change tracking, and when would you turn it off?**

A: When EF Core loads an entity, the `ChangeTracker` takes a snapshot of its
property values. On `SaveChanges`, it compares the current values against the
snapshot and generates UPDATE statements for dirty properties. This is what allows
`slot.IsBooked = true; slot.Version++; await db.SaveChangesAsync()` to produce an
UPDATE with no explicit SQL. The overhead is memory (snapshot storage) and CPU
(comparison on `SaveChanges`). For read-only queries — listing brands, returning
slots — tracking is waste. `.AsNoTracking()` skips snapshotting and materialises
entities faster. Projecting to DTOs with `.Select()` achieves the same effect
because EF Core does not track non-entity types.

**Q: How does the `SaveChanges` unit-of-work pattern ensure the slot and
appointment are consistent?**

A: Within a single `DbContext` request scope, the booking handler mutates the
existing `Slot` (tracked) and adds a new `Appointment` to `db.Appointments`. One
call to `SaveChangesAsync` flushes both changes in a single database transaction:
the UPDATE to `Slots` and the INSERT into `Appointments` either both commit or both
roll back. If the `DbUpdateConcurrencyException` fires on the UPDATE, neither write
persists — the appointment is never created for a slot that was not actually
acquired.

**Q: How does the slot listing avoid an N+1 query?**

A: The endpoint needs both Slot fields and the Territory name. Rather than loading
all Slots and then issuing one `db.Territories.Find(slot.TerritoryId)` per slot
(N+1), it uses a LINQ `Join` + `Select` projection that EF Core translates into a
single SQL JOIN. The projection shapes the result into `SlotDto` records in-database,
so only the needed columns travel over the wire and no entity graph is tracked.

**Q: How would you swap SQLite for Azure SQL in this project?**

A: Change the `Default` connection string in App Service configuration to an Azure
SQL connection string (using managed identity: `Authentication=Active Directory
Default` in the string, and grant the App Service's system-assigned identity the
`db_datareader`/`db_datawriter` roles in SQL). In the DI registration, swap
`o.UseSqlite(conn)` for `o.UseSqlServer(conn)`. Generate and apply proper EF Core
migrations (`dotnet ef migrations add InitialCreate`, `MigrateAsync` at startup)
instead of `EnsureCreated`. Remove the `int Version` workaround and use a `byte[]`
property marked `[Timestamp]` to get SQL Server's native `rowversion` handling.

**Q: What would you change about this EF Core setup before taking it to production
scale?**

A: Several things. Replace `EnsureCreated` with versioned migrations. Switch to
Azure SQL with managed identity (no credentials in config). Add `.AsNoTracking()` to
all read-only queries or use `UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking)`
as the context default with explicit `.AsTracking()` on write paths. Add
connection resiliency with `EnableRetryOnFailure` for transient Azure SQL errors.
Add Application Insights / OpenTelemetry query logging to surface slow queries.
Consider splitting the large `OnModelCreating` into `IEntityTypeConfiguration<T>`
classes for maintainability. For high-throughput booking, evaluate whether pessimistic
locking (`SELECT ... WITH (UPDLOCK)` via raw SQL) reduces retries compared to
optimistic concurrency under heavy contention.
