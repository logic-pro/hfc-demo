# M2 — ASP.NET Core 9 / C# Backend

> Mastery doc for the HFC Senior Full Stack Cloud Developer interview.
> Every code snippet below is real and cited `file:line`. Cross-links: [[M1-multitenancy]], [[M3-api-contracts]].

---

## 1. Mental model

The HFC API is a **thin composition root + a fan of self-contained endpoint modules**, all sitting on top of one non-negotiable invariant: **identity becomes tenant exactly once, after the request is authenticated, and everything downstream reads only that resolved tenant — never client input.**

Three layers, top to bottom:

1. **`Program.cs` (104 lines)** — wires DI, orders the middleware pipeline, seeds on boot, and *composes* endpoint modules. It contains almost no business logic. It is the one file where "what runs, and in what order" is decided.
2. **The middleware pipeline** — a strict ordered chain. `UseAuthentication` → `UseAuthorization` → **tenancy seam** → **dashboard scope seam** → endpoints. Order is load-bearing: the seams *depend on* the authenticated principal already being on `ctx.User`.
3. **Endpoint modules (`Endpoints/*Endpoints.cs`)** — each area (`Catalog`, `Booking`, `Intake`, `Nps`, `Dashboard`, `FranchiseeDashboard`) is a static class exposing one `MapX(this WebApplication)` extension method. Handlers are minimal-API lambdas with DI parameters injected by position, gated with `.RequireAuthorization()` / `.AllowAnonymous()`.

The mental shortcut: **`Program.cs` decides ORDER and WIRING; the modules decide ROUTES and HANDLERS; the seam decides WHO YOU ARE.** Get the order wrong and the seam reads an empty principal — the whole tenancy guarantee silently fails open or fail-closed depending on which way it breaks.

---

## 2. Real code — the thin composition root

### DI registration (lifetimes are deliberate)

```csharp
// api/Program.cs:11-12
builder.Services.AddScoped<TenantContext>();
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(conn));
```

```csharp
// api/Program.cs:20
builder.Services.AddSingleton<IntakeService>();
```

```csharp
// api/Program.cs:28-29
builder.Services.AddSingleton<IDashboardReadModel, EfDashboardReadModel>();
builder.Services.AddScoped<DashboardScopeHolder>();
```

Lifetimes, and *why each is what it is*:

| Service | Lifetime | Why |
|---|---|---|
| `TenantContext` | **Scoped** | One per request. It is the *current caller's* tenant. A singleton would leak tenant A's identity into tenant B's request (a cross-tenant breach). A transient would give the seam-populated instance and the `AppDb`-injected instance two *different* objects. |
| `AppDb` (`AddDbContext`) | **Scoped** (default) | `DbContext` is not thread-safe and tracks per-request changes. Scoped matches the unit of work. It *consumes* the scoped `TenantContext` in its constructor — same lifetime, no captive dependency. |
| `DashboardScopeHolder` | **Scoped** | Mirrors `TenantContext`: holds the per-request RBAC allow-set. Per-request for the same reason. |
| `IntakeService` | **Singleton** | Stateless AI-intake helper with cap/latency config; safe to share, cheaper to keep one. |
| `IDashboardReadModel` → `EfDashboardReadModel` | **Singleton** | The corporate roll-up is *baked once on first resolution, after Seed + Recompute ran at boot* (Program.cs:22-28 comment). It is read-only reference data — a singleton is correct and avoids re-aggregating per request. |

The captive-dependency rule this respects: **a longer-lived service must never capture a shorter-lived one.** `AppDb` (scoped) capturing `TenantContext` (scoped) is fine. The danger would be the singleton `IntakeService` or `EfDashboardReadModel` ever taking a scoped `TenantContext` or `AppDb` in its constructor — that would freeze one request's state for the life of the app. It doesn't; that's why those stay singletons.

### Auth wiring (one line, real validation)

```csharp
// api/Program.cs:17
builder.Services.AddHfcAuth(builder.Configuration);
```

`AddHfcAuth` (in `api/Auth.cs:131-178`) registers JWT Bearer + the `Corporate` authorization policy. Prod uses Entra ID / B2C JWKS (RS256); local/test uses a symmetric dev key — **same validation rigor** (issuer, audience, lifetime, signing key all validated):

