using HfcDemo;
using HfcDemo.Dashboard;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// SQLite for zero-setup local runs. In Azure this connection string is
// swapped for Azure SQL via managed identity (see infra/ and DEPLOY notes).
var conn = builder.Configuration.GetConnectionString("Default")
           ?? "Data Source=hfc-demo.db";
builder.Services.AddScoped<TenantContext>();
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(conn));

// AuthN/AuthZ: tenant comes from a VERIFIED token claim, never a header.
// Prod = Entra ID / Azure AD B2C (Auth:Authority); local/test = symmetric dev
// key — same validation rigor. See Auth.cs (the single tenancy seam).
builder.Services.AddHfcAuth(builder.Configuration);

// AI-assisted structured intake (free text -> typed, human-verifiable draft).
builder.Services.AddSingleton<IntakeService>();

// Dashboard read model (corporate roll-up plane). In-memory STUB shaped like
// CONTRACT §1 today; swap for an EF-backed IDashboardReadModel over Alpha's
// `territory_period_summary` when D2/D3 land — same interface, no shape change.
// Singleton: the data is baked once at boot (the RecomputeRollup stand-in).
builder.Services.AddSingleton<IDashboardReadModel, StubDashboardReadModel>();
builder.Services.AddScoped<DashboardScopeHolder>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseCors();
app.UseSwagger();
app.UseSwaggerUI();

// Serve the Angular SPA from wwwroot (the prod build is copied here at deploy
// time). Same-origin hosting means the SPA's API base is just "" -> /api/...,
// so there's no CORS hop in production. SPA client-side routes fall back to
// index.html (added after the API routes are mapped, below).
app.UseDefaultFiles();
app.UseStaticFiles();

// ── Seed on startup (idempotent) ────────────────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    Seed.Run(db);
}

app.UseAuthentication();
app.UseAuthorization();

// ── Tenancy seam: resolve the VERIFIED principal into the scoped TenantContext.
// Runs after authentication so ctx.User is already validated. This is the one
// place the identity becomes the tenant — fail-closed (no claim → no tenant →
// no rows via the EF global query filter). Header-based tenancy is gone.
app.Use(async (ctx, next) =>
{
    var tenant = ctx.RequestServices.GetRequiredService<TenantContext>();
    TenantResolver.Populate(tenant, ctx.User);
    await next();
});

// ── Dashboard RBAC scope (D10): resolve role → allowed territory ids ─────────
// Resolved per request and filtered BEFORE any read-model query. Sourced from the
// VERIFIED token claim on ctx.User (Slice A's seam) — never a client header; runs
// after UseAuthentication so the principal is validated. Default lens is
// `corporate` (all); a `franchisee_id` claim fail-closes the caller to its own
// territories. (Rewired header → claim per INTEGRATION.md #1.)
app.Use(async (ctx, next) =>
{
    var holder = ctx.RequestServices.GetRequiredService<DashboardScopeHolder>();
    var readModel = ctx.RequestServices.GetRequiredService<IDashboardReadModel>();
    holder.Scope = DashboardScopeResolver.ScopeFor(ctx.User, readModel);
    await next();
});

// ── Endpoints ────────────────────────────────────────────────────────────────

// Brand catalog — not tenant-filtered; a grouping over franchisees.
app.MapGet("/api/brands", async (AppDb db) =>
    Results.Ok(await db.Brands.OrderBy(b => b.Name)
        .Select(b => new BrandDto(b.Id, b.Name, b.Tagline)).ToListAsync()))
    .AllowAnonymous();

// Franchisee catalog — untenanted. In production the franchisees a user may act
// as come from their identity; here this list backs the demo's login picker.
app.MapGet("/api/franchisees", async (AppDb db) =>
    Results.Ok(await db.Franchisees
        .Join(db.Brands, f => f.BrandId, br => br.Id, (f, br) => new { f, br })
        .OrderBy(x => x.br.Name).ThenBy(x => x.f.Region)
        .Select(x => new FranchiseeDto(x.f.Id, x.f.BrandId, x.br.Name, x.f.Name, x.f.Region))
        .ToListAsync()))
    .AllowAnonymous();

// Dev-only: exchange a franchisee selection for a signed token (stands in for a
// B2C / Entra login). Gated to Development so it never ships a token mint to prod.
if (app.Environment.IsDevelopment())
{
    app.MapPost("/api/dev/token", async (DevTokenRequest req, AppDb db) =>
    {
        var f = await db.Franchisees.FirstOrDefaultAsync(x => x.Id == req.FranchiseeId);
        if (f is null) return Results.NotFound("Unknown franchisee.");
        var token = DevTokens.Mint(f.Id, f.BrandId,
            signingKey: builder.Configuration["Auth:DevSigningKey"]);
        return Results.Ok(new DevTokenResponse(token, f.Id, f.BrandId));
    }).AllowAnonymous();
}

