using HfcDemo.Dashboard;
using Microsoft.EntityFrameworkCore;

namespace HfcDemo.Reporting;

// ── Reporting read model (alpha) — §C2 ───────────────────────────────────────
// A query engine over the EXISTING corporate read-model. The per-territory metrics
// and scores were already PRE-MATERIALIZED by RecomputeRollup (territory_period_
// summary) and pre-baked into IDashboardReadModel. This layer only slices / groups
// / aggregates that materialized grain — it never aggregates raw operational rows,
// and the corporate boundary (franchisee = data controller) is preserved.
//
// Singleton, exactly like EfDashboardReadModel: the read model is static after the
// one boot-time RecomputeRollup, so the per-(territory, period) FACTS are loaded
// ONCE in the constructor. Request-time = pure in-memory filter/group/aggregate
// over ≤ (territories × periods) rows. RBAC scope + query filters are applied per
// request before grouping; the corporate read-model tables carry no tenant filter,
// so isolation is the scope.Allows() gate the handler passes in (CONTRACT RBAC).
public sealed class ReportingReadModel
{
    // One flattened per-(territory, period) fact: the dimension values + every
    // metric's raw value + the provenance signals needed to label the result.
    public sealed record Fact(
        int TerritoryId, int PeriodId,
        // dimensions
        int BrandId, string BrandName, int RegionId, string RegionName,
        string Archetype, string TenureBand, string TerritoryName,
        int? FranchiseeId, string FranchiseeName, string Status,
        // measured plane
        int JobsCompleted, double SlotFillRate, double NoShowRate,
        // seeded plane
        double GrossRevenue, double RoyaltyRevenue, double SameTerritoryGrowth, int NpsScore,
        // derived scores
        double CompositeScore, double? FinancialScore, double? CustomerScore,
        double? GrowthScore, double? ComplianceScore,
        // provenance / freshness
        bool NpsMeasured, string AsOfMeasured, string AsOfReported,
        bool AtRisk, int WatchlistCount);

    private readonly List<Fact> _facts = new();
    private readonly List<CatalogPeriodDto> _periods = new();
    public int LatestPeriodId { get; }

    public IReadOnlyList<CatalogPeriodDto> Periods => _periods;
    public bool HasPeriod(int periodId) => _facts.Any(f => f.PeriodId == periodId);

    public ReportingReadModel(IDashboardReadModel rm, IServiceScopeFactory scopeFactory)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();

        // Corporate plane — no tenant filter on these tables (read-model storage).
        var summaries = db.TerritoryPeriodSummaries.AsNoTracking().ToList();
        var dimById = rm.Territories.ToDictionary(d => d.TerritoryId);

        // Watchlist is pre-computed on the latest period only — count open flags
        // per territory (older periods report 0, which is honest: flags are current).
        var wlByTerr = rm.Watchlist
            .GroupBy(w => w.TerritoryId)
            .ToDictionary(g => g.Key, g => g.Count());

        LatestPeriodId = rm.LatestPeriodId;

        foreach (var s in summaries)
        {
            if (!dimById.TryGetValue(s.TerritoryId, out var d)) continue;   // not in the dashboard dim set

            // NPS is survey-measured only when the rollup stamped the row "current";
            // "seeded"/"pending" mean the seeded fallback (never present it as measured).
            bool npsMeasured = s.RefreshStatus == "current";

            _facts.Add(new Fact(
                s.TerritoryId, s.PeriodId,
                d.BrandId, d.BrandName, d.RegionId, d.RegionName,
                d.Archetype, s.TenureBand, d.TerritoryName,
                d.FranchiseeId, d.FranchiseeName, d.Status,
                s.JobsCompleted, s.SlotFillRate, s.NoShowRate,
                s.GrossRevenue, s.RoyaltyRevenue, s.SameTerritoryGrowth, s.NpsScore,
                s.CompositeScore, s.FinancialScore, s.CustomerScore, s.GrowthScore, s.ComplianceScore,
                npsMeasured, Iso(s.AsOfMeasured), Iso(s.AsOfReported),
                AtRisk: s.CompositeScore < 50,
                WatchlistCount: s.PeriodId == LatestPeriodId && wlByTerr.TryGetValue(s.TerritoryId, out var n) ? n : 0));
        }

