# M1 — Multi-Tenancy (Pooled shared-schema + EF Core global query filter)

> Mastery study doc for the HFC Senior Full Stack Cloud Developer interview.
> Every code claim below is quoted from the real `hfc-demo` with `file:line`.
> Cross-links: [[M4-data-modeling-efcore]] · [[M5-rbac-hierarchy]]

---

## 1. Mental model — what, why HFC, where it fits

**What.** Multi-tenancy is one running application serving many isolated customers (tenants) from shared infrastructure. The central question is *isolation*: how do you guarantee tenant A can never see tenant B's rows? Three canonical models:

| Model | Isolation | What it is | Cost / ops |
|-------|-----------|------------|------------|
| **Silo** | Physical | One DB (or one app stack) per tenant | Strongest isolation, highest cost, painful to operate at scale, hard cross-tenant analytics |
| **Pool** | Logical | All tenants share one schema; rows tagged with a tenant key; every query filtered | Cheapest, best density, trivial cross-tenant rollups — but a single missed filter leaks data |
| **Bridge** | Mixed | Shared schema but separate schema/partition per tenant, or noisy tenants peeled into silos | Middle ground; more moving parts |

**Why HFC uses Pool (pooled shared-schema).** HFC is a franchisor running **8 brands × dozens of franchisees** out of one ASP.NET Core API and one SQL database. A silo-per-franchisee model would mean dozens of databases and would make the *entire product*— the corporate executive rollup across the whole network — a cross-database nightmare. Pooled shared-schema gives high density AND makes the corporate aggregate a single `GROUP BY`. The cost of pool — "one missed `WHERE` leaks every tenant" — is bought down by enforcing isolation **once, centrally**, in EF Core, not per-query.

**Where it fits.** Isolation is enforced at the data-access layer (EF Core `HasQueryFilter`), seeded by an auth seam that turns a *verified identity* into a *tenant*. RBAC ([[M5-rbac-hierarchy]]) sits *on top* and is a different concern (what a role may see within/across tenants); data modeling ([[M4-data-modeling-efcore]]) is *underneath* (the denormalized tenant keys and indexes that make the filter cheap).

---

## 2. The TWO-AXIS model (the core HFC insight)

HFC has two tenant-shaped attributes, and **only one is an isolation boundary**:

- **`franchiseeId`** = the **isolation boundary**. This is the row-owner. Tenant A literally is a franchisee.
- **`brandId`** = **grouping only, NOT a boundary**. Two franchisees of the *same brand* are still fully isolated from each other. Brand is a denormalized grouping key that exists so the corporate dashboard can roll up *by brand* — it is never used to scope a tenant request.

This is stated in the type itself:

```csharp
// api/AppDb.cs:8-12
public class TenantContext
{
    public string? FranchiseeId { get; set; }   // isolation key (boundary)
    public string? BrandId { get; set; }         // grouping (not a boundary)
}
```

and in the claim catalog:

```csharp
// api/Auth.cs:24-32
public static class HfcClaims
{
    public const string FranchiseeId = "franchisee_id";  // the isolation key
    public const string BrandId = "brand_id";             // the grouping
    ...
}
```

**Why this matters in an interview:** the trap answer is "we partition by brand." That's wrong and it leaks: Budget Blinds Irvine and Budget Blinds Tustin are the *same brand* but must not see each other's bookings. The smoke test proves exactly this — see §7. The filter keys on franchisee, never brand:

```csharp
// api/AppDb.cs:46-52
b.Entity<Territory>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<Slot>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<Appointment>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<NpsSurvey>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
```

`BrandId` rides along *denormalized* on these tables (`Slot.BrandId`, `Appointment.BrandId`) and is indexed (`AppDb.cs:68,70`) purely so the corporate aggregator can `GROUP BY` brand — it is structurally incapable of scoping a tenant read because no query filter references it.

---

## 3. Tenant resolution — VERIFIED claim, not a spoofable header

The single most important security property: **the tenant is derived from a cryptographically verified JWT claim, never from client-supplied input.**

### Step 1 — the token is validated (signature, issuer, audience, lifetime)

```csharp
// api/Auth.cs:145-151  (production: Entra ID / B2C, JWKS-backed RS256)
o.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = true,
    ValidateAudience = true,
    ValidateLifetime = true,
    ValidateIssuerSigningKey = true,
};
```

