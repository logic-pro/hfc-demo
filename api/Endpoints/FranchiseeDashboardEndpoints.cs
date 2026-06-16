using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// ── Franchisee Operations dashboard read-model (Slice D) ─────────────────────
// Pre-shaped read model; the SPA only formats/filters/drills. Tenant-scoped by the
// EF global query filter, auth-gated so RequireAuthorization fail-closes the caller
// to the token's franchisee (Slice A) — no header check. See DashboardReadModel +
// web/.../API-CONTRACT.md. (Distinct from the corporate roll-up plane in
// DashboardEndpoints.MapDashboard — this is the operator's own-territory view.)
public static class FranchiseeDashboardEndpoints
{
    public static void MapFranchiseeDashboard(this WebApplication app)
    {
        // Franchisee operator dashboard — the EF query filter scopes to the token's
        // franchisee (Slice A). No header check: RequireAuthorization fail-closes.
        app.MapGet("/api/dashboard", async (string? period, int? territoryId, AppDb db, TenantContext t) =>
        {
            // Reject an unknown ?period= (e.g. GARBAGE, LTM) with 400 rather than
            // silently falling back to MTD. Documented set: WTD|MTD|QTD|YTD.
            if (!PeriodRange.IsValid(period))
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["period"] = new[] { "period must be one of WTD, MTD, QTD, YTD." },
                });

            var vm = await DashboardReadModel.BuildAsync(db, t, period ?? "MTD", territoryId, DateTime.UtcNow);
            return Results.Ok(vm);
        }).RequireAuthorization();

        // Territories in the franchisee's brand — populates the dashboard filter.
        app.MapGet("/api/dashboard/territories", async (AppDb db, TenantContext t) =>
        {
            var list = await db.Territories.OrderBy(x => x.Name)
                .Select(x => new TerritoryRef(x.Id, x.Name)).ToListAsync();
            return Results.Ok(list);
        }).RequireAuthorization();
    }
}