```csharp
// api/Auth.cs:156-165 (local/test branch)
o.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = true,
    ValidIssuer = AuthDefaults.Issuer,
    ValidateAudience = true,
    ValidAudience = audience,
    ValidateLifetime = true,
    ValidateIssuerSigningKey = true,
    IssuerSigningKey = AuthDefaults.DevKey(config["Auth:DevSigningKey"]),
};
```

```csharp
// api/Auth.cs:172-176 — the Corporate policy
services.AddAuthorization(options =>
{
    options.AddPolicy(HfcPolicies.Corporate, policy =>
        policy.RequireRole(HfcClaims.CorporateRole));
});
```

### Middleware ORDER — the load-bearing sequence

```csharp
// api/Program.cs:57-58
app.UseAuthentication();
app.UseAuthorization();
```

```csharp
// api/Program.cs:64-69 — THE TENANCY SEAM
app.Use(async (ctx, next) =>
{
    var tenant = ctx.RequestServices.GetRequiredService<TenantContext>();
    TenantResolver.Populate(tenant, ctx.User);
    await next();
});
```

```csharp
// api/Program.cs:77-83 — Dashboard RBAC scope seam
app.Use(async (ctx, next) =>
{
    var holder = ctx.RequestServices.GetRequiredService<DashboardScopeHolder>();
    var readModel = ctx.RequestServices.GetRequiredService<IDashboardReadModel>();
    holder.Scope = DashboardScopeResolver.ScopeFor(ctx.User, readModel);
    await next();
});
```

**Why this order is non-negotiable:** both seams read `ctx.User`. `ctx.User` is only a *validated* principal **after `UseAuthentication()` has run**. If the seam ran before authentication, `ctx.User` would be an unauthenticated/empty principal, `TenantResolver.Populate` would early-return (Auth.cs:64 `if (user?.Identity?.IsAuthenticated != true) return;`), `TenantContext.FranchiseeId` stays null, and the EF global query filter matches **zero rows** for every authenticated user. The seam sits *after* auth on purpose. `UseAuthorization()` must also precede the endpoints so `RequireAuthorization()` metadata is enforced.

`TenantResolver.Populate` is the entire seam — claims in, scoped state out, fail-closed:

```csharp
// api/Auth.cs:62-69
public static void Populate(TenantContext tenant, ClaimsPrincipal? user)
{
    if (user?.Identity?.IsAuthenticated != true) return;   // no identity → no tenant
    tenant.FranchiseeId = user.FindFirst(HfcClaims.FranchiseeId)?.Value;
    tenant.BrandId = user.FindFirst(HfcClaims.BrandId)?.Value;
}
```

And the filter that consumes it (the payoff of the scoped lifetime):

```csharp
// api/AppDb.cs:46-48
b.Entity<Territory>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<Slot>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<Appointment>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
```

(Full tenancy treatment in [[M1-multitenancy]].)

### Seed-on-boot block

```csharp
// api/Program.cs:48-55
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    Seed.Run(db);
    Rollup.Recompute(db);
}
```

This creates a **manual scope** because `AppDb` is scoped and there is no request scope at boot. It runs *before* the singleton `EfDashboardReadModel` is first resolved, so the read model bakes over already-seeded + already-rolled-up data. Note it sits **before** `UseAuthentication` in source order — startup data work happens during build, the pipeline runs per request afterward; that's fine because `Recompute` reads cross-tenant via `IgnoreQueryFilters()` (AppDb.cs:54 comment), not through the seam.

### Endpoint composition (the `app.MapX()` fan)

```csharp
// api/Program.cs:91-96
app.MapCatalog();              // /api/brands, /api/franchisees, dev token mint
app.MapBooking();              // /api/slots, /api/appointments (+ deposit)
app.MapIntake();               // /api/intake/parse
app.MapDashboard();            // D6–D9 corporate roll-up projections
app.MapNps();                  // /api/appointments/{id}/nps, /api/nps
app.MapFranchiseeDashboard();  // /api/dashboard, /api/dashboard/territories
```

```csharp
// api/Program.cs:100 — SPA fallback AFTER api routes
app.MapFallbackToFile("index.html");
```

---

## 3. Real code — endpoint modules (the `MapX(this WebApplication)` pattern)