Local/test uses the *same validation rigor* with a symmetric dev key — `ValidateIssuerSigningKey = true` etc. (`Auth.cs:156-165`). The comment makes the principle explicit: "never a 'trust the header' shortcut" (`Auth.cs:129-130`).

### Step 2 — the verified principal becomes the tenant (the seam)

```csharp
// api/Auth.cs:60-70  — THE SEAM
public static class TenantResolver
{
    public static void Populate(TenantContext tenant, ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true) return;   // no identity → no tenant
        tenant.FranchiseeId = user.FindFirst(HfcClaims.FranchiseeId)?.Value;
        tenant.BrandId = user.FindFirst(HfcClaims.BrandId)?.Value;
    }
}
```

### Step 3 — wired per-request, after authentication

```csharp
// api/Program.cs:64-69
app.Use(async (ctx, next) =>
{
    var tenant = ctx.RequestServices.GetRequiredService<TenantContext>();
    TenantResolver.Populate(tenant, ctx.User);   // ctx.User is already validated
    await next();
});
```

`TenantContext` is registered **scoped** (`Program.cs:11: builder.Services.AddScoped<TenantContext>();`) so each request gets its own instance, and the `AppDb` is constructed with it (`AppDb.cs:16-18`). The middleware runs *after* `app.UseAuthentication()` (`Program.cs:57`), so `ctx.User` is the validated principal — the tenant can only be what the IdP signed.

**Contrast — what a junior would build:** read `X-Tenant-Id` from a header. Any caller can set that header to another franchisee's id and read their data. HFC's design closes that hole structurally: the comment at `Auth.cs:11-14` says the seam "trusts only the scoped TenantContext, which is populated here from claims that the JWT pipeline has already validated."

---

## 4. Fail-closed (no claim → no tenant → no rows)

The default behavior of every failure path is **return nothing**, never "return everything."

- Unauthenticated principal → `Populate` returns early, `FranchiseeId` stays `null` (`Auth.cs:64`).
- Authenticated but no `franchisee_id` claim → `FindFirst` returns `null`, `FranchiseeId` stays `null`.
- Either way, the query filter compares `x.FranchiseeId == null`, which in SQL matches **zero rows**:

```csharp
// api/AppDb.cs:42-45 (comment)
// With no franchisee set, EF compares against null and returns nothing —
// fail-closed, never cross-tenant.
```

At the HTTP edge, "no token" is rejected even earlier: `smoke-api.sh:34` asserts `slots without a token -> 401`. And unknown-id lookups 404 rather than probing another tenant's row: `smoke-api.sh:103-104` — "a non-existent territory -> 404 (never another's row)."

**The principle:** an attacker who strips the claim, sends a corrupt token, or hits a bug gets an *empty result*, not someone else's data. The fail-open alternative (e.g. `if (tenant == null) return allRows;` or forgetting the `== null` semantics) is the classic SaaS breach.

---

## 5. Defense in depth

Isolation is enforced at multiple independent layers, so one mistake doesn't equal a breach:

1. **Edge / authentication** — no valid token → 401 (`smoke-api.sh:34`); validation params reject bad signature/issuer/audience/expiry (`Auth.cs:145-165`).
2. **Authorization policy** — corporate read-down endpoints require the `Corporate` policy / role (`Auth.cs:172-176`), separate from tenancy.
3. **Data layer (the backstop)** — EF global query filter appends `WHERE FranchiseeId = @t` to *every* LINQ query against the scoped entities, automatically, even if a handler forgets to filter (`AppDb.cs:46-55`).
4. **Schema/index** — composite indexes on `(FranchiseeId, StartUtc)` (`AppDb.cs:67,69`) make the always-present tenant predicate cheap, so isolation isn't traded against performance.

The query filter is the *backstop*: even a careless `db.Appointments.ToListAsync()` is still tenant-scoped because the filter is on the model, not the call site.

---

## 6. The escape-hatch risk — raw SQL & `IgnoreQueryFilters()`

Global query filters protect **LINQ over the DbSet**. They do **not** protect:

