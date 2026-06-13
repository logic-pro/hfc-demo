# ASP.NET Core (Minimal APIs) — project notes & interview prep

## What it is

ASP.NET Core is Microsoft's cross-platform, high-performance web framework for building HTTP APIs, SPAs, and real-time services on .NET. Minimal APIs (introduced in .NET 6, refined through .NET 9) replace the MVC controller scaffold with a flat, lambda-based route registration style directly on `WebApplication`, eliminating most of the ceremony (no controllers, no action filters, no `[ApiController]`) while keeping the full middleware pipeline, DI container, and hosting model. The result is near-raw-HTTP performance with a very small cold-start footprint — well-suited to microservices and demo APIs alike.

## How it's used in the HFC demo

All API code lives in `api/Program.cs`. The startup sequence follows the builder/app split that is idiomatic for .NET 6+:

**Builder phase — service registration**

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddScoped<TenantContext>();
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(conn));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
```

`TenantContext` is registered as **Scoped** (one instance per HTTP request) so it can be populated by middleware and then injected into both `AppDb` and route handlers without any ambient-state tricks. `AppDb` is also Scoped (EF Core's default) and receives the same `TenantContext` instance via constructor injection — this is how the global query filters in `api/AppDb.cs` close over the current tenant:

```csharp
b.Entity<Slot>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
```

With no tenant set, `_tenant.BrandId` is `null`, so EF compares against null and returns zero rows — fail-closed, never cross-tenant.

**App phase — middleware pipeline**

```csharp
var app = builder.Build();
app.UseCors();
app.UseSwagger();
app.UseSwaggerUI();
app.UseDefaultFiles();
app.UseStaticFiles();
// ... seed ...
app.Use(async (ctx, next) => { /* tenant resolution */ });
// ... MapGet/MapPost ...
app.MapFallbackToFile("index.html");
app.Run();
```

Order matters. `UseCors()` runs before any response body is written. `UseDefaultFiles()` must precede `UseStaticFiles()` (it rewrites `/` → `/index.html`). Static file middleware runs before the tenant middleware to avoid tenant-resolution overhead on every asset request. `MapFallbackToFile("index.html")` is registered after all `Map*` calls so the Angular client-side router handles deep links that are not API routes and not physical files.

**Tenant-resolution middleware**

An inline `app.Use(...)` lambda reads the `X-Tenant-Id` request header and writes it into the scoped `TenantContext`:

```csharp
app.Use(async (ctx, next) => {
    var tenant = ctx.RequestServices.GetRequiredService<TenantContext>();
    if (ctx.Request.Headers.TryGetValue("X-Tenant-Id", out var t))
        tenant.BrandId = t.ToString();
    await next();
});
```

This mirrors production patterns where the tenant is resolved from a JWT claim or subdomain before any handler runs. Because `TenantContext` is Scoped, the value flows through DI to `AppDb` automatically — no thread-local or AsyncLocal state needed.

**Minimal API handlers**

Route handlers are registered with `MapGet`/`MapPost`. Parameters are bound from the route template, query string, or request body (JSON) automatically by the framework:

```csharp
app.MapPost("/api/appointments", async (BookRequest req, AppDb db, TenantContext t) => { ... });
```

`BookRequest` is a C# `record` (`api/Domain.cs`); the framework deserializes the JSON body into it with no `[FromBody]` attribute needed. `AppDb` and `TenantContext` are injected from DI. Return values use `IResult` via `Results.*` factory methods: `Results.Ok(...)`, `Results.Created(...)`, `Results.NotFound()`, `Results.Conflict(...)`, `Results.Problem(...)`.

**SPA hosting**

The Angular production build is copied into `api/wwwroot` at deploy time. `UseDefaultFiles` + `UseStaticFiles` serves the bundle; `MapFallbackToFile("index.html")` catches any unmatched route and returns the shell. This same-origin strategy means the SPA's API base is just `/api/...` in production — no CORS hop, no separate Azure Static Web Apps resource needed.

**Swagger**

`AddEndpointsApiExplorer()` + `AddSwaggerGen()` + `UseSwagger()` + `UseSwaggerUI()` wire the OpenAPI UI at `/swagger` with zero additional config. Route metadata (`Results.*` return types, record-typed parameters) is inferred automatically.

## Why we chose it (and the alternatives)

**Minimal APIs vs MVC controllers**

| | Minimal APIs | MVC Controllers |
|---|---|---|
| Boilerplate | Near zero | Controller class, action methods, routing attributes |
| Startup cost | Lower | Higher (reflection-heavy) |
| Filter pipeline | Manual middleware or endpoint filters | Rich `IActionFilter`, `IAsyncActionFilter` |
| Model validation | Must be wired explicitly | `[ApiController]` runs it automatically |
| Test surface | `WebApplicationFactory<Program>` | Same |
| Best for | Small-to-medium APIs, microservices, demos | Large teams with cross-cutting filter logic |

For the HFC demo — a focused interview artifact with ~6 endpoints — Minimal APIs keep the entire server in one readable file (`api/Program.cs`) with no scaffolding noise. There is no reason for the overhead of controller classes here.

**DI lifetimes — why TenantContext is Scoped**

- **Singleton**: one instance for the app lifetime. Cannot hold per-request state. Injecting a Scoped service into a Singleton causes a runtime captive-dependency exception.
- **Scoped**: one instance per DI scope, which for web requests is one per HTTP request. Correct for `TenantContext` (tenant identity lives for one request) and for `DbContext` (EF expects one context per unit of work).
- **Transient**: new instance every injection. Wasteful for `DbContext` (creates a new connection each time) and wrong for `TenantContext` (the middleware and the handler would see different instances).

`AppDb` takes `TenantContext` in its constructor. Both must be Scoped so they share the same DI scope — the same `TenantContext` instance the middleware wrote to is the one `AppDb` reads in its query filter. This is the key multi-tenancy correctness point.

## Core concepts to nail

**Request pipeline / middleware ordering**

Middleware runs in registration order for requests (in reverse for responses). Critically: routing (`UseRouting`) resolves the endpoint metadata; authorization (`UseAuthorization`) reads it; these must be in the right order. For Minimal APIs, `MapGet`/`MapPost` implicitly call `UseRouting`/`UseEndpoints` in .NET 7+. Inserting middleware _after_ `app.Map*` calls but _before_ `app.Run()` will not catch routed requests — tenant middleware must be before the Map calls, not after.

**DI lifetimes**

Singleton > Scoped > Transient. A shorter-lived service must never be injected into a longer-lived one (captive dependency). EF `DbContext` must always be Scoped, never Singleton. Use `IServiceScopeFactory.CreateScope()` to resolve Scoped services from Singleton code (like the seed block at startup).

**Minimal API vs controllers**

Know both. Controllers bring `[ApiController]`, model state validation, `[Authorize]`, and the full filter pipeline. Minimal APIs offer endpoint filters (`AddEndpointFilter`) as the equivalent of action filters. Performance is similar; the real difference is team convention and cross-cutting concerns.

**Model binding**

In Minimal APIs: route values by template name, query-string params by parameter name, JSON body by having a complex type not mapped to a route/query param. No attribute is required unless you need to override the source (`[FromQuery]`, `[FromRoute]`, `[FromHeader]`, `[FromBody]`, `[AsParameters]`). Record types bind from JSON body by default.

**Results / status codes**

`Results.Ok(value)` → 200, `Results.Created(uri, value)` → 201, `Results.NotFound()` → 404, `Results.Conflict(message)` → 409, `Results.Problem(...)` → RFC 7807 `application/problem+json`. The `IResult` return type lets you mix status codes in one handler; the compiler does not enforce that all paths return the same type.

**Hosting model**

`WebApplication.CreateBuilder(args)` wires the Kestrel server, configuration sources (appsettings.json, appsettings.{Environment}.json, environment variables, command-line args, `launchSettings.json`), and DI. The app can be hosted in-process in IIS, behind a reverse proxy (nginx/YARP), or directly on Kestrel. On Azure App Service Linux, Kestrel runs directly.

**Config / appsettings**

`builder.Configuration.GetConnectionString("Default")` reads from the `ConnectionStrings` section. Environment-specific overrides come from `appsettings.Production.json` or environment variables (e.g. `ConnectionStrings__Default`). On Azure App Service, connection strings set in the portal appear as environment variables with the correct prefix.

**Async all the way**

Every I/O operation in the demo is `async`/`await`. EF Core provides async counterparts for all query operations (`ToListAsync`, `FirstOrDefaultAsync`, `SaveChangesAsync`). Mixing sync EF calls in an async handler blocks thread-pool threads and kills throughput under load. `ConfigureAwait(false)` is generally not needed in ASP.NET Core because there is no synchronization context; the runtime handles continuation scheduling correctly.

## Gotchas we actually hit

**`dotnet run --urls` ignored because of `launchSettings.json`**

Running `dotnet run --urls http://localhost:5180` silently booted on port 5171 because `Properties/launchSettings.json` had an `applicationUrl` that took precedence. The fix is `--no-launch-profile`:

