# Multi-tenancy, Concurrency & Idempotency — project notes & interview prep

> Grounded in the HFC demo codebase. Every claim cites a real file and line.
> Audience: Senior Full Stack Cloud Developer candidate (.NET / Azure role).

---

## What these patterns solve

These three patterns collectively answer a single question: **how do you keep shared infrastructure correct when multiple actors race over shared data?**

- **Multi-tenancy** ensures that Tenant A's data is invisible to Tenant B — the correctness failure is a cross-tenant data leak, which is simultaneously a security breach, a privacy violation, and a compliance event.
- **Optimistic concurrency** ensures that two users racing for the same resource (an appointment slot) cannot both win — the correctness failure is a double-booking, which manifests as an overcommitted calendar and an angry customer.
- **Idempotency** ensures that a retried operation (a deposit POST sent twice because of a network timeout) produces the same result as the first — the correctness failure is a double-charge, which is a financial and trust failure.

Each pattern addresses a different failure mode; all three must be present for a multi-tenant scheduling API to be trustworthy.

---

## How they're implemented in the HFC demo

### Multi-tenancy: EF global query filter + fail-closed design

**Source files:** `api/AppDb.cs`, `api/Program.cs`, `api/Domain.cs`

Every tenant-scoped entity (`Territory`, `Slot`, `Appointment`) carries a `BrandId` column and is registered with a global query filter in `AppDb.OnModelCreating`:

```csharp
// api/AppDb.cs, lines 30-32
b.Entity<Territory>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
b.Entity<Slot>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
b.Entity<Appointment>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
```

`_tenant` is a scoped `TenantContext` instance injected into `AppDb`. EF Core compiles each query filter into every SQL `WHERE` clause for that entity — it cannot be forgotten per-endpoint because it lives in the model configuration, not in handler code.

**Fail-closed:** if `TenantContext.BrandId` is `null`, EF compares `BrandId == null`, which matches no rows. No tenant set means no data returned — the design fails safe rather than returning everything.

**Tenant resolution — the demo path (insecure) and the production fix:**

The demo resolves the tenant from the `X-Tenant-Id` request header in inline middleware (`api/Program.cs`, lines 39-45):

```csharp
app.Use(async (ctx, next) =>
{
    var tenant = ctx.RequestServices.GetRequiredService<TenantContext>();
    if (ctx.Request.Headers.TryGetValue("X-Tenant-Id", out var t))
        tenant.BrandId = t.ToString();
    await next();
});
```

This is **intentionally insecure for demo purposes** — any caller can claim any brand. The ROADMAP (`ROADMAP.md`, item 8 in the issues table) explicitly flags this: *"The demo's tenancy is header-based (`X-Tenant-Id`) — spoofable."* The production fix is to source `BrandId` from a validated JWT claim in the auth middleware; the EF query filter is unchanged — only the trusted source of the tenant value changes.

**Endpoints enforce the presence of a tenant.** Every handler that queries tenant-scoped data guards with:

```csharp
// api/Program.cs, lines 60, 73, 84
if (t.BrandId is null) return NeedTenant();
```

Where `NeedTenant()` returns HTTP 400 (`api/Program.cs`, lines 47-48). A missing tenant is an immediate, explicit error — not a silent data mis-scope.

**The corrected two-axis tenancy model (ROADMAP):**