- **`IgnoreQueryFilters()`** — explicitly bypasses the filter.
- **Raw SQL** (`FromSqlRaw`, `ExecuteSqlRaw`, Dapper, ADO.NET) — EF can't append a filter to SQL it didn't generate; the developer must write the `WHERE` by hand.
- **Navigation loads that re-enter via a non-filtered root**, or projections built from `IgnoreQueryFilters` queries.

These are the leak vectors in a pooled model. The rule HFC enforces: **`IgnoreQueryFilters()` is allowed in exactly one place, on purpose, and that place writes only to the corporate read model — it never serves a tenant request.**

### Where HFC *deliberately* uses `IgnoreQueryFilters` — the corporate rollup

`Rollup.Recompute` is the **single sanctioned cross-tenant aggregator** (ADR-19). The franchisor is entitled to consolidate its own network, so it reads every franchisee's operational data on purpose:

```csharp
// api/Rollup.cs:61-68
// ADR-19: RecomputeRollup is the ONE sanctioned corporate cross-tenant
// aggregator. IgnoreQueryFilters() deliberately bypasses the FranchiseeId
// tenant boundary here — the franchisor is entitled to consolidate its
// whole network into the read model. This is the only code path allowed
// to read across franchisees; every request-time reader stays filtered.
var territories = db.Territories.IgnoreQueryFilters().AsNoTracking()
    .Where(t => t.RegionId != null)           // dashboard set only
    .ToList();
```

It does the same for `Slots`, `Appointments`, `MonthlyReports`, `NpsSurveys` (`Rollup.cs:73,75,93,102`) — all `IgnoreQueryFilters().AsNoTracking()`, all read-only, all aggregated in memory by `(territory, period)`. Its **only writes** are to `territory_period_summary` + `watchlist_flag` (`Rollup.cs:9-10`), which are themselves **deliberately outside** the tenant filter:

```csharp
// api/AppDb.cs:84-91
// ── Corporate read model: NO tenant query filter ─────────────────────
// ... these tables are deliberately OUTSIDE the FranchiseeId filter.
b.Entity<TerritoryPeriodSummary>().ToTable("territory_period_summary");
```

The corporate/franchisee *lens* on that read model is then a separate **scope filter applied pre-query** (the dashboard RBAC, `Program.cs:77-83` + [[M5-rbac-hierarchy]]) — **row-level tenancy and the corporate read model are two distinct mechanisms**. A franchisee viewing the dashboard is fail-closed to its own territories at the scope layer; a corporate principal sees all.

> Interview gold: "We use exactly one `IgnoreQueryFilters` call site, it's an ADR'd corporate aggregator that only writes a read model, and we'd guard it with an architecture test / code-review rule so a second one can't sneak in." (Tests already assert this path: `tests/RollupProvenanceTests.cs:21,40`.)

---

## 7. Failure modes in prod

| Failure | Cause | Symptom | HFC mitigation |
|---------|-------|---------|----------------|
| **Cross-tenant data leak** | New entity added without a `HasQueryFilter`; or a raw-SQL handler with no `WHERE FranchiseeId` | Franchisee sees another's appointments/revenue | Filter is mandatory on every tenant entity (`AppDb.cs:46-55`); raw SQL banned/reviewed; one ADR'd `IgnoreQueryFilters` |
| **Brand-scoping leak** | Partitioning by `brandId` instead of `franchiseeId` | Same-brand franchisees see each other | Filter keys on `FranchiseeId` only; brand is grouping-only; `smoke-api.sh:50` regression test |
| **Fail-open default** | `if (tenant==null) return all` logic | Anonymous/broken-token request returns everyone's data | Fail-closed by construction: null → zero rows (`AppDb.cs:42-45`), no token → 401 |
| **Spoofed tenant header** | Trusting `X-Tenant-Id` | Any caller impersonates any tenant | Tenant only from verified JWT claim (`Auth.cs:60-70`, `Program.cs:64-69`) |
| **Rollup leak via the read model** | Corporate read model served raw to a franchisee | Franchisee sees whole-network aggregates | Read model gated by the `Corporate` policy + a pre-query scope filter (`Auth.cs:172-176`, `Program.cs:77-83`) |

The "missing filter" failure is the dangerous one because it's **silent**: nothing breaks, queries still return rows, the leak is only visible to the victim or in an audit. That's why the *default* (filter is on the model) and the *test* (`smoke-api.sh`) both matter.

