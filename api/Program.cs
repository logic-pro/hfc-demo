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

// Dashboard read model (corporate roll-up plane). EF-backed: reads Alpha's
// materialized `territory_period_summary` + `watchlist_flag` (CONTRACT §1) behind
// the IDashboardReadModel seam — same interface, no DTO/shape change vs the stub.
// Singleton: baked once on first resolution, after Seed + RecomputeRollup have run
// in the startup block below. (StubDashboardReadModel stays as the in-memory
// reference/fallback; flip this one line back to it to run without a DB.)
builder.Services.AddSingleton<IDashboardReadModel, EfDashboardReadModel>();
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
    // Build the corporate read model from the seeded operational/reported planes.
    // One on-demand/boot rebuild (CONTRACT clock decision); idempotent full rebuild.
    Rollup.Recompute(db);
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
// Each area is a self-contained module (api/Endpoints/*Endpoints.cs); this root
// only composes them. Lanes add endpoints by extending the relevant module — not
// by editing this file — so parallel work no longer collides here. Routes, verbs,
// auth, and DTOs are unchanged: these are the same registrations, relocated.

app.MapCatalog();              // /api/brands, /api/franchisees, dev token mint
app.MapBooking();              // /api/slots, /api/appointments (+ deposit)
app.MapIntake();               // /api/intake/parse
app.MapDashboard();            // D6–D9 corporate roll-up projections
app.MapNps();                  // /api/appointments/{id}/nps, /api/nps
app.MapFranchiseeDashboard();  // /api/dashboard, /api/dashboard/territories

// SPA fallback: any non-API, non-file route serves index.html so Angular's
// client-side router can take over. Excludes /api and /swagger.
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program { }          // for WebApplicationFactory integration tests
