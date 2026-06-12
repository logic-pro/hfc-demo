using HfcDemo;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// SQLite for zero-setup local runs. In Azure this connection string is
// swapped for Azure SQL via managed identity (see infra/ and DEPLOY notes).
var conn = builder.Configuration.GetConnectionString("Default")
           ?? "Data Source=hfc-demo.db";
builder.Services.AddScoped<TenantContext>();
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(conn));
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

// ── Tenant middleware: resolve X-Tenant-Id into the scoped TenantContext ─────
// Mirrors how a real multi-tenant API resolves the tenant (header / subdomain /
// token claim) before any handler runs.
app.Use(async (ctx, next) =>
{
    var tenant = ctx.RequestServices.GetRequiredService<TenantContext>();
    if (ctx.Request.Headers.TryGetValue("X-Tenant-Id", out var t))
        tenant.BrandId = t.ToString();
    await next();
});

static IResult NeedTenant() =>
    Results.Problem(statusCode: 400, title: "Missing X-Tenant-Id header (pick a brand first).");

// ── Endpoints ────────────────────────────────────────────────────────────────

// Brand catalog — not tenant-filtered; this is how a client picks its tenant.
app.MapGet("/api/brands", async (AppDb db) =>
    Results.Ok(await db.Brands.OrderBy(b => b.Name)
        .Select(b => new BrandDto(b.Id, b.Name, b.Tagline)).ToListAsync()));

// Open slots for the current tenant.
app.MapGet("/api/slots", async (AppDb db, TenantContext t) =>
{
    if (t.BrandId is null) return NeedTenant();
    var slots = await db.Slots
        .Join(db.Territories, s => s.TerritoryId, te => te.Id, (s, te) => new { s, te })
        .OrderBy(x => x.s.StartUtc)
        .Select(x => new SlotDto(x.s.Id, x.te.Id, x.te.Name, x.s.StartUtc, x.s.IsBooked))
        .ToListAsync();
    return Results.Ok(slots);
});

// Appointments for the current tenant.
app.MapGet("/api/appointments", async (AppDb db, TenantContext t) =>
{
    if (t.BrandId is null) return NeedTenant();
    var appts = await db.Appointments.OrderBy(a => a.StartUtc)
        .Select(a => new AppointmentDto(a.Id, a.TerritoryId, a.StartUtc, a.CustomerName,
            a.Service, a.DepositCents, a.DepositKey != null))
        .ToListAsync();
    return Results.Ok(appts);
});

// Book a slot. Optimistic concurrency on Slot.Version means two racing
// bookings can't both win — the loser gets 409.
app.MapPost("/api/appointments", async (BookRequest req, AppDb db, TenantContext t) =>
{
    if (t.BrandId is null) return NeedTenant();
    var slot = await db.Slots.FirstOrDefaultAsync(s => s.Id == req.SlotId);
    if (slot is null) return Results.NotFound();
    if (slot.IsBooked) return Results.Conflict("Slot already booked.");

    slot.IsBooked = true;
    slot.Version++;                       // bump the concurrency token
    var appt = new Appointment
    {
        BrandId = t.BrandId!,
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
});

// Pay a deposit. Idempotent: a retry with the same Idempotency-Key never
// double-charges — it returns the already-applied result.
app.MapPost("/api/appointments/{id:int}/deposit",
    async (int id, DepositRequest req, HttpRequest http, AppDb db, TenantContext t) =>
{
    if (t.BrandId is null) return NeedTenant();
    if (!http.Headers.TryGetValue("Idempotency-Key", out var key) || string.IsNullOrWhiteSpace(key))
        return Results.Problem(statusCode: 400, title: "Missing Idempotency-Key header.");

    var appt = await db.Appointments.FirstOrDefaultAsync(a => a.Id == id);
    if (appt is null) return Results.NotFound();

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
});

// SPA fallback: any non-API, non-file route serves index.html so Angular's
// client-side router can take over. Excludes /api and /swagger.
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program { }          // for potential WebApplicationFactory tests