---

## 8. Trade-offs — when NOT to use pooled shared-schema

- **Hard regulatory / data-residency isolation** (HIPAA per-customer, EU residency) → **silo** (DB-per-tenant) wins; pool's logical isolation may not satisfy the auditor, and a single bug is a multi-tenant breach. HFC's franchise data doesn't carry that bar, so pool's density + easy rollup win.
- **Wildly noisy neighbors** (one tenant 100× the load) → **bridge** (peel the whale into its own DB) — pool gives no resource isolation; a runaway query hurts everyone.
- **Per-tenant schema customization** → pool forces one schema; if tenants need different columns, silo/bridge or a flexible (EAV/JSON) column.
- **Why silo loses for HFC:** the entire executive product is *cross-tenant* — corporate rollup, watchlist, brand comparisons. In a silo that's federated cross-database querying. In pool it's `IgnoreQueryFilters` + one `GROUP BY`. The product shape (a franchisor consolidating its network) is the decisive argument for pool.

---

## 9. Interview defense — likely follow-ups

**Q: A query filter is just a `WHERE` EF adds. How is that real security?**
It's defense-in-depth, not the only layer. It's the data-layer *backstop* so a forgetful handler can't leak. Real security is the stack: verified-JWT tenant resolution (un-spoofable), fail-closed defaults, the policy gate, *and* the filter. No single layer is "the" control.

**Q: What about raw SQL or `IgnoreQueryFilters`? Doesn't that defeat it?**
Yes — those are the known escape hatches, and we treat them as such. Raw SQL is avoided/reviewed and must hand-write the tenant predicate. `IgnoreQueryFilters` appears in exactly one ADR'd place (`Rollup.cs:66`), the corporate aggregator, which only writes a read model and never serves a tenant request. I'd enforce "no new `IgnoreQueryFilters`" with an architecture/unit test in CI.

**Q: Why not partition by brand — isn't that the natural tenant?**
Brand is grouping, not a boundary. Same-brand franchisees (Irvine vs Tustin) must be isolated from each other. The isolation key is `franchiseeId`; `brandId` is denormalized only so corporate can roll up by brand (`AppDb.cs:11`, smoke test `smoke-api.sh:50`).

**Q: How do you stop someone forgetting the filter on a new entity?**
The filter lives on the model in `OnModelCreating`, so it's a one-line declaration per entity and visible in review. Backstops: a smoke/integration test that asserts cross-tenant 404/403, and an EF model-validation test that fails if a tenant entity lacks a `HasQueryFilter`.

**Q: How does this move from dev symmetric key to production Entra ID?**
The validation pipeline is identical; only the key material and issuer move. If `Auth:Authority` is set we trust the IdP's JWKS (RS256); otherwise the dev symmetric key with the same validation rigor (`Auth.cs:131-167`). Tokens travel the same path, so tests prove the real validation, not a bypass.

---

## 10. Demo proof — where this is shown in `hfc-demo`

- **Cross-tenant write isolation (the two-axis proof):** `e2e/smoke-api.sh:49-50` — Budget Blinds Tustin (`tok budget-blinds-tustin`) tries to book Budget Blinds **Irvine's** slot → **404**, even though they're the *same brand*. This is the single sharpest demonstration that `franchiseeId`, not `brandId`, is the boundary.
- **Fail-closed at the edge:** `smoke-api.sh:34` — `slots` without a token → **401**.
- **No probing other tenants' rows:** `smoke-api.sh:103-104` — unknown territory → **404** ("never another's row").
- **RBAC scope layer (related):** `smoke-api.sh:115-116` — a franchisee reading a territory outside its scope → **403** (cross-tenant). See [[M5-rbac-hierarchy]].
- **The sanctioned cross-tenant aggregator:** `api/Rollup.cs:61-105` + tests `tests/RollupProvenanceTests.cs:21,40`.
- **The dev login stand-in** for B2C/Entra: `/api/dev/token` mints a per-franchisee verified token (`smoke-api.sh:14-20`, minted by `DevTokens.Mint` / `MintCorporate` at `Auth.cs:75-122`).

---

## Flashcards