Each module is a `static class` with one extension method. Example shapes:

```csharp
// api/Endpoints/CatalogEndpoints.cs:11-19
public static class CatalogEndpoints
{
    public static void MapCatalog(this WebApplication app)
    {
        app.MapGet("/api/brands", async (AppDb db) =>
            Results.Ok(await db.Brands.OrderBy(b => b.Name)
                .Select(b => new BrandDto(b.Id, b.Name, b.Tagline)).ToListAsync()))
            .AllowAnonymous();
```

Catalog is the deliberate **exception** to tenancy: untenanted lookups backing the login picker, explicitly `.AllowAnonymous()` (CatalogEndpoints.cs:19, 29, 56) — you must be able to *choose* an identity before you have one. The dev token mint is additionally gated to Development only:

```csharp
// api/Endpoints/CatalogEndpoints.cs:33-35
if (app.Environment.IsDevelopment())
{
    app.MapPost("/api/dev/token", async (DevTokenRequest req, AppDb db) =>
```

Booking is the canonical **auth-gated, tenant-scoped** module. Note DI by parameter position (`AppDb db, TenantContext t`) and `.RequireAuthorization()`:

```csharp
// api/Endpoints/BookingEndpoints.cs:38-42
app.MapPost("/api/appointments", async (BookRequest req, AppDb db, TenantContext t) =>
{
    var slot = await db.Slots.FirstOrDefaultAsync(s => s.Id == req.SlotId);
    if (slot is null) return Results.NotFound();   // not found OR not this tenant's
    if (slot.IsBooked) return Results.Conflict("Slot already booked.");
    // ...
}).RequireAuthorization();
```

The Dashboard module shows **policy-named** authorization — `RequireAuthorization("Corporate")` enforces the role policy, while franchisee-lens endpoints just require authentication and scope inside the handler:

```csharp
// api/Endpoints/Dashboard/DashboardEndpoints.cs:53
}).RequireAuthorization("Corporate");
```

```csharp
// api/Endpoints/Dashboard/DashboardEndpoints.cs:77
}).RequireAuthorization();   // authenticated; franchisee lens scopes to own (D10)
```

---

## 4. Request validation — where it lives here

This codebase validates **inline, fail-fast, returning RFC-7807 `Results.Problem`** rather than DataAnnotations/MVC model binding. Two real patterns:

Header precondition (deposit requires an idempotency key):

```csharp
// api/Endpoints/BookingEndpoints.cs:79-80
if (!http.Headers.TryGetValue("Idempotency-Key", out var key) || string.IsNullOrWhiteSpace(key))
    return Results.Problem(statusCode: 400, title: "Missing Idempotency-Key header.");
```

Domain-range validation (NPS score 0–10):

```csharp
// api/Endpoints/NpsEndpoints.cs:19-20
if (req.Score is < 0 or > 10)
    return Results.Problem(statusCode: 400, title: "NPS score must be 0–10.");
```

Plus **route-constraint validation** baked into the template — `{id:int}` rejects non-integer ids at routing time before the handler runs (BookingEndpoints.cs:76, NpsEndpoints.cs:16). And **concurrency/uniqueness validation** is pushed to the DB and caught as a typed exception → 409:

```csharp
// api/Endpoints/BookingEndpoints.cs:61-67
catch (DbUpdateConcurrencyException)  // someone booked this slot first
{
    return Results.Conflict("Slot was just booked by someone else.");
}
catch (DbUpdateException)              // unique-index race on SlotId
{
    return Results.Conflict("Slot already booked.");
}
```

Interview point: this is intentional. For a small surface, inline guards + `Results.Problem` keep validation *next to* the handler and read clearly. If the surface grew, the natural escalation is a validation library (FluentValidation) or an `IEndpointFilter` so the rule is declared once — see trade-offs.

---

## 5. HFC tie-in

HFC is a **multi-brand, multi-tenant franchise platform**: brand → region → territory, with a franchisor (corporate) read-down plane on top. The backend choices map directly:

