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
        // ── AUTH (feat/corporate-role) ──────────────────────────────────────────
        // These were OPEN: with no token the scope resolver defaulted to the
        // corporate lens (DashboardScope.ScopeFor), so an anonymous caller read the
        // whole portfolio. We now require a VERIFIED principal on every one:
        //   • /corporate, /watchlist, /map  → "Corporate" role (franchisor-only).
        //   • /territories, /{id}/health-score → authenticated; the franchisee lens
        //     still hard-scopes a franchisee token to its OWN rows (D10 preserved),
        //     anonymous is rejected before the scope is even resolved.
        // The franchisee-scope filtering inside each handler is unchanged — this
        // only closes the no-token bypass at the edge.

        // D6 — Corporate vital signs + brand comparison (pre-rolled).
        app.MapGet("/api/dashboard/corporate", (
            IDashboardReadModel rm, DashboardScopeHolder holder,
            int? period, int? trailingWindow, int? brandId, int? regionId) =>
        {
            var scope = holder.Scope;
            // The executive dashboard is the franchisor read-down plane: network,
            // brand, and region scopes all read it (the read model serves each a
            // PRE-BAKED scoped roll-up). A franchisee (operator) uses the territory-
            // scoped operator endpoints instead — never this portfolio view.
            if (!scope.IsReadDown)
                return Results.Problem(statusCode: 403,
                    title: "Corporate scope required for the corporate dashboard.");

            int periodId = period ?? rm.LatestPeriodId;
            // Reject an unknown periodId instead of echoing a misleading
            // {periodId:999999, label:"…"} while serving the latest data. Only the
            // latest period is materialized — match how health-score (rm.Score)
            // rejects a non-latest period: 404.
            if (periodId != rm.LatestPeriodId)
                return Results.NotFound();
            int window = trailingWindow ?? 12;
            var roll = rm.Corporate(scope, periodId, window, brandId, regionId);

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
        }).RequireAuthorization("Corporate");

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
        }).RequireAuthorization();   // authenticated; franchisee lens scopes to own (D10)

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
        }).RequireAuthorization("Corporate");

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
        }).RequireAuthorization("Corporate");

        // D9 — Territory registry (paged + filterable).
        app.MapGet("/api/territories", (
            IDashboardReadModel rm, DashboardScopeHolder holder,
            int? brandId, int? regionId, string? status, string? archetype, int? page, int? pageSize) =>
        {
            // Enforce the documented bounds rather than silently clamping: page>=1
            // and pageSize in 1..100. Out-of-range values (e.g. pageSize=150) are a
            // 400, not a quietly-clamped 200. Omitted params keep their defaults.
            var pageErrors = new Dictionary<string, string[]>();
            if (page is not null && page < 1)
                pageErrors["page"] = new[] { "page must be at least 1." };
            if (pageSize is not null && (pageSize < 1 || pageSize > 100))
                pageErrors["pageSize"] = new[] { "pageSize must be between 1 and 100." };
            if (pageErrors.Count > 0) return Results.ValidationProblem(pageErrors);

            int p = page ?? 1;
            int size = pageSize ?? 50;

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
        }).RequireAuthorization();   // authenticated; franchisee lens scopes to own (D10)
    }

    private static int SeverityRank(string severity) =>
        severity switch { "high" => 3, "medium" => 2, "low" => 1, _ => 0 };
}
