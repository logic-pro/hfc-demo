using System.Text.Json;
using HfcDemo.Dashboard;
using HfcDemo.Reporting;
using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// ── §C2 — Reporting API (alpha) ──────────────────────────────────────────────
// Read-only query builder over the EXISTING corporate read-model, plus saved-report
// CRUD. Corporate-scope only (the "Corporate" policy admits network/brand/region;
// a franchisee operator → 403 automatically). RBAC reads DOWN: every query is
// filtered to the caller's allowed territory set first (DashboardScopeHolder, the
// same seam the dashboard endpoints use). Every error path → problem+json.
public static class ReportingEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void MapReporting(this WebApplication app)
    {
        // ── GET /api/reports/catalog — metrics / dimensions / periods / filters ─
        app.MapGet("/api/reports/catalog", (ReportingReadModel rm) =>
            Results.Ok(rm.Catalog()))
            .RequireAuthorization(HfcPolicies.Corporate);

        // ── POST /api/reports/query — run a metric/dimension query ──────────────
        app.MapPost("/api/reports/query", (
            ReportQueryRequest? body, ReportingReadModel rm, DashboardScopeHolder holder) =>
        {
            if (body is null)
                return Results.ValidationProblem(One("body", "A query body is required."));

            if (Validate(body, rm) is { } errors)
                return Results.ValidationProblem(errors);

            int periodId = body.Period ?? rm.LatestPeriodId;
            if (!rm.HasPeriod(periodId))
                return Results.Problem(statusCode: 404, title: "Unknown period.",
                    detail: $"No reporting data materialized for period {periodId}.");

            var result = rm.Query(
                body.Metrics!, body.Dimensions ?? new List<string>(),
                periodId, body.Filters ?? new ReportFilters(), holder.Scope, DateTime.UtcNow);

            return Results.Ok(result);
        }).RequireAuthorization(HfcPolicies.Corporate);

        // ── Saved reports — read-down library CRUD ──────────────────────────────
        // GET list: network sees all; brand/region see network-owned ∪ their own.
        app.MapGet("/api/reports/saved", async (AppDb db, DashboardScopeHolder holder) =>
        {
            var (level, id) = Owner(holder.Scope);
            var all = await db.SavedReports.AsNoTracking().OrderByDescending(r => r.UpdatedAt).ToListAsync();
            var visible = all.Where(r => CanSee(r, level, id)).Select(ToDto).ToList();
            return Results.Ok(visible);
        }).RequireAuthorization(HfcPolicies.Corporate);

        app.MapGet("/api/reports/saved/{id}", async (string id, AppDb db, DashboardScopeHolder holder) =>
        {
            var (level, sid) = Owner(holder.Scope);
            var r = await db.SavedReports.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
            if (r is null || !CanSee(r, level, sid))
                return Results.Problem(statusCode: 404, title: "Saved report not found.");
            return Results.Ok(ToDto(r));
        }).RequireAuthorization(HfcPolicies.Corporate);

        app.MapPost("/api/reports/saved", async (
            SavedReportInput? body, AppDb db, ReportingReadModel rm, DashboardScopeHolder holder) =>
        {
            if (Validate(body, rm) is { } errors) return Results.ValidationProblem(errors);

            var (level, id) = Owner(holder.Scope);
            var now = DateTime.UtcNow;
            var report = new SavedReport
            {
                Id = $"rep_{Guid.NewGuid():N}",
                Name = body!.Name!.Trim(),
                Description = body.Description?.Trim() ?? "",
                OwnerScopeLevel = level,
                OwnerScopeId = id,
                DefinitionJson = JsonSerializer.Serialize(body.Definition, Json),
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.SavedReports.Add(report);
            await db.SaveChangesAsync();
            return Results.Created($"/api/reports/saved/{report.Id}", ToDto(report));
        }).RequireAuthorization(HfcPolicies.Corporate);

        app.MapPut("/api/reports/saved/{id}", async (
            string id, SavedReportInput? body, AppDb db, ReportingReadModel rm, DashboardScopeHolder holder) =>
        {
            if (Validate(body, rm) is { } errors) return Results.ValidationProblem(errors);

            var (level, sid) = Owner(holder.Scope);
            var r = await db.SavedReports.FirstOrDefaultAsync(x => x.Id == id);
            if (r is null || !CanSee(r, level, sid))
                return Results.Problem(statusCode: 404, title: "Saved report not found.");
            if (!CanEdit(r, level, sid))
                return Results.Problem(statusCode: 403, title: "Saved report belongs to another scope.");

            r.Name = body!.Name!.Trim();
            r.Description = body.Description?.Trim() ?? "";
            r.DefinitionJson = JsonSerializer.Serialize(body.Definition, Json);
            r.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(r));
        }).RequireAuthorization(HfcPolicies.Corporate);

        app.MapDelete("/api/reports/saved/{id}", async (string id, AppDb db, DashboardScopeHolder holder) =>
        {
            var (level, sid) = Owner(holder.Scope);
            var r = await db.SavedReports.FirstOrDefaultAsync(x => x.Id == id);
            if (r is null || !CanSee(r, level, sid))
                return Results.Problem(statusCode: 404, title: "Saved report not found.");
            if (!CanEdit(r, level, sid))
                return Results.Problem(statusCode: 403, title: "Saved report belongs to another scope.");

            db.SavedReports.Remove(r);
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization(HfcPolicies.Corporate);
    }

    // ── validation (→ problem+json via ValidationProblem) ───────────────────────
    private static IDictionary<string, string[]>? Validate(ReportQueryRequest? q, ReportingReadModel rm)
    {
        var e = new Dictionary<string, string[]>();
        if (q?.Metrics is null || q.Metrics.Count == 0)
            e["metrics"] = new[] { "At least one metric is required." };
        else
        {
            var unknown = q.Metrics.Where(m => !rm.IsMetric(m)).ToArray();
            if (unknown.Length > 0) e["metrics"] = new[] { $"Unknown metric key(s): {string.Join(", ", unknown)}." };
        }
        if (q?.Dimensions is { Count: > 0 })
        {
            var unknown = q.Dimensions.Where(d => !rm.IsDimension(d)).ToArray();
            if (unknown.Length > 0) e["dimensions"] = new[] { $"Unknown dimension key(s): {string.Join(", ", unknown)}." };
        }
        if (q?.Filters is { } f)
        {
            if (!ReportingReadModel.IsValidRiskBand(f.RiskBand))
                e["filters.riskBand"] = new[] { "riskBand must be one of: healthy, watch, at_risk." };
            if (f.TerritoryIds is { } ids && ids.Any(x => x <= 0))
                e["filters.territoryIds"] = new[] { "territoryIds must be positive." };
        }
        return e.Count > 0 ? e : null;
    }

    private static IDictionary<string, string[]>? Validate(SavedReportInput? body, ReportingReadModel rm)
    {
        var e = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(body?.Name))
            e["name"] = new[] { "A report name is required." };
        if (body?.Definition is null)
            e["definition"] = new[] { "A report definition is required." };
        var defErrors = body?.Definition is null ? null : Validate(body.Definition, rm);
        if (defErrors is not null)
            foreach (var kv in defErrors) e[$"definition.{kv.Key}"] = kv.Value;
        return e.Count > 0 ? e : null;
    }

    private static IDictionary<string, string[]> One(string key, string msg) =>
        new Dictionary<string, string[]> { [key] = new[] { msg } };

    // ── saved-report scope ownership (read-down library RBAC) ───────────────────
    private static (string Level, int? Id) Owner(DashboardScope scope) => scope.ScopeLevel switch
    {
        "brand" => ("brand", scope.ScopeBrandId),
        "region" => ("region", scope.ScopeRegionId),
        _ => ("corporate", null),                 // network/corporate
    };

    // Visible: corporate sees all; everyone sees network-owned; otherwise only own scope.
    private static bool CanSee(SavedReport r, string level, int? id) =>
        level == "corporate"
        || r.OwnerScopeLevel == "corporate"
        || (r.OwnerScopeLevel == level && r.OwnerScopeId == id);

    // Editable: corporate edits any; otherwise only reports its own scope owns.
    private static bool CanEdit(SavedReport r, string level, int? id) =>
        level == "corporate"
        || (r.OwnerScopeLevel == level && r.OwnerScopeId == id);

    private static SavedReportDto ToDto(SavedReport r) => new(
        r.Id, r.Name, r.Description,
        JsonSerializer.Deserialize<ReportQueryRequest>(r.DefinitionJson, Json)
            ?? new ReportQueryRequest(new(), new(), null, null),
        r.OwnerScopeLevel, r.OwnerScopeId,
        Iso(r.CreatedAt), Iso(r.UpdatedAt));

    private static string Iso(DateTime d) =>
        DateTime.SpecifyKind(d, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ssZ");
}