**Q1.** A request arrives with a valid JWT but no `franchisee_id` claim. What rows does `db.Slots.ToListAsync()` return, and why?
**A.** Zero. `TenantContext.FranchiseeId` stays `null` (`Auth.cs:65`), the filter becomes `WHERE FranchiseeId = NULL`, which matches no rows. Fail-closed (`AppDb.cs:42-45`).

**Q2.** Budget Blinds Irvine and Budget Blinds Tustin share a brand. Can Tustin read Irvine's appointments? Where is that enforced?
**A.** No. The filter keys on `FranchiseeId`, not `BrandId` (`AppDb.cs:48`). Proven by `smoke-api.sh:50` (404).

**Q3.** An attacker sets header `X-Tenant-Id: budget-blinds-irvine`. What happens?
**A.** Nothing — HFC never reads a tenant header. Tenant comes only from the verified JWT claim via `TenantResolver.Populate` (`Auth.cs:60-70`). The header is ignored.

**Q4.** You add a new entity `Invoice` with a `FranchiseeId`. What one line prevents it from leaking across tenants?
**A.** `b.Entity<Invoice>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);` in `OnModelCreating` (pattern: `AppDb.cs:46-55`).

**Q5.** Why does `Slot` carry a denormalized `BrandId` if brand isn't a tenant boundary?
**A.** So the corporate rollup can `GROUP BY` brand. It's indexed (`AppDb.cs:68`) for that aggregate; no query filter references it, so it can't scope a tenant read.

**Q6.** Where is the *only* place EF's tenant filter is intentionally bypassed, and what is it allowed to do?
**A.** `Rollup.Recompute` via `IgnoreQueryFilters()` (`Rollup.cs:66`). It only *reads* cross-tenant (read-only) and *writes* solely to the corporate read model (`territory_period_summary`, `watchlist_flag`). It never serves a tenant request.

**Q7.** A teammate writes `db.Appointments.FromSqlRaw("SELECT * FROM Appointments")`. What's the risk?
**A.** Global query filters don't apply to raw SQL — it returns every tenant's appointments. The `WHERE FranchiseeId` must be written by hand; raw SQL is the leak vector pooled tenancy must guard.

**Q8.** Why is `TenantContext` registered `AddScoped` and not singleton?
**A.** One tenant per request. Scoped gives each request its own instance (`Program.cs:11`) populated from *that* request's principal; a singleton would bleed one tenant into another.

**Q9.** The tenancy middleware is placed after `app.UseAuthentication()`. Why does order matter?
**A.** `TenantResolver.Populate` reads `ctx.User`. Before authentication runs, `ctx.User` isn't the validated principal, so the tenant would resolve from an unverified/empty identity (`Program.cs:57,64-67`).

**Q10.** How does isolation survive a developer forgetting to add `.Where(a => a.FranchiseeId == ...)` in a handler?
**A.** It survives — the filter is on the *model*, not the call site, so EF appends the predicate to every LINQ query automatically (`AppDb.cs:46-55`). That's why it's the backstop layer.

**Q11.** Dev uses a symmetric HS256 key; prod uses Entra ID RS256/JWKS. What changes in the *validation* logic?
**A.** Nothing — both validate issuer, audience, lifetime, and signing key (`Auth.cs:145-165`). Only key material + issuer move. Tests exercise the real path, not a bypass.

**Q12.** A franchisee hits the executive dashboard endpoint. What stops them seeing whole-network numbers?
**A.** Two things: the `Corporate` authorization policy gates corporate endpoints (`Auth.cs:172-176`), and the dashboard scope filter resolves a `franchisee_id` principal down to its own territories before querying (`Program.cs:77-83`). Distinct from row-level tenancy.

---

## Mock Q&A