// Open slots for the current tenant (resolved franchisee).
app.MapGet("/api/slots", async (AppDb db) =>
{
    var slots = await db.Slots
        .Join(db.Territories, s => s.TerritoryId, te => te.Id, (s, te) => new { s, te })
        .OrderBy(x => x.s.StartUtc)
        .Select(x => new SlotDto(x.s.Id, x.te.Id, x.te.Name, x.s.StartUtc, x.s.IsBooked))
        .ToListAsync();
    return Results.Ok(slots);
}).RequireAuthorization();

// Appointments for the current tenant.
app.MapGet("/api/appointments", async (AppDb db) =>
{
    var appts = await db.Appointments.OrderBy(a => a.StartUtc)
        .Select(a => new AppointmentDto(a.Id, a.TerritoryId, a.StartUtc, a.CustomerName,
            a.Service, a.DepositCents, a.DepositKey != null))
        .ToListAsync();
    return Results.Ok(appts);
}).RequireAuthorization();

// Book a slot. Optimistic concurrency on Slot.Version means two racing
// bookings can't both win — the loser gets 409. The slot is read through the
// tenant filter, so a franchisee can only book its own slots.
app.MapPost("/api/appointments", async (BookRequest req, AppDb db, TenantContext t) =>
{
    var slot = await db.Slots.FirstOrDefaultAsync(s => s.Id == req.SlotId);
    if (slot is null) return Results.NotFound();   // not found OR not this tenant's
    if (slot.IsBooked) return Results.Conflict("Slot already booked.");

    slot.IsBooked = true;
    slot.Version++;                       // bump the concurrency token
    var appt = new Appointment
    {
        FranchiseeId = slot.FranchiseeId,
        BrandId = slot.BrandId,
        TerritoryId = slot.TerritoryId,
        SlotId = slot.Id,
        StartUtc = slot.StartUtc,
        CustomerName = req.CustomerName,
        Service = req.Service,
    };
    db.Appointments.Add(appt);
    try
    {
        await db.SaveChangesAsync();
    }
    catch (DbUpdateConcurrencyException)  // someone booked this slot first
    {
        return Results.Conflict("Slot was just booked by someone else.");
    }
    catch (DbUpdateException)              // unique-index race on SlotId
    {
        return Results.Conflict("Slot already booked.");
    }
    return Results.Created($"/api/appointments/{appt.Id}",
        new AppointmentDto(appt.Id, appt.TerritoryId, appt.StartUtc, appt.CustomerName,
            appt.Service, appt.DepositCents, false));
}).RequireAuthorization();

// Pay a deposit. Idempotent: a retry with the same Idempotency-Key never
// double-charges — it returns the already-applied result.
app.MapPost("/api/appointments/{id:int}/deposit",
    async (int id, DepositRequest req, HttpRequest http, AppDb db) =>
{
    if (!http.Headers.TryGetValue("Idempotency-Key", out var key) || string.IsNullOrWhiteSpace(key))
        return Results.Problem(statusCode: 400, title: "Missing Idempotency-Key header.");

    var appt = await db.Appointments.FirstOrDefaultAsync(a => a.Id == id);
    if (appt is null) return Results.NotFound();   // not found OR not this tenant's

    if (appt.DepositKey is not null)       // already paid
    {
        // Same key => safe retry; different key => the deposit is already settled.
        return Results.Ok(new AppointmentDto(appt.Id, appt.TerritoryId, appt.StartUtc,
            appt.CustomerName, appt.Service, appt.DepositCents, true));
    }

    appt.DepositCents = req.AmountCents;
    appt.DepositKey = key.ToString();
    await db.SaveChangesAsync();
    return Results.Ok(new AppointmentDto(appt.Id, appt.TerritoryId, appt.StartUtc,
        appt.CustomerName, appt.Service, appt.DepositCents, true));
}).RequireAuthorization();

// AI-assisted structured intake: turn the customer's free-text request into a
// TYPED draft the agent can review and edit before booking. Tenant-scoped so the
// extractor maps onto the current brand's service vocabulary. Spend/latency are
// capped inside the service, and any failure degrades to a local heuristic — so
// this endpoint always returns a usable draft (never 5xx on a model hiccup).
app.MapPost("/api/intake/parse", async (IntakeRequest req, IntakeService intake, TenantContext t, CancellationToken ct) =>
{
    var draft = await intake.ParseAsync(req.Text, t.BrandId, ct);
    return Results.Ok(draft);
}).RequireAuthorization();

// ── Dashboard endpoints (D6–D9): read-only projections over the read model ──
app.MapDashboard();

// SPA fallback: any non-API, non-file route serves index.html so Angular's
// client-side router can take over. Excludes /api and /swagger.
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program { }          // for WebApplicationFactory integration tests