- **Scoped `TenantContext` + seam-after-auth** is the spine of tenant isolation: a franchisee operator can only ever see/book its own slots, appointments, and NPS. The whole guarantee rides on one scoped object populated from a *verified* claim — never a header (Auth.cs:11-19 comment, "the single tenancy seam").
- **Two-axis identity** (`franchisee_id` = boundary, `brand_id` = grouping; AppDb.cs:10-11) is what lets the corporate roll-up aggregate by brand while franchisees stay isolated by franchisee.
- **The `Corporate` policy** (Auth.cs:172-176, used at DashboardEndpoints.cs:53/103/126) is HFC's franchisor read-down: a corporate token (role claim, no `franchisee_id`) sees the whole portfolio; a franchisee token is hard-scoped to its territories. RBAC and tenancy share *one principal* — adding the Track-2 roles is "one more claim read in `TenantResolver.Populate`", not new plumbing (Auth.cs:16-18 comment).
- **Endpoint modularization** is what lets parallel feature lanes (booking, dashboard, intake, NPS) ship without colliding in `Program.cs` — the franchise roadmap is built by multiple workstreams at once.

---

## 6. Trade-offs — minimal APIs vs controllers (when controllers win)

**Why minimal APIs here:**
- The surface is small and CRUD-shaped; a lambda per route is less ceremony than a controller class + action + attributes.
- Lower per-request overhead — no controller activation, no action invoker, no model-binder reflection on the hot path.
- DI-by-parameter reads cleanly (`(AppDb db, TenantContext t)`), and `.RequireAuthorization()` / `.AllowAnonymous()` is fluent and local to the route.
- Modularization via `MapX(this WebApplication)` gives the same "one file per area" organization controllers offer, *without* the framework weight — and keeps `Program.cs` a pure composer (the 298→104 refactor, §7).

**When controllers would win (be honest about this in the room):**
- **Large/complex surfaces** with many actions sharing filters, conventions, `[Authorize]` at class level, and model-state validation — controllers reduce repetition there.
- **Heavy declarative validation** — DataAnnotations + automatic `ModelState` 400s are first-class in MVC; in minimal APIs you do it inline (§4) or add an `IEndpointFilter`/FluentValidation.
- **Rich content negotiation / formatters**, `ApiController` conventions, `[ApiVersion]` tooling, and some OpenAPI generators are more mature against controllers.
- **Team familiarity / convention** — a large team standardized on MVC may move faster with controllers.

The honest framing: minimal APIs are the right default for a service this size; the moment cross-cutting validation/filters/versioning conventions dominate, controllers (or minimal APIs + endpoint filters + route groups) start to pay for themselves. Minimal APIs also support `MapGroup` + endpoint filters, which closes much of that gap without leaving the model.

---

## 7. The 298 → 104 line refactor (modularization)

Before: every route lived in `Program.cs` (~298 lines) — a single file every feature lane had to edit, so parallel work collided there constantly. After: `Program.cs` is **104 lines** of pure composition; each area moved to `api/Endpoints/*Endpoints.cs`.

The contract of the refactor (Program.cs:85-89 comment): **"Routes, verbs, auth, and DTOs are unchanged: these are the same registrations, relocated."** It was a *mechanical* extraction — no behavior change — which is exactly why it was safe and reviewable. The win:

- **Parallel-work safe:** a lane adds a route by extending its module, not editing the root, so merges don't collide in `Program.cs`.
- **Composition root stays thin:** the one file that controls *order and wiring* is small enough to reason about end-to-end.
- **The integration tests still pass unchanged** because `public partial class Program { }` (Program.cs:104) keeps the `WebApplicationFactory` entry point stable.

Pattern: each module is a `static class` + `static void MapX(this WebApplication app)`; `Program.cs` calls `app.MapX()` once per module (Program.cs:91-96).

---

## 8. Failure modes

1. **Middleware ordered wrong → tenant not resolved.** Move the tenancy seam *above* `app.UseAuthentication()` and `ctx.User` is not yet authenticated. `TenantResolver.Populate` early-returns (Auth.cs:64), `FranchiseeId` stays null, and the global query filter `x.FranchiseeId == null` matches nothing → every authenticated franchisee sees an empty app. (Worse variant: if you *also* trusted a header instead of the claim, wrong order could fail *open*.) Fix: seam strictly after auth, always.