```bash
dotnet run --no-build --no-launch-profile --urls http://localhost:5180
```

Always use `--no-launch-profile` in scripts and CI to guarantee the URL. This is a frequent silent failure mode — the API boots, appears healthy, and the client just cannot connect.

**Two API processes over one SQLite file → `SQLite Error 10: disk I/O error`**

SQLite's WAL mode does not tolerate two writers holding the file simultaneously. If a previous `dotnet run` was not fully killed, the second instance failed on `EnsureCreated` / first query with a disk I/O error. Fix: confirm the port is clear (`ss -ltnp | grep :5180`), kill by PID (not process name — see below), and delete stale `-wal`/`-shm` files.

**`pkill -f api.dll` misses the running process**

The `dotnet run` process renames itself to `api` (the assembly name), not `api.dll`. `pkill -f api.dll` matches nothing and silently succeeds. Kill with:

```bash
ss -ltnp | grep :5180      # get PID
kill -9 <PID>
# or
pkill -9 -x api
```

**Angular `public/` assets snapshot at `ng serve` startup**

`ng serve` snapshots the `public/` directory when it starts. Adding `public/api-base.js` after the dev server is already running results in 404s on that file (and a browser MIME error from the `<script>` tag pointing at it). Always restart `ng serve` after creating files in `public/`.

