namespace HfcDemo.Dashboard;

// ── D6–D9 endpoints — read-only projections over IDashboardReadModel ─────────
// Every handler does ONLY: resolve scope → filter (scope + query params) →
// sort/paginate → map to the §2 DTO. No EF entity is ever serialized; nothing
// is aggregated, scored, or windowed on the request path (that all happened in
// the boot-time roll-up). Provenance rides along on every metric via the DTOs.
public static class DashboardEndpoints
{
    public static void MapDashboard(this WebApplication app)
    {
        // D6 — Corporate vital signs + brand comparison (pre-rolled).
        app.MapGet("/api/dashboard/corporate", (
            IDashboardReadModel rm, DashboardScopeHolder holder,
            int? period, int? trailingWindow, int? brandId, int? regionId) =>
        {
            var scope = holder.Scope;
            // The corporate roll-up is a portfolio aggregate; narrowing it to one
            // franchisee would require request-time re-aggregation (forbidden).
            // A franchisee uses the territory-scoped endpoints instead.
            if (!scope.IsCorporate)
                return Results.Problem(statusCode: 403,
                    title: "Corporate scope required for the corporate dashboard.");

            int periodId = period ?? rm.LatestPeriodId;
            int window = trailingWindow ?? 12;
            var roll = rm.Corporate(periodId, window, brandId, regionId);

            var dto = new CorporateDashboardDto(
                new PeriodDto(roll.PeriodId, roll.PeriodLabel, roll.TrailingWindowMonths),
                new ScopeDto(scope.ScopeLevel, scope.TerritoryIdsForEcho),
                roll.VitalSigns.Select(v => new MetricDto(
                    v.MetricKey, v.Label, v.Value, v.Unit, v.TrendDirection, v.TrendPercent,
                    v.ProvenanceType, v.AsOfDate, v.RefreshStatus, v.ConfidenceLevel)).ToList(),
                roll.BrandComparison.Select(b => new BrandComparisonDto(
                    b.BrandId, b.BrandName, b.Archetype, b.TerritoryCount, b.CompositeHealthScore,
                    b.FinancialScore, b.CustomerScore, b.GrowthScore, b.ComplianceScore,
                    b.WatchlistCount, b.TopIssue)).ToList(),
                roll.DataNotes.Select(n => new DataNoteDto(n.Severity, n.Message)).ToList());

            return Results.Ok(dto);
        });

        // D7 — Territory health score: composite + 4 sub-scores + drivers.
        app.MapGet("/api/territories/{id:int}/health-score", (
            int id, IDashboardReadModel rm, DashboardScopeHolder holder, int? period) =>
        {
            // Scope BEFORE lookup: a franchisee never reads another's territory.
            if (!holder.Scope.Allows(id))
                return Results.Problem(statusCode: 403, title: "Territory outside your scope.");

            int periodId = period ?? rm.LatestPeriodId;
            var s = rm.Score(id, periodId);
            if (s is null) return Results.NotFound();

            var dto = new HealthScoreDto(
                s.TerritoryId, s.TerritoryName, s.BrandName, s.RegionName, s.PeriodId, s.ScoreStatus,
                new ScoreVersionDto(s.ScoreVersionId, s.ScoreOwnerTeam),
                new ScoresDto(s.Composite, s.Financial, s.Customer, s.Growth, s.Compliance),
                s.Notes.Select(n => new ScoreNoteDto(n.Type, n.Message)).ToList(),
                s.Drivers.Select(d => new DriverDto(
                    d.SubScore, d.MetricKey, d.Label, d.Value, d.Benchmark,
                    d.Impact, d.Severity, d.ProvenanceType, d.AsOfDate, d.RefreshStatus)).ToList());

            return Results.Ok(dto);
        });

        // D8 — Watchlist flags (scoped + filterable).
        app.MapGet("/api/dashboard/watchlist", (
            IDashboardReadModel rm, DashboardScopeHolder holder,
            int? brandId, int? regionId, string? severity, string? category, string? status, int? period) =>
        {
            var scope = holder.Scope;
            var dimById = rm.Territories.ToDictionary(t => t.TerritoryId);

            var items = rm.Watchlist
                .Where(w => scope.Allows(w.TerritoryId))                       // scope first
                .Where(w => brandId is null || (dimById.TryGetValue(w.TerritoryId, out var d) && d.BrandId == brandId))
                .Where(w => regionId is null || (dimById.TryGetValue(w.TerritoryId, out var d) && d.RegionId == regionId))
                .Where(w => severity is null || w.Severity.Equals(severity, StringComparison.OrdinalIgnoreCase))
                .Where(w => category is null || w.Category.Equals(category, StringComparison.OrdinalIgnoreCase))
                .Where(w => status is null || w.Status.Equals(status, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(w => SeverityRank(w.Severity))
                .ThenBy(w => w.TerritoryId)
                .Select(w => new WatchlistItemDto(
                    w.WatchlistFlagId, w.TerritoryId, w.TerritoryName, w.BrandName, w.RegionName,
                    w.FlagKey, w.Category, w.Severity, w.Status, w.CurrentValue, w.ThresholdValue,
                    w.DetectedAt, w.Explanation))
                .ToList();

            return Results.Ok(new WatchlistDto(items, items.Count));
        });

        // Map dots for the territory-health map (D12). Read-only projection:
        // dimension lat/lng + the PRE-COMPUTED composite score (no recompute).
        app.MapGet("/api/dashboard/map", (
            IDashboardReadModel rm, DashboardScopeHolder holder, int? brandId, int? regionId) =>
        {
            var items = rm.Territories
                .Where(t => holder.Scope.Allows(t.TerritoryId))               // scope first
                .Where(t => brandId is null || t.BrandId == brandId)
                .Where(t => regionId is null || t.RegionId == regionId)
                .OrderBy(t => t.TerritoryId)
                .Select(t =>
                {
                    var s = rm.Score(t.TerritoryId, rm.LatestPeriodId);
                    int composite = s?.Composite ?? 0;
                    return new MapItemDto(
                        t.TerritoryId, t.TerritoryName, t.BrandId, t.BrandName, t.RegionId,
                        t.Lat, t.Lng, composite, s?.ScoreStatus ?? "unknown", composite < 50);
                })
                .ToList();

            return Results.Ok(new MapDto(items, items.Count));
        });

        // D9 — Territory registry (paged + filterable).
        app.MapGet("/api/territories", (
            IDashboardReadModel rm, DashboardScopeHolder holder,
            int? brandId, int? regionId, string? status, string? archetype, int? page, int? pageSize) =>
        {
            int p = page is > 0 ? page.Value : 1;
            int size = pageSize is > 0 and <= 200 ? pageSize.Value : 50;

            var filtered = rm.Territories
                .Where(t => holder.Scope.Allows(t.TerritoryId))                // scope first
                .Where(t => brandId is null || t.BrandId == brandId)
                .Where(t => regionId is null || t.RegionId == regionId)
                .Where(t => status is null || t.Status.Equals(status, StringComparison.OrdinalIgnoreCase))
                .Where(t => archetype is null || t.Archetype.Equals(archetype, StringComparison.OrdinalIgnoreCase))
                .OrderBy(t => t.TerritoryId)
                .ToList();

            var items = filtered
                .Skip((p - 1) * size).Take(size)
                .Select(t => new TerritoryListItemDto(
                    t.TerritoryId, t.TerritoryName, t.BrandId, t.BrandName, t.RegionId, t.RegionName,
                    t.FranchiseeName, t.OpenDate, t.TenureBand, t.Archetype, t.Status))
                .ToList();

            return Results.Ok(new TerritoryPageDto(items, p, size, filtered.Count));
        });
    }

    private static int SeverityRank(string severity) =>
        severity switch { "high" => 3, "medium" => 2, "low" => 1, _ => 0 };
}