**1. Walk me through HFC's multi-tenant isolation, top to bottom.**
A request carries a JWT validated for signature/issuer/audience/lifetime (`Auth.cs:145-165`). After `UseAuthentication`, middleware calls `TenantResolver.Populate` to copy the verified `franchisee_id` claim into a scoped `TenantContext` (`Program.cs:64-67`, `Auth.cs:60-70`). `AppDb` takes that context and applies a global query filter `x.FranchiseeId == _tenant.FranchiseeId` to every tenant entity (`AppDb.cs:46-55`), so every query is auto-scoped. It's pooled shared-schema with the filter as the data-layer backstop, behind auth and policy layers.
> **Hard follow-up: Where can that break, and how do you defend it?** Raw SQL and `IgnoreQueryFilters` bypass the filter. We allow `IgnoreQueryFilters` in exactly one ADR'd place — the corporate aggregator (`Rollup.cs:66`) — which is read-only and only writes the corporate read model. Raw SQL is avoided/reviewed. I'd add a CI architecture test that fails on any new `IgnoreQueryFilters` and any tenant entity missing a `HasQueryFilter`.

**2. Why pooled and not a database per franchisee?**
Density and — decisively — the product is cross-tenant. The whole executive layer consolidates the network (rollup, watchlist, brand comparisons). In pool that's one `GROUP BY` over a shared schema; in silo it's federated cross-DB querying. Franchise data doesn't carry a per-customer regulatory-isolation bar, so pool's tradeoff is right here.
> **Hard follow-up: When would you flip to silo or bridge?** Silo if a brand demanded contractual/regulatory physical isolation or data residency. Bridge if one franchisee became a noisy neighbor — pool gives no resource isolation, so I'd peel the whale into its own DB while keeping everyone else pooled, and the corporate rollup would then need a federation step for that tenant.

**3. Explain the two-axis model. Why isn't brand the tenant?**
`franchiseeId` is the isolation boundary; `brandId` is grouping only (`AppDb.cs:8-12`). Two franchisees of the same brand must be isolated — Irvine can't see Tustin. Brand exists denormalized so corporate can aggregate by brand. If you partitioned by brand you'd leak same-brand franchisees into each other.
> **Hard follow-up: Prove it isn't leaking same-brand.** `smoke-api.sh:50`: a Tustin token tries to book Irvine's slot → 404, same brand. The filter only references `FranchiseeId` (`AppDb.cs:48`); nothing in the model scopes by brand, so a same-brand read is structurally impossible to satisfy with another franchisee's rows.

**4. The classic SaaS breach is a tenant reading another tenant's data. How does fail-closed prevent it?**
Every failure resolves to *empty*, not *everything*. No token → 401 (`smoke-api.sh:34`). Token without the claim → `FranchiseeId` null → `WHERE FranchiseeId = NULL` → zero rows (`AppDb.cs:42-45`). Unknown id → 404, never another tenant's row (`smoke-api.sh:103-104`). There is no `return allRows` default anywhere.
> **Hard follow-up: A new endpoint does `db.Appointments.FromSqlRaw(...)`. Now what?** That escapes the filter and would return all tenants — this is the pooled-model footgun. Fix: hand-write `WHERE FranchiseeId = @t` parameterized, and better, route reads through the filtered DbSet. Guardrails: a Roslyn analyzer / review rule flagging `FromSqlRaw`/`ExecuteSqlRaw`, plus the cross-tenant smoke tests that would catch the leak as a 200 where a 404 is expected.

**5. How do tenancy and the corporate dashboard coexist if the dashboard reads across tenants?**
They're two separate mechanisms. Row-level tenancy (the query filter) governs operational tables per request. The corporate read model (`territory_period_summary`, `watchlist_flag`) is deliberately *outside* the filter (`AppDb.cs:84-91`); it's populated by the one sanctioned aggregator (`Rollup.cs:61-105`) and gated by the `Corporate` policy plus a pre-query scope filter (`Auth.cs:172-176`, `Program.cs:77-83`).
> **Hard follow-up: What stops a franchisee from reading the corporate read model directly?** The `Corporate` policy (`RequireRole(corporate)`) gates corporate endpoints, and `DashboardScopeResolver` fail-closes a `franchisee_id` principal to only its own territories before the query runs (`Program.cs:77-83`). A franchisee principal therefore can't address whole-network rows even though the table itself isn't row-filtered. See [[M5-rbac-hierarchy]].

---

### See also
- [[M4-data-modeling-efcore]] — the denormalized tenant keys, composite indexes (`AppDb.cs:66-82`), and read-model schema that make the filter cheap and the rollup possible.
- [[M5-rbac-hierarchy]] — the brand→region→territory scope layer and the `Corporate` policy that sit on top of row-level tenancy.