**`MapFallbackToFile` must be the last route registered**

Registering `app.MapFallbackToFile("index.html")` before the `Map*` API routes causes the fallback to win on API paths (returns HTML instead of JSON). It must follow all `MapGet`/`MapPost` calls. In the demo this is correct — it is the last statement before `app.Run()`.

**EF global query filter with null tenant is fail-closed by design**

If the `X-Tenant-Id` header is absent, `TenantContext.BrandId` remains `null`. The query filter `x.BrandId == _tenant.BrandId` translates to `WHERE BrandId = NULL`, which matches no rows in SQL. This is intentional — no tenant set means no data visible. Handlers that need a tenant call `NeedTenant()` and return 400 early; the EF filter is a second layer of defense.

## Interview Q&A

**Q1: What is the ASP.NET Core request pipeline and why does middleware order matter?**

The pipeline is a chain of middleware components, each receiving an `HttpContext` and a `next` delegate. Each component can do work before calling `next()` (request path), after (response path), or short-circuit by not calling `next`. Order is critical: `UseCors()` must run before any handler writes response headers; `UseAuthentication()` must run before `UseAuthorization()` which must run before endpoints. In our demo, `UseStaticFiles()` runs before the tenant middleware so asset requests never incur tenant-resolution overhead, and `MapFallbackToFile` is last so API routes take priority over the SPA fallback.

**Q2: Explain DI lifetimes and when a captive dependency occurs.**

Singleton lives for the app lifetime, Scoped for one request, Transient for one injection. A captive dependency is when a longer-lived service holds a reference to a shorter-lived one — e.g., a Singleton injecting a Scoped service. The Scoped instance is created once (at Singleton construction) and never replaced, defeating its per-request contract. In the HFC demo, `TenantContext` and `AppDb` are both Scoped. If either were Singleton, the tenant resolved for request 1 would leak into request 2.

**Q3: How does the multi-tenant global query filter work and why is it fail-closed?**

`AppDb.OnModelCreating` calls `HasQueryFilter` on each tenant-scoped entity with a lambda that captures `_tenant` (the injected `TenantContext`). EF appends this predicate to every LINQ query against those tables — including joins and navigation properties — without callers needing to remember it. Because the lambda references the instance field `_tenant.BrandId`, and because `_tenant` is the same Scoped instance populated by the middleware, the filter automatically reflects the current request's tenant. When no header is present, `BrandId` is `null` and the SQL `WHERE BrandId = NULL` returns no rows — the filter is fail-closed, never cross-tenant.

**Q4: How does the optimistic concurrency slot-booking work end-to-end?**