        _periods = _facts
            .GroupBy(f => f.PeriodId)
            .OrderByDescending(g => g.Key)
            .Select(g => new CatalogPeriodDto(g.Key, PeriodLabel(g.Key), g.Key == LatestPeriodId))
            .ToList();
    }

    // ── Catalog ──────────────────────────────────────────────────────────────
    public ReportCatalogDto Catalog() => new(
        Metrics.Values.Select(m => new CatalogMetricDto(
            m.Key, m.Label, m.Unit, Wire(m.Agg), m.Provenance, m.HigherIsBetter,
            m.Nullable, m.Illustrative, m.Description)).ToList(),
        Dimensions.Values.Select(d => new CatalogDimensionDto(d.Key, d.Label, d.HasId)).ToList(),
        _periods,
        new[] { "brandId", "regionId", "archetype", "tenureBand", "status", "riskBand", "territoryIds" });

    public bool IsMetric(string key) => Metrics.ContainsKey(key);
    public bool IsDimension(string key) => Dimensions.ContainsKey(key);

    // ── Query execution ────────────────────────────────────────────────────────
    // Pre-validated by the endpoint (known keys, scope, period). Pure projection.
    public ReportQueryResultDto Query(
        IReadOnlyList<string> metricKeys, IReadOnlyList<string> dimensionKeys,
        int periodId, ReportFilters filters, DashboardScope scope, DateTime now)
    {
        var metrics = metricKeys.Select(k => Metrics[k]).ToList();
        var dims = dimensionKeys.Select(k => Dimensions[k]).ToList();

        var rows = _facts.Where(f => f.PeriodId == periodId)
            .Where(f => scope.Allows(f.TerritoryId))                       // RBAC read-down FIRST
            .Where(f => Passes(f, filters))
            .ToList();

        // Group by the selected dimensions' value tuples ([] dims → one grand total).
        var groups = rows
            .GroupBy(f => string.Join("", dims.Select(d => d.Value(f).Label)))
            .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var outRows = new List<IDictionary<string, object?>>();
        foreach (var g in groups)
        {
            var groupFacts = g.ToList();
            var row = new Dictionary<string, object?>();
            var dimKeys = new Dictionary<string, object?>();

            foreach (var d in dims)
            {
                var (label, id) = d.Value(groupFacts[0]);
                row[d.Key] = label;
                if (d.HasId && d.IdField is not null) dimKeys[d.IdField] = id;
            }
            foreach (var m in metrics)
                row[m.Key] = m.Aggregate(groupFacts);

            row["dimensionKeys"] = dimKeys;
            outRows.Add(row);
        }

        // ── Columns: dimensions in selection order, then metrics ───────────────
        var columns = new List<ReportColumnDto>();
        foreach (var d in dims)
            columns.Add(new ReportColumnDto(d.Key, d.Label, "dimension", "string",
                null, null, null, null, null, d.HasId));
        foreach (var m in metrics)
        {
            var prov = ProvenanceFor(m, rows);
            columns.Add(new ReportColumnDto(m.Key, m.Label, "metric", "number",
                m.Unit, Wire(m.Agg), prov.Type, prov.Illustrative, m.HigherIsBetter, null));
        }

        // ── Meta ───────────────────────────────────────────────────────────────
        var provenance = metrics.Select(m =>
        {
            var p = ProvenanceFor(m, rows);
            return new ReportProvenanceDto(m.Key, p.Type, p.AsOf, p.Illustrative);
        }).ToList();

        var notes = new List<ReportNoteDto>();
        if (metrics.Any(m => m.Illustrative) || rows.Any(r => !r.NpsMeasured && metrics.Any(m => m.Key == "nps_score")))
            notes.Add(new("info", "Financial metrics are illustrative/seeded and lag measured operational metrics."));
        if (metrics.Any(m => m.Key == "financial_score"))
        {
            int pending = rows.Count(r => r.FinancialScore is null);
            if (pending > 0)
                notes.Add(new("warning",
                    $"{pending} territory(ies) excluded from financial_score — current royalty-cycle reporting not received."));
        }

        var meta = new ReportMetaDto(
            new ReportPeriodDto(periodId, PeriodLabel(periodId)),
            new ReportScopeDto(scope.ScopeLevel, scope.TerritoryIdsForEcho),
            outRows.Count,
            rows.Select(r => r.TerritoryId).Distinct().Count(),
            MaxDate(rows.Select(r => r.AsOfMeasured)),
            MaxDate(rows.Select(r => r.AsOfReported)),
            Iso(now),
            provenance,
            notes);

        return new ReportQueryResultDto(columns, outRows, meta);
    }

    private static bool Passes(Fact f, ReportFilters q) =>
        (q.BrandId is null || f.BrandId == q.BrandId)
        && (q.RegionId is null || f.RegionId == q.RegionId)
        && (q.Archetype is null || f.Archetype.Equals(q.Archetype, StringComparison.OrdinalIgnoreCase))
        && (q.TenureBand is null || f.TenureBand.Equals(q.TenureBand, StringComparison.OrdinalIgnoreCase))
        && (q.Status is null || f.Status.Equals(q.Status, StringComparison.OrdinalIgnoreCase))
        && (q.TerritoryIds is null || q.TerritoryIds.Count == 0 || q.TerritoryIds.Contains(f.TerritoryId))
        && RiskBandMatch(f, q.RiskBand);

    public static bool IsValidRiskBand(string? band) =>
        band is null || band is "healthy" or "watch" or "at_risk";

    private static bool RiskBandMatch(Fact f, string? band) => band switch
    {
        null => true,
        "healthy" => f.CompositeScore >= 70,
        "watch" => f.CompositeScore is >= 50 and < 70,
        "at_risk" => f.CompositeScore < 50,
        _ => true,
    };

    // ── Provenance for a metric over the contributing rows ─────────────────────
    private (string Type, string AsOf, bool Illustrative) ProvenanceFor(MetricDef m, List<Fact> rows)
    {
        if (m.PerRowProvenance)   // nps_score: measured | seeded | mixed
        {
            bool anyMeasured = rows.Any(r => r.NpsMeasured);
            bool anySeeded = rows.Any(r => !r.NpsMeasured);
            string type = anyMeasured && anySeeded ? "mixed" : anyMeasured ? "measured" : "seeded";
            string asOf = anyMeasured
                ? MaxDate(rows.Where(r => r.NpsMeasured).Select(r => r.AsOfMeasured))
                : MaxDate(rows.Select(r => r.AsOfReported));
            return (type, asOf, anySeeded);
        }

        string asOfDate = m.Provenance == "seeded"
            ? MaxDate(rows.Select(r => r.AsOfReported))
            : MaxDate(rows.Select(r => r.AsOfMeasured));   // measured + derived ride the measured as-of
        return (m.Provenance, asOfDate, m.Illustrative);
    }

    // ── Metric catalog ─────────────────────────────────────────────────────────
    private enum Agg { Sum, Avg, Count, CountAtRisk, SumWatchlist }

    // Wire token for the aggregation kind (matches §C2 vocabulary).
    private static string Wire(Agg a) => a switch
    {
        Agg.Sum => "sum",
        Agg.Avg => "avg",
        Agg.Count => "count",
        Agg.CountAtRisk => "count_at_risk",
        Agg.SumWatchlist => "sum_watchlist",
        _ => "avg",
    };

    private sealed record MetricDef(
        string Key, string Label, string Unit, Agg Agg, string Provenance,
        bool HigherIsBetter, bool Nullable, bool Illustrative, int Decimals,
        bool PerRowProvenance, string Description, Func<Fact, double?> Value)
    {
        public object? Aggregate(List<Fact> facts)
        {
            switch (Agg)
            {
                case Agg.Count: return facts.Count;
                case Agg.CountAtRisk: return facts.Count(f => f.AtRisk);
                case Agg.SumWatchlist: return facts.Sum(f => f.WatchlistCount);
                case Agg.Sum:
                {
                    var vals = facts.Select(Value).Where(v => v is not null).Select(v => v!.Value).ToList();
                    return vals.Count == 0 ? null : Round(vals.Sum());
                }
                default:   // Avg over non-null values
                {
                    var vals = facts.Select(Value).Where(v => v is not null).Select(v => v!.Value).ToList();
                    return vals.Count == 0 ? null : Round(vals.Average());
                }
            }
        }

        private object Round(double v) => Decimals == 0 ? (object)(long)Math.Round(v) : Math.Round(v, Decimals);
    }

    private sealed record DimDef(string Key, string Label, bool HasId, string? IdField, Func<Fact, (string Label, int? Id)> Value);

    private static readonly Dictionary<string, MetricDef> Metrics = new[]
    {
        new MetricDef("composite_score", "Composite Health Score", "score", Agg.Avg, "derived", true, false, false, 1, false,
            "Weighted franchise_ops_v1 health score (0–100).", f => f.CompositeScore),
        new MetricDef("financial_score", "Financial Score", "score", Agg.Avg, "derived", true, true, true, 1, false,
            "Financial sub-score; pending-reporting territories are excluded (null).", f => f.FinancialScore),
        new MetricDef("customer_score", "Customer Score", "score", Agg.Avg, "derived", true, false, false, 1, false,
            "Customer sub-score (NPS + ratings).", f => f.CustomerScore),
        new MetricDef("growth_score", "Growth Score", "score", Agg.Avg, "derived", true, false, false, 1, false,
            "Growth sub-score (same-territory growth + slot fill).", f => f.GrowthScore),
        new MetricDef("compliance_score", "Compliance Score", "score", Agg.Avg, "derived", true, false, false, 1, false,
            "Compliance sub-score (no-show + reporting).", f => f.ComplianceScore),
        new MetricDef("nps_score", "NPS", "score", Agg.Avg, "measured", true, false, false, 0, true,
            "Net Promoter Score — survey-measured where available, else seeded fallback.", f => f.NpsScore),
        new MetricDef("jobs_completed", "Jobs Completed", "count", Agg.Sum, "measured", true, false, false, 0, false,
            "Completed jobs (measured from operational rows).", f => f.JobsCompleted),
        new MetricDef("slot_fill_rate", "Slot Fill Rate", "ratio", Agg.Avg, "measured", true, false, false, 4, false,
            "Filled ÷ available slots (measured).", f => f.SlotFillRate),
        new MetricDef("no_show_rate", "No-Show Rate", "ratio", Agg.Avg, "measured", false, false, false, 4, false,
            "No-show ÷ booked (measured).", f => f.NoShowRate),
        new MetricDef("gross_revenue", "Gross Revenue", "dollars", Agg.Sum, "seeded", true, false, true, 0, false,
            "Reported gross revenue (illustrative/seeded).", f => f.GrossRevenue),
        new MetricDef("royalty_revenue", "Royalty Revenue", "dollars", Agg.Sum, "seeded", true, false, true, 0, false,
            "Royalty revenue = gross × rate (illustrative/seeded).", f => f.RoyaltyRevenue),
        new MetricDef("same_territory_growth", "Same-Territory Growth", "percent", Agg.Avg, "seeded", true, false, true, 4, false,
            "YoY same-territory growth (illustrative/seeded).", f => f.SameTerritoryGrowth),
        new MetricDef("territory_count", "Active Territories", "count", Agg.Count, "measured", true, false, false, 0, false,
            "Count of territories in the group.", _ => null),
        new MetricDef("at_risk_count", "At-Risk Territories", "count", Agg.CountAtRisk, "derived", false, false, false, 0, false,
            "Territories with composite health below 50.", _ => null),
        new MetricDef("watchlist_count", "Open Watchlist Flags", "count", Agg.SumWatchlist, "derived", false, false, false, 0, false,
            "Open watchlist flags across the group (latest period).", _ => null),
    }.ToDictionary(m => m.Key);

    private static readonly Dictionary<string, DimDef> Dimensions = new[]
    {
        new DimDef("brand", "Brand", true, "brandId", f => (f.BrandName, f.BrandId)),
        new DimDef("region", "Region", true, "regionId", f => (f.RegionName, f.RegionId)),
        new DimDef("archetype", "Archetype", false, null, f => (string.IsNullOrEmpty(f.Archetype) ? "—" : f.Archetype, null)),
        new DimDef("tenure_band", "Tenure Band", false, null, f => (f.TenureBand, null)),
        new DimDef("territory", "Territory", true, "territoryId", f => (f.TerritoryName, f.TerritoryId)),
        new DimDef("franchisee", "Franchisee", true, "franchiseeId", f => (f.FranchiseeName, f.FranchiseeId)),
        new DimDef("status", "Status", false, null, f => (f.Status, null)),
    }.ToDictionary(d => d.Key);

    // ── helpers ──────────────────────────────────────────────────────────────
    private static string PeriodLabel(int periodId)
    {
        int y = periodId / 100, m = periodId % 100;
        return m is >= 1 and <= 12 ? new DateTime(y, m, 1).ToString("MMMM yyyy") : periodId.ToString();
    }

    private static string Iso(DateTime? d) =>
        d is null ? "" : DateTime.SpecifyKind(d.Value, DateTimeKind.Utc).ToString("yyyy-MM-dd");

    private static string Iso(DateTime d) =>
        DateTime.SpecifyKind(d, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ssZ");

    private static string MaxDate(IEnumerable<string> dates)
    {
        var present = dates.Where(s => !string.IsNullOrEmpty(s)).ToList();
        return present.Count > 0 ? present.Max()! : "";
    }
}