The demo uses a single-axis model: `BrandId` is both the grouping concept and the isolation boundary. The ROADMAP (`ROADMAP.md`, issue #3) corrects this for production:

> *"Tenancy = `(brandId, franchiseeId)`. Brand is a grouping, franchisee is the boundary."*

A `Budget Blinds` franchisee in Irvine and a `Budget Blinds` franchisee in Dallas share a `brandId` but must be isolated by `franchiseeId`. The demo's EF filter mechanism is correct; only the key being filtered changes. The ROADMAP also distinguishes two data planes: *operational data* (appointments, slots) owned by the franchisee, and *identity data* (Home Profile) owned by HFC corporate and shared cross-brand only with explicit consent.

**Supporting indexes** ensure tenant-scoped queries are never full table scans (`api/AppDb.cs`, lines 42-44):

```csharp
b.Entity<Slot>().HasIndex(x => new { x.BrandId, x.StartUtc });
b.Entity<Appointment>().HasIndex(x => new { x.BrandId, x.StartUtc });
```

---

### Double-booking prevention: optimistic concurrency + unique index backstop

**Source files:** `api/Domain.cs` (lines 27-38), `api/AppDb.cs` (lines 35-38), `api/Program.cs` (lines 82-116)

`Slot` carries an integer concurrency token:

```csharp
// api/Domain.cs, lines 37-38
// Optimistic-concurrency token. SQLite has no rowversion, so we use an int
// marked IsConcurrencyToken and bump it on each update...
public int Version { get; set; }
```

Registered in the model:

```csharp
// api/AppDb.cs, line 35
b.Entity<Slot>().Property(x => x.Version).IsConcurrencyToken();
```

EF Core uses the concurrency token by appending it to the `UPDATE` statement's `WHERE` clause:

```sql
UPDATE Slots SET IsBooked=1, Version=2, ...
WHERE Id=@slotId AND Version=1   -- the value we read
```

If another request already committed a write (bumping `Version` to 2), this `UPDATE` matches 0 rows. EF detects that and throws `DbUpdateConcurrencyException`. The booking handler catches this and returns HTTP 409 (`api/Program.cs`, lines 101-108):

```csharp
try
{
    await db.SaveChangesAsync();
}
catch (DbUpdateConcurrencyException)  // someone booked this slot first
{
    return Results.Conflict("Slot was just booked by someone else.");
}
catch (DbUpdateException)             // unique-index race on SlotId
{
    return Results.Conflict("Slot already booked.");
}
```

**Second backstop — unique index on `SlotId`:**

```csharp
// api/AppDb.cs, line 38
b.Entity<Appointment>().HasIndex(x => x.SlotId).IsUnique();
```

If two requests somehow both pass the application-layer `IsBooked` check (e.g., the check and write span separate transactions, or in-memory state is stale), the database rejects the second `INSERT` with a unique constraint violation. EF surfaces this as `DbUpdateException`, caught on line 109. The unique index is the last line of defense at the storage layer.

**Note on SQLite vs Azure SQL:** SQLite serializes writers at the file lock level, so true write concurrency is unlikely in local development. On Azure SQL, concurrent transactions genuinely race; the `IsConcurrencyToken` pattern is where the protection actually fires. This is a known and documented limitation of the demo setup.

---

### Idempotency: deposit endpoint with `Idempotency-Key`

**Source files:** `api/Domain.cs` (lines 50-52), `api/Program.cs` (lines 120-142)

`Appointment` persists the key of the deposit that was applied:

```csharp
// api/Domain.cs, lines 51-52
// Idempotency-Key of the deposit that was applied. A retried POST with the
// same key returns the existing appointment instead of charging twice.
public string? DepositKey { get; set; }
```

The deposit endpoint enforces idempotency in three steps:

1. **Require a key.** If `Idempotency-Key` header is absent or blank, return HTTP 400 immediately (`api/Program.cs`, lines 124-125). Callers must opt in; there is no accidental idempotency.

2. **Short-circuit on repeat.** If `Appointment.DepositKey` is already set, the deposit has been applied. Return the existing state — no payment logic runs, no double-charge (`api/Program.cs`, lines 130-135):

```csharp
if (appt.DepositKey is not null)       // already paid
{
    return Results.Ok(new AppointmentDto(...));
}
```

3. **Apply and record.** On a fresh deposit, write both the amount and the key atomically in the same `SaveChangesAsync` call (`api/Program.cs`, lines 137-139):

```csharp
appt.DepositCents = req.AmountCents;
appt.DepositKey = key.ToString();
await db.SaveChangesAsync();
```

**Current simplification vs. a full idempotency store:** The demo stores the key directly on the `Appointment` row. This means idempotency is per-appointment only — two different appointments cannot share a key, and the implementation does not distinguish "same key, safe retry" from "different key, already paid" in its response (both return the existing state). A production-grade implementation uses a separate `IdempotencyKeys` table that stores `(key, endpoint, requestHash, cachedResponseBody, expiresAt)`. This lets the system return the exact original response on retry, enforce key scoping by endpoint, and expire old keys. The current design is correct for preventing double-charges; it is not a general-purpose idempotency store.

---

## Why these approaches (and alternatives)

### Multi-tenancy models

| Model | Isolation | Cost | Notes |
|---|---|---|---|
| Database-per-tenant + elastic pools | Strongest (data never co-located) | Highest (one DB per tenant) | Breach of one tenant cannot touch others; schema migration is per-tenant; elastic pools amortize cost |
| Shared schema + row-level security (RLS) | Strong (enforced at DB engine) | Low (single DB) | Azure SQL RLS pushes the predicate into the engine itself — application bugs cannot bypass it; slightly more ops overhead to set up |
| Shared schema + application filter (HFC demo) | Good if the filter is airtight | Lowest | Simplest to implement; the risk is a code path that bypasses the filter — EF global query filters are the mitigation, but `IgnoreQueryFilters()` exists |

The HFC flashcard framing: **cheapest / least isolation** (shared schema + app filter) versus **most isolation / highest cost** (database-per-tenant). The right answer depends on tenant count, regulatory requirements, and breach-blast-radius tolerance. The demo proves you understand the shared-schema approach; the ROADMAP notes that EF's filter mechanism is retained when moving to the corrected `franchiseeId`-scoped model.

### Optimistic vs. pessimistic concurrency

**Optimistic concurrency** (HFC demo): reads without locking; detects conflict at write time via a version token; loser retries or gets a 409. Works well when conflicts are rare (typical for scheduling — most slots are not simultaneously contested). No lock overhead on the read path.

**Pessimistic concurrency**: `SELECT ... WITH (UPDLOCK)` or `SELECT FOR UPDATE` acquires a lock at read time; no other writer can proceed until the lock is released. Guarantees the winner always wins; but serializes all concurrent writers for that row, increasing latency and risk of deadlock under load. Appropriate when conflicts are frequent or when the cost of a retry is high.

For appointment scheduling, optimistic is the right default. The unique index provides the database-level backstop that makes the optimistic approach safe even if application logic has a gap.

**ETags / `If-Match` (HTTP-layer optimistic concurrency):** `Slot.Version` maps directly to the ETag pattern: the client holds the version it last read; the server checks it on write. This is the same pattern as `If-Match` on REST APIs and `rowversion`/`timestamp` on SQL Server.

### Idempotency vs. distributed locks

**Idempotency keys** (HFC demo): the client generates a unique key; the server stores it with the result. Retries are safe because the server recognizes the key. Works across process restarts and network retries; no lock held between request and response.

**Distributed locks** (e.g., Redis `SET NX`): the client acquires a lock before the operation; no other client can run the same operation concurrently. Solves a different problem (mutual exclusion during the operation itself, not deduplication after the fact). More complex; requires a reliable lock store and a strategy for lock expiry/deadlock. Not the right tool for payment idempotency — use idempotency keys, the pattern payment processors like Stripe mandate.

---

## Core concepts to nail

**Tenant isolation strategies and their trade-offs.** Know the three models (database-per-tenant, RLS, app-layer filter) and be able to state when you'd pick each. Know that the scary failure is always a cross-tenant data leak, and that isolation must live in one enforced seam (not scattered per-handler). EF global query filters are that seam in the demo.

**The EF global query filter fail-closed guarantee.** The filter is `BrandId == _tenant.BrandId`. When `BrandId` is null, no rows match. This is the property that makes the design safe by default. Know that `IgnoreQueryFilters()` bypasses it — and that the only legitimate use is the brand catalog endpoint, which is explicitly not tenant-scoped (`api/Program.cs`, line 53: `db.Brands` has no query filter registered on `Brand`).

**Optimistic concurrency / ETags / rowversion.** The sequence: read row + version → mutate in memory → write with `WHERE id=X AND version=N` → detect 0 rows updated → throw / return 409. Know how `IsConcurrencyToken` maps to that SQL. Know that SQL Server's `rowversion`/`timestamp` does this at the DB level without manual bumping; the demo uses manual increment because SQLite lacks a native rowversion type.

**Idempotency keys + at-least-once delivery and dedup.** The pattern: client generates a UUID; server stores it with the result on first receipt; subsequent requests with the same key return the cached result without re-running the operation. This is the pattern Stripe, Braintree, and most payment APIs mandate. It pairs with at-least-once message delivery (Service Bus, Event Grid) — consumers deduplicate by storing processed message IDs, exactly as the demo stores `DepositKey`.

---

## Gotchas / honest limitations

**Header-based tenant is spoofable.** The demo's `X-Tenant-Id` header is set by the caller. In the demo this is intentional (it lets the Angular brand-picker work without auth). In production this is a critical security flaw — any caller can impersonate any tenant. The fix is always to source the tenant from a validated JWT claim. The EF query filter is unchanged; only the source of truth changes. See ROADMAP item 8.

**SQLite serializes writers.** SQLite's default journal mode serializes concurrent writes at the file level, meaning two simultaneous `SaveChangesAsync` calls for the same slot will effectively queue rather than race. The `IsConcurrencyToken` protection fires as designed on Azure SQL (where row-level locks and snapshot isolation allow genuine concurrency). Don't demo the double-booking protection with two simultaneous SQLite requests and expect a visible race — the fix for demo purposes is to deploy to Azure SQL or simulate the conflict with staggered requests.

**Deposit idempotency is per-appointment, not a global store.** The `DepositKey` column lives on `Appointment`. This means: (a) the same Idempotency-Key could be used on two different appointments and both would succeed; (b) the server does not distinguish "same key, safe retry" from "different key, appointment already paid" — both paths return HTTP 200 with the existing state. For a real payment endpoint, use a global `IdempotencyKeys` table keyed on `(key, endpoint)` that stores the cached response and enforces key uniqueness across all appointments.

---

## Interview Q&A

**Q1: Which multi-tenancy model did you use in the HFC demo, and why?**

Shared schema with application-layer row filtering via EF Core global query filters. For a demo with two seed tenants it is the right trade-off: zero ops overhead, easy to reason about, and the filter is configured once in `OnModelCreating` rather than scattered across handlers. At scale I would evaluate Azure SQL row-level security (pushes the predicate into the engine, application bugs cannot bypass it) or database-per-tenant with elastic pools (strongest isolation, highest cost) depending on the tenant count and regulatory requirements.

**Q2: How do you guarantee no cross-tenant data leak?**

The guarantee has two parts. First, isolation lives in one place — the EF global query filter in `AppDb.OnModelCreating`. Any query against a tenant-scoped entity automatically gets `WHERE BrandId = @t` appended; it is not possible to forget it in a handler. Second, the design is fail-closed: if `TenantContext.BrandId` is null (no tenant resolved), the filter matches no rows — the API returns empty rather than returning everything. The only way to bypass the filter is to call `IgnoreQueryFilters()` explicitly, which I would flag in code review.

**Q3: What is the production fix for the header-based tenant?**

Replace the middleware's `ctx.Request.Headers.TryGetValue("X-Tenant-Id", ...)` with a claim extracted from the validated JWT — for example, `ctx.User.FindFirstValue("franchisee_id")`. Entra ID or Azure AD B2C issues the token after authenticating the user; the `franchiseeId` claim is embedded by the identity provider and cannot be spoofed by the caller. The EF query filter is unchanged — it still reads from `TenantContext.BrandId` — only the trusted source of that value changes.

**Q4: Walk me through preventing a double-booking.**

When a booking request arrives, the handler reads the `Slot` row including its `Version` (currently 1). It sets `IsBooked = true` and increments `Version` to 2. `SaveChangesAsync` emits `UPDATE Slots SET IsBooked=1, Version=2 WHERE Id=@id AND Version=1`. If a concurrent request already committed the same update, `Version` is already 2 and this `UPDATE` matches 0 rows. EF Core detects zero rows updated for a tracked entity with a concurrency token and throws `DbUpdateConcurrencyException`. The handler catches that and returns HTTP 409. There is also a unique index on `Appointment.SlotId` (`api/AppDb.cs` line 38) as a database-level backstop — if two requests somehow both pass the application check, the second `INSERT` violates the unique constraint and also returns 409.

**Q5: Why optimistic over pessimistic concurrency for slot booking?**

Booking conflicts are rare — most requests target different slots. Optimistic concurrency adds no overhead to the read path and no lock contention under normal load. Pessimistic (`SELECT FOR UPDATE` or `WITH (UPDLOCK)`) serializes all concurrent writers for a given slot even when there is no actual conflict, increasing latency and deadlock risk. The cost of the optimistic approach is that the loser must handle a 409, which the client can surface as "someone just booked that slot — please choose another." That is an acceptable UX for this domain.

**Q6: How do you make a payment idempotent?**

The client generates a UUID before the first attempt and sends it as the `Idempotency-Key` header. On first receipt, the server applies the deposit and persists the key on the `Appointment` row atomically. On any retry with the same key, the server finds `DepositKey` is already set, skips the payment logic, and returns the previously-computed response. The key is required — a missing key is a 400. This guarantees at-most-once side effects regardless of how many times the network retries the request. The production improvement is a dedicated `IdempotencyKeys` table that stores the full cached response body and enforces key uniqueness globally across all endpoints.

**Q7: What is the difference between `IsConcurrencyToken` and SQL Server's `rowversion`?**

`rowversion` (formerly `timestamp`) is a database-generated 8-byte value that SQL Server automatically increments whenever a row is updated — the application never touches it. `IsConcurrencyToken` is the EF Core annotation that tells EF to include the property in `UPDATE WHERE` clauses; it can be applied to any column. In the HFC demo, `Slot.Version` is an application-managed integer that is manually incremented (`slot.Version++`) before `SaveChangesAsync`. On SQL Server I would use `[Timestamp]` / `rowversion` instead — it is set by the database so there is no risk of the application forgetting to bump it, and it avoids an extra round-trip to read back the new value.

**Q8: The ROADMAP says the real isolation key is `franchiseeId`, not `BrandId`. What changes?**

The EF query filter mechanism is identical — it still reads a value from the scoped `TenantContext` and appends it to every query. What changes: (a) `TenantContext` holds `FranchiseeId` instead of `BrandId`; (b) every operational table carries `FranchiseeId` as the tenant column instead of `BrandId`; (c) `BrandId` remains on entities as a grouping/FK but is not the isolation key; (d) the JWT claim resolved in middleware is `franchisee_id`, scoped to the authenticated staff member's franchise. The brand catalog and cross-brand identity data (Home Profile) live on a separate data plane with separate isolation rules and explicit consent gating.

**Q9: How does idempotency relate to at-least-once message delivery?**

They are two sides of the same contract. A message broker like Azure Service Bus guarantees at-least-once delivery — the consumer may receive the same message more than once (duplicate delivery after a timeout or crash). The consumer must be idempotent: processing the same message twice must produce the same result as processing it once. The deposit endpoint is the synchronous analogue: HTTP timeouts cause clients to retry, so the endpoint must be idempotent. In both cases the mechanism is the same — store a unique key with the result; on receipt of a duplicate key, short-circuit and return the cached result without re-executing the side effect.

**Q10: What would you change about the current idempotency implementation before going to production?**

Three things. First, move from a column on `Appointment` to a dedicated `IdempotencyKeys` table with columns `(Key, Endpoint, RequestHash, ResponseStatus, ResponseBody, CreatedAt, ExpiresAt)`. This enables key scoping by endpoint (a key used on `/deposit` cannot accidentally match `/cancel`), stores the exact original response for replay, and allows expiry of old keys. Second, distinguish "same key, safe retry" from "different key, already paid" — currently both return the same 200 with existing state; the latter should probably return 409 to surface the logic error. Third, add a unique index on `(Key, Endpoint)` in the idempotency table so that concurrent identical requests hitting the database simultaneously cannot both insert — one wins, one gets a constraint violation and reads the winner's result.