`Slot.Version` is an `int` marked as `IsConcurrencyToken` in `AppDb.OnModelCreating`. When a booking handler loads a slot, EF stores the original `Version` value. The handler increments `Version` and calls `SaveChangesAsync()`. EF issues an `UPDATE Slot SET IsBooked=1, Version=@new WHERE Id=@id AND Version=@original`. If a concurrent request already committed (bumping the version), the `WHERE` matches zero rows, and EF throws `DbUpdateConcurrencyException`. The handler catches this and returns `Results.Conflict(...)` (HTTP 409). A unique index on `Appointment.SlotId` is a second layer catching the race if the concurrency token somehow misses it.

**Q5: How does Minimal API model binding differ from MVC model binding?**

In Minimal APIs the framework infers the binding source from the parameter type and route template: primitive types whose name matches a route segment come from the route; otherwise they come from the query string. Complex types (classes/records) that are not in the route template are deserialized from the JSON body — no `[FromBody]` needed. Explicit overrides (`[FromQuery]`, `[FromHeader]`, `[FromRoute]`, `[FromBody]`, `[AsParameters]`) are available. In MVC, `[ApiController]` adds automatic model-state validation before the action runs; in Minimal APIs you must validate manually or add an endpoint filter.

**Q6: How is the SPA served from the same origin as the API and why does that matter?**

At deploy time, the Angular production build is placed in `api/wwwroot`. `UseDefaultFiles()` rewrites `/` to `/index.html`, `UseStaticFiles()` serves the bundle, and `MapFallbackToFile("index.html")` catches deep links. Because the SPA and API share the same App Service hostname, the SPA can use relative paths (`/api/...`) with no CORS preflight. In development, the SPA runs on `:4200` and the API on `:5180`, so CORS is wide-open (`AllowAnyOrigin`). In production there is no cross-origin request, so the CORS policy is only exercised in dev — a clean separation.

**Q7: How does the idempotency-key pattern prevent double charges?**

The deposit endpoint (`MapPost /api/appointments/{id}/deposit`) requires an `Idempotency-Key` header. On first call, the handler stores the key in `Appointment.DepositKey`. On a retry (network failure, timeout), the handler finds `DepositKey` is already set and returns the existing appointment without re-applying the charge. If a different key arrives after payment was settled, it also returns the current state — the payment is already final. This mirrors Stripe's idempotency-key pattern and means clients can safely retry without risk of double-charging.

**Q8: Why use `Results.Problem(...)` instead of just returning a plain 400?**

`Results.Problem` generates an `application/problem+json` response conforming to RFC 7807 (Problem Details for HTTP APIs). It includes a machine-readable `status`, human-readable `title`, and optional `detail` and `instance` fields. Clients and API gateways can parse problem details reliably across services. Returning a plain string or custom JSON with a 400 works but is not interoperable. In ASP.NET Core 9, `Problem Details` support is also integrated with the exception handler middleware (`AddProblemDetails`) for unhandled exceptions.

**Q9: What is the difference between `UseStaticFiles` and `MapFallbackToFile`, and what breaks if you swap their order or omit one?**

`UseStaticFiles` is middleware — it intercepts requests for physical files in `wwwroot` early in the pipeline (before routing) and returns them directly, bypassing all route handlers. `MapFallbackToFile` is a routed endpoint — it matches any request that no other endpoint matched and returns the specified file. If `UseStaticFiles` is omitted, `.js`/`.css`/`.png` requests fall through to the router, hit the fallback, and return `index.html` with a 200 — the browser will reject JS parsed as HTML. If `MapFallbackToFile` is omitted, Angular client-side routes (e.g. `/appointments/5`) return 404 instead of the shell. The correct order is `UseDefaultFiles` → `UseStaticFiles` → all `Map*` API routes → `MapFallbackToFile`.

**Q10: How do you test a Minimal API without spinning up a real HTTP server?**

Use `WebApplicationFactory<Program>` from `Microsoft.AspNetCore.Mvc.Testing`. It creates an in-process test server backed by the real `Program` registration; no TCP port is allocated. The `public partial class Program {}` declaration at the bottom of `api/Program.cs` makes `Program` accessible to the test assembly. Tests create an `HttpClient` from the factory and call the API as they would in production, but with in-memory transport. You can override services in the factory's `ConfigureWebHost` (e.g., swap SQLite for an in-memory provider, replace `TenantContext` with a fixed tenant, or mock downstream HTTP clients).