2. **Captive dependency (DI lifetime mismatch).** If `IntakeService` or `EfDashboardReadModel` (both **singleton**) ever took a scoped `TenantContext` or `AppDb` in its constructor, the container would capture one request's scoped instance for the entire app lifetime — stale/cross-tenant state and `ObjectDisposedException`s. Default container validation in dev throws on this; in prod it can silently leak. The seam pattern (read scoped services via `ctx.RequestServices.GetRequiredService<>()` inside per-request middleware — Program.cs:66, 79-80) avoids capturing them in a singleton.

3. **`TenantContext` registered Singleton instead of Scoped.** Then *all* requests share one tenant object; whoever authenticated last wins → catastrophic cross-tenant data leak. This is the single most dangerous lifetime mistake in the codebase.

4. **`MapFallbackToFile` placed before the API routes.** The SPA catch-all would swallow `/api/*` and return `index.html` for API calls. It is deliberately last (Program.cs:100, after all `MapX`).

5. **Seed scope leak.** Resolving scoped `AppDb` at boot without `CreateScope()` throws (no ambient request scope). The `using (var scope = ...)` block (Program.cs:48) is required, and must run before the singleton read model is first resolved or the roll-up bakes over empty data.

6. **Missing `RequireAuthorization()` on a tenant endpoint.** A handler that forgets the gate is reachable anonymously; `ctx.User` is unauthenticated, the seam leaves `FranchiseeId` null, so it fail-closes to no rows *for tenant data* — but a *corporate* endpoint without the policy would default to the corporate lens and leak the whole portfolio (exactly the bug the Dashboard module's auth comment, DashboardEndpoints.cs:12-22, was added to close).

---

## 9. Interview defense — follow-ups + answers

**Q: Why a custom middleware seam instead of an `AuthorizationHandler` or claims transformation?**
A: The seam does *projection*, not authorization — it copies verified claims into a scoped, strongly-typed `TenantContext` that EF's global query filter reads. Authorization (`RequireAuthorization`, the `Corporate` policy) is separate and still does its job. Keeping the seam as one tiny middleware (Program.cs:64-69) makes the "identity → tenant" step a single, auditable place — Auth.cs literally calls itself "the single tenancy seam." `IClaimsTransformation` would also work, but the explicit middleware makes ordering relative to `UseAuthentication` visible in `Program.cs`, which is the whole point.

**Q: Why is `EfDashboardReadModel` a singleton if it touches EF / the database?**
A: Because it's baked **once** from already-seeded, already-rolled-up data at first resolution (after the boot block), and it's read-only reference data. It does not hold a live scoped `DbContext`; it materializes its projections up front. That's why singleton is safe and correct — and why the boot order (Seed → Recompute → first resolution) matters. If it ever needed live per-request data, it would have to become scoped or take a `DbContextFactory`.

**Q: `Program.cs` calls `app.MapDashboard()` and `app.MapFranchiseeDashboard()` — two dashboards?**
A: Yes, two planes. `MapDashboard` (Dashboard module) is the **corporate roll-up** (D6–D9, `Corporate` policy, portfolio aggregates). `MapFranchiseeDashboard` is the **operator's own-territory** view — authenticated, scoped to the token's franchisee by the EF filter, no header check (FranchiseeDashboardEndpoints.cs:5-10 comment). Same read-model interface, different lens.

**Q: How do you test that the seam actually fail-closes?**
A: `public partial class Program { }` (Program.cs:104) lets `WebApplicationFactory` boot the real pipeline in integration tests. A test mints a real dev token via `DevTokens.Mint` (the *same* path the app uses — Auth.cs:75-96, not a bypass), hits a tenant endpoint as franchisee A, asserts it cannot see franchisee B's rows, and hits with no token to assert empty/401. Because tests travel the genuine validation pipeline, they prove the real seam, not a stub.

---

## 10. Demo proof

- **Boot the API** and watch the order in `Program.cs`: CORS → Swagger → static files → seed/rollup scope → auth → authz → tenancy seam → scope seam → endpoints → SPA fallback.
- **Swagger UI** (`app.UseSwagger()/UseSwaggerUI()`, Program.cs:37-38) lists exactly the routes the `MapX` modules registered.
- **Mint a franchisee token** via `POST /api/dev/token` (dev-only, CatalogEndpoints.cs:33-56), call `GET /api/slots` (BookingEndpoints.cs:15) with and without the bearer token: with it you see only that franchisee's slots; without it, 401 (the `.RequireAuthorization()` gate).
- **Cross-tenant probe:** mint franchisee A's token, try to `GET /api/appointments` — you get A's rows only; the EF filter (AppDb.cs:46-48) makes B's rows invisible, proving the scoped `TenantContext` is doing its job.
- **Corporate vs franchisee lens:** mint `role=corporate` (CatalogEndpoints.cs:40-43) and hit `GET /api/dashboard/corporate` → 200; hit it with a franchisee token → 403 (DashboardEndpoints.cs:32-34 / `RequireAuthorization("Corporate")`).
- **Validation:** `POST /api/appointments/{id}/deposit` without `Idempotency-Key` → 400 Problem (BookingEndpoints.cs:79-80); `POST .../nps` with score 11 → 400 (NpsEndpoints.cs:19-20).

---

## Flashcards

1. **Q:** Why is `TenantContext` scoped, not singleton? **A:** One tenant per request. Singleton would share one caller's identity across all requests → cross-tenant leak. Scoped lets the seam populate it and `AppDb` read the *same* instance.

2. **Q:** Where in the pipeline does the tenancy seam run, and why there? **A:** Immediately after `UseAuthentication`/`UseAuthorization` (Program.cs:64). It reads `ctx.User`, which is only a validated principal after authentication.

3. **Q:** What happens if the seam ran *before* auth? **A:** `ctx.User` unauthenticated → `Populate` early-returns → `FranchiseeId` null → query filter matches zero rows → every user sees an empty app (fail-closed).

4. **Q:** Why is `EfDashboardReadModel` a singleton when it uses EF? **A:** It's baked once from seeded + rolled-up data at first resolution (after the boot block); read-only reference data, no live scoped DbContext captured.

5. **Q:** Define a captive dependency and give the one to avoid here. **A:** A longer-lived service capturing a shorter-lived one. Avoid: singleton `IntakeService`/`EfDashboardReadModel` taking scoped `TenantContext`/`AppDb` in its constructor.

6. **Q:** What does the 298→104 refactor change about behavior? **A:** Nothing — same routes/verbs/auth/DTOs, just relocated into `Endpoints/*Endpoints.cs`. It's mechanical extraction; `Program.cs` becomes a pure composer.

7. **Q:** What makes the modularization parallel-work safe? **A:** Lanes add routes by extending their module's `MapX`, not editing `Program.cs`, so merges don't collide in the root.

8. **Q:** Why must `MapFallbackToFile("index.html")` be last? **A:** It's the SPA catch-all; placed earlier it would swallow `/api/*` routes and return HTML for API calls.

9. **Q:** How is request validation done here vs MVC? **A:** Inline fail-fast guards returning `Results.Problem` (RFC-7807) + route constraints (`{id:int}`) + DB exception→409, not DataAnnotations/`ModelState`.

10. **Q:** Difference between `.RequireAuthorization()` and `.RequireAuthorization("Corporate")`? **A:** First requires any authenticated principal; second requires the `Corporate` role policy (franchisor read-down). Franchisee endpoints use the first + in-handler scope.

11. **Q:** Why keep `public partial class Program { }` at the end? **A:** Stable entry point for `WebApplicationFactory` integration tests so they exercise the real pipeline.

12. **Q:** When would controllers beat minimal APIs for HFC? **A:** Large surfaces with shared filters/conventions, heavy DataAnnotations validation, mature versioning/content-negotiation needs, or strong MVC team convention.

---

## Mock Q&A

**Q1. Walk me through your middleware pipeline and tell me which orderings are load-bearing.**
A: CORS → Swagger → default/static files → boot-time seed scope → `UseAuthentication` → `UseAuthorization` → tenancy seam → dashboard-scope seam → endpoint `MapX` calls → `MapFallbackToFile`. Two orderings are non-negotiable: (1) the seams must come *after* authentication because they read the validated `ctx.User`; (2) the SPA fallback must come *after* the API routes or it swallows them.
*Follow-up: what specifically breaks if a junior moves the seam above auth?* — `ctx.User.Identity.IsAuthenticated` is false, `TenantResolver.Populate` returns without setting `FranchiseeId`, the EF global filter compares against null, and authenticated users get zero rows. It fails closed, which is the "safe" failure — but it's still a total outage of tenant data, and if combined with header-trust it could fail *open*. So the rule is absolute: seam after auth.

**Q2. Justify your DI lifetimes. Where's the line you must not cross?**
A: `TenantContext`, `AppDb`, `DashboardScopeHolder` are scoped (per-request, per-tenant unit of work). `IntakeService` and `EfDashboardReadModel` are singletons (stateless / baked-once read-only). The line: a singleton must never capture a scoped service — that's a captive dependency that freezes one request's state forever and can leak across tenants. The read model gets away with singleton precisely because it materializes from already-rolled-up data and holds no live `DbContext`.
*Follow-up: the read model needs fresh data each request — now what?* — Make it scoped, or inject an `IDbContextFactory<AppDb>` so it creates a short-lived context per call, or recompute on a schedule into a new singleton snapshot and swap the reference. What you don't do is keep it singleton while reaching into a captured scoped `DbContext`.

**Q3. You chose minimal APIs. Defend it, then argue the other side.**
A: For this surface — small, CRUD-shaped, DI-by-parameter, fluent `.RequireAuthorization()` — minimal APIs are less ceremony and lower per-request overhead, and the `MapX(this WebApplication)` module pattern gives controller-like organization while keeping `Program.cs` a thin composer. The other side: controllers win when you have a large action surface sharing class-level filters/conventions, heavy DataAnnotations validation with automatic `ModelState` 400s, mature versioning/content-negotiation tooling, or a team standardized on MVC.
*Follow-up: validation is getting repetitive across endpoints — do you switch to controllers?* — Not necessarily. First reach for `MapGroup` + an `IEndpointFilter` (or FluentValidation) so the rule is declared once, staying in the minimal model. I'd only move to controllers if filters/conventions/versioning *dominate* the design, not for validation alone.

**Q4. How does this design make HFC's multi-tenant + RBAC requirements safe by construction?**
A: Identity becomes tenant in exactly one verified place — the seam reads claims the JWT pipeline already validated and projects them into scoped `TenantContext`; the EF global query filter then makes cross-tenant rows invisible everywhere, so a handler can't *forget* to scope. RBAC shares the same principal: the `Corporate` policy gates franchisor read-down endpoints, and the franchisee lens hard-scopes to its own territories. Tenancy is never a header — it's a signed claim — so a caller can't widen its own view.
*Follow-up: a new endpoint leaks cross-tenant data in code review — what's the most likely cause and your guardrail?* — Most likely it queried with `IgnoreQueryFilters()` or hit an entity with no `HasQueryFilter`. Guardrail: every tenant-owned entity must have the filter in `OnModelCreating`, `IgnoreQueryFilters` is allowed only in the boot rollup (which reads cross-tenant by design), and an integration test mints franchisee A's real token and asserts B's rows are invisible — so the leak fails CI, not production.

**Q5. The team wants to add five new RBAC roles. How much of this backend changes?**
A: Very little, by design. Roles live in the same verified principal, so role resolution is "one more `FindAll(ClaimTypes.Role)` line in `TenantResolver.Populate`" plus new named policies in `AddHfcAuth` and `.RequireAuthorization("<role>")` on the relevant endpoints. The scope resolver (`DashboardScopeResolver.ScopeFor`) was structured so adding roles is a claim read, not a rewrite of call sites. No new middleware, no second source of truth — that's the payoff of routing everything through the one seam.
*Follow-up: where would this design start to strain at, say, 20 roles with per-territory grants?* — Static named policies stop scaling; I'd move to a resource/permission model — policy-based authorization with an `IAuthorizationHandler` evaluating (principal, resource, action) against a grants table, and the scope allow-set sourced from that store rather than a single claim. The seam stays; what changes is that scope becomes data-driven instead of claim-derived.

---

### Summary
HFC's backend is a 104-line composition root that orders auth → tenancy seam → endpoints so a verified claim becomes a scoped `TenantContext` exactly once, with read routes fanned into `Endpoints/*Endpoints.cs` modules for parallel-safe work. Master the lifetime rules (scoped tenant, singleton baked read-model, no captive deps), the load-bearing middleware order (seam strictly after authentication, fallback last), and the minimal-vs-controllers trade-off, and you can defend every line at file:level.
