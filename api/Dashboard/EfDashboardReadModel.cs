using Microsoft.EntityFrameworkCore;

// EF entities (root namespace) collide by name with the Dashboard read-model
// shapes (TerritoryPeriodSummary / WatchlistFlag). Alias the storage rows so the
// unqualified names keep meaning the §1/§2 in-memory shapes this file produces.
using EfSummary = HfcDemo.TerritoryPeriodSummary;
using EfFlag = HfcDemo.WatchlistFlag;

namespace HfcDemo.Dashboard;

// ── EF-backed corporate read model (the deferred swap target) ────────────────
// Replaces StubDashboardReadModel behind the SAME IDashboardReadModel interface,
// reading Alpha's `territory_period_summary` + `watchlist_flag` (CONTRACT §1)
// instead of an in-memory seed. The §1 row shape and every §2 DTO are unchanged —
// this is a STORAGE swap only (one DI line in Program.cs).
//
// Architecture preserved (corporate-rollup-readmodel-architect + franchise-kpi-
// metric-guard): everything is PRE-COMPUTED here, once, in the constructor — the
// scores/roll-up/flags were already materialized by RecomputeRollup (Rollup.cs);
// the dimension, drivers, vital signs and brand comparison are baked here at boot.
// Request-time handlers stay projection-only (filter / sort / paginate / scope).
//
// Singleton, like the stub: built once on first resolution (after Seed + Rollup
// have run in Program.cs's startup block). It opens its own DI scope to read the
// DB — the corporate plane has NO tenant query filter, and the dimension tables
// are read with IgnoreQueryFilters() (the franchisor's sanctioned cross-tenant
// read, mirroring RecomputeRollup; ADR-19).
public sealed class EfDashboardReadModel : IDashboardReadModel
{
    // Documented score benchmarks (franchise_ops_v1) — used ONLY to LABEL the
    // pre-computed drivers, never to recompute a score at request time. Same
    // values as the stub so the seam is value-stable across the swap.
    private const double NpsBenchmark = 58;
    private const double SlotFillBenchmark = 0.76;
    private const double NoShowBenchmark = 0.08;

    private readonly int _latestPeriodId;
    private readonly List<TerritoryDim> _dims = new();
    private readonly Dictionary<int, TerritoryScore> _scores = new();
    private readonly List<WatchlistFlag> _watchlist = new();
    private readonly CorporateRollup _corporate;

    public int LatestPeriodId => _latestPeriodId;
    public IReadOnlyList<TerritoryDim> Territories => _dims;
    public IReadOnlyList<WatchlistFlag> Watchlist => _watchlist;

    public TerritoryScore? Score(int territoryId, int periodId) =>
        periodId == _latestPeriodId && _scores.TryGetValue(territoryId, out var s) ? s : null;

    public CorporateRollup Corporate(int periodId, int trailingWindow, int? brandId, int? regionId)
    {
        var brands = _corporate.BrandComparison
            .Where(b => brandId is null || b.BrandId == brandId)
            .ToList();
        // regionId can't narrow a portfolio brand roll-up without re-aggregating
        // (forbidden at request time); we note it rather than fake it. Identical
        // contract behaviour to the stub.
        var notes = _corporate.DataNotes.ToList();
        if (regionId is not null)
            notes.Add(("info", "Region filter applies to territory views; brand roll-ups remain portfolio-wide."));

        return _corporate with
        {
            PeriodId = periodId,
            TrailingWindowMonths = trailingWindow,
            BrandComparison = brands,
            DataNotes = notes,
        };
    }

    public EfDashboardReadModel(IServiceScopeFactory scopeFactory)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();

        // ── Corporate plane (CONTRACT §1) — NO tenant filter on these tables ────
        var summaries = db.TerritoryPeriodSummaries.AsNoTracking().ToList();
        var flags = db.WatchlistFlags.AsNoTracking().ToList();

        _latestPeriodId = summaries.Count > 0 ? summaries.Max(s => s.PeriodId) : Seed.LatestPeriodId;
        var latest = summaries.Where(s => s.PeriodId == _latestPeriodId)
            .ToDictionary(s => s.TerritoryId);

        // ── Dimensions — read cross-tenant (ADR-19), join untenanted catalogs ───
        var territories = db.Territories.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.RegionId != null)                  // dashboard set only
            .OrderBy(t => t.Id).ToList();
        var brandBySlug = db.Brands.AsNoTracking().ToList().ToDictionary(b => b.Id);
        var regionById = db.Regions.AsNoTracking().ToList().ToDictionary(r => r.Id);
        var franchiseeBySlug = db.Franchisees.AsNoTracking().ToList().ToDictionary(f => f.Id);

        foreach (var t in territories)
        {
            if (!latest.TryGetValue(t.Id, out var s)) continue;   // no summary => not in read model

            var brand = brandBySlug.GetValueOrDefault(t.BrandId);
            var region = t.RegionId is int rid ? regionById.GetValueOrDefault(rid) : null;
            var franchisee = franchiseeBySlug.GetValueOrDefault(t.FranchiseeId);

            _dims.Add(new TerritoryDim(
                t.Id, t.Name, s.BrandId, brand?.Name ?? "", s.RegionId, region?.Name ?? "",
                franchisee?.Num, franchisee?.Name ?? "",
                t.OpenDate?.ToString("yyyy-MM-dd") ?? "", s.TenureBand,
                brand?.Archetype ?? "", t.Status, t.Lat ?? 0, t.Lng ?? 0,
                FranchiseeSlug: t.FranchiseeId));

            _scores[t.Id] = BuildScore(s, t.Name, brand?.Name ?? "", region?.Name ?? "");
        }

        // ── Watchlist — stored flag rows + denormalized dimension names ─────────
        var dimById = _dims.ToDictionary(d => d.TerritoryId);
        foreach (var f in flags.OrderByDescending(f => SeverityRank(f.Severity)).ThenBy(f => f.TerritoryId))
        {
            if (!dimById.TryGetValue(f.TerritoryId, out var d)) continue;
            _watchlist.Add(new WatchlistFlag(
                f.WatchlistFlagId, f.TerritoryId, d.TerritoryName, d.BrandName, d.RegionName,
                f.FlagKey, f.Category, f.Severity, f.Status, f.CurrentValue, f.ThresholdValue,
                f.DetectedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), f.Explanation));
        }

        _corporate = BuildCorporate(latest.Values.ToList(), brandBySlug);
    }

    // ── Per-territory score + pre-computed drivers (D7) ─────────────────────────
    private TerritoryScore BuildScore(EfSummary s, string territoryName, string brandName, string regionName)
    {
        var drivers = new List<DriverData>
        {
            MakeDriver("customer", "nps_score", "NPS", s.NpsScore, NpsBenchmark, higherIsBetter: true, "seeded", s.AsOfMeasured),
            MakeDriver("growth", "slot_fill_rate", "Slot Fill Rate", s.SlotFillRate, SlotFillBenchmark, higherIsBetter: true, "measured", s.AsOfMeasured),
            MakeDriver("compliance", "no_show_rate", "No-Show Rate", s.NoShowRate, NoShowBenchmark, higherIsBetter: false, "measured", s.AsOfMeasured),
        }
        .OrderByDescending(d => SeverityRank(d.Severity))
        .ToList();

        // Financial pending => the missing-input note (never fabricate a score).
        var notes = s.FinancialScore is null
            ? new[] { ("missing_input",
                "Financial score pending — current royalty-cycle reporting not received.") }
            : Array.Empty<(string, string)>();

        return new TerritoryScore(
            s.TerritoryId, s.PeriodId, territoryName, brandName, regionName,
            s.ScoreStatus, s.ScoreVersion, "Franchise Ops",
            (int)Math.Round(s.CompositeScore), ToScore(s.FinancialScore),
            ToScore(s.CustomerScore), ToScore(s.GrowthScore), ToScore(s.ComplianceScore),
            notes, drivers);
    }

    // ── Boot-time roll-up (territory → brand → corporate), from EF rows ─────────
    private CorporateRollup BuildCorporate(List<EfSummary> rows, Dictionary<string, Brand> brandBySlug)
    {
        var brandByNum = brandBySlug.Values.ToDictionary(b => b.Num);
        int territoryCount = _dims.Count;
        int atRisk = rows.Count(r => r.CompositeScore < 50);
        int jobsLtm = rows.Sum(r => r.JobsCompleted) * 12;             // illustrative LTM
        double systemRevenueLtm = rows.Sum(r => r.GrossRevenue) * 12;
        double royaltyLtm = rows.Sum(r => r.RoyaltyRevenue) * 12;
        double netSlotFill = rows.Count > 0 ? rows.Average(r => r.SlotFillRate) : 0;
        int networkNps = rows.Count > 0 ? (int)Math.Round(rows.Average(r => (double)r.NpsScore)) : 0;

        string asOfMeasured = MaxDate(rows.Select(r => r.AsOfMeasured));
        string asOfReported = MaxDate(rows.Select(r => r.AsOfReported));
        string periodLabel = rows.Count > 0 ? rows[0].PeriodStart.ToString("MMMM yyyy") : "";

        var vitalSigns = new List<VitalSign>
        {
            new("jobs_completed_ltm", "Jobs Completed LTM", jobsLtm, "count",
                "up", 6.1, "measured", asOfMeasured, "current", "high"),
            new("active_territories", "Active Territories", territoryCount, "count",
                "up", 4.3, "measured", asOfMeasured, "current", "high"),
            new("network_slot_fill_rate", "Network Slot Fill Rate", Math.Round(netSlotFill, 2), "ratio",
                "up", 2.0, "measured", asOfMeasured, "current", "high"),
            new("at_risk_territories", "At-Risk Territories", atRisk, "count",
                "up", 11.0, "measured", asOfMeasured, "current", "medium"),
            new("system_revenue_ltm", "System Revenue LTM", Math.Round(systemRevenueLtm), "dollars",
                null, null, "seeded", asOfReported, "seeded", "low"),
            new("royalty_revenue_ltm", "Royalty Revenue LTM", Math.Round(royaltyLtm), "dollars",
                null, null, "seeded", asOfReported, "seeded", "low"),
            new("same_territory_growth", "Same-Territory Growth", 4.3, "percent",
                null, null, "seeded", asOfReported, "seeded", "low"),
            new("network_nps", "Network NPS", networkNps, "score",
                null, null, "seeded", asOfReported, "seeded", "low"),
        };

        var brandComparison = _dims
            .GroupBy(d => d.BrandId)
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                var scores = g.Select(d => _scores[d.TerritoryId]).ToList();
                var territoryIds = g.Select(d => d.TerritoryId).ToHashSet();
                int wlCount = _watchlist.Count(w => territoryIds.Contains(w.TerritoryId));
                var brand = brandByNum.GetValueOrDefault(g.Key);
                return new BrandRollup(
                    g.Key, brand?.Name ?? "", brand?.Archetype ?? "", g.Count(),
                    (int)Math.Round(scores.Average(s => s.Composite)),
                    null,                                              // financial pending
                    AvgNullable(scores.Select(s => s.Customer)),
                    AvgNullable(scores.Select(s => s.Growth)),
                    AvgNullable(scores.Select(s => s.Compliance)),
                    wlCount,
                    TopIssueFor(territoryIds));
            })
            .ToList();

        var notes = new List<(string, string)>
        {
            ("info", "Financial metrics are illustrative/seeded and lag measured operational metrics."),
        };

        return new CorporateRollup(_latestPeriodId, periodLabel, 12, vitalSigns, brandComparison, notes);
    }

    private string TopIssueFor(HashSet<int> territoryIds)
    {
        var flag = _watchlist
            .Where(w => territoryIds.Contains(w.TerritoryId))
            .OrderByDescending(w => SeverityRank(w.Severity))
            .FirstOrDefault();
        return flag?.FlagKey switch
        {
            "nps_below_threshold" => "NPS deterioration",
            "no_show_spike" => "No-show spike",
            "revenue_deterioration" => "Revenue deterioration",
            "pending_financial_reporting" => "Financial reporting gap",
            _ => "None",
        };
    }

    private static DriverData MakeDriver(string subScore, string key, string label,
        double value, double benchmark, bool higherIsBetter, string provenance, DateTime? asOf)
    {
        bool good = higherIsBetter ? value >= benchmark : value <= benchmark;
        double gap = Math.Abs(value - benchmark) / (benchmark == 0 ? 1 : benchmark);
        string severity = gap > 0.25 ? "high" : gap > 0.10 ? "medium" : "low";
        return new DriverData(subScore, key, label, value, benchmark,
            good ? "positive" : "negative", severity, provenance,
            asOf?.ToString("yyyy-MM-dd") ?? "");
    }

    private static int? ToScore(double? v) => v is null ? null : (int)Math.Round(v.Value);

    private static int? AvgNullable(IEnumerable<int?> xs)
    {
        var vals = xs.Where(x => x is not null).Select(x => (double)x!.Value).ToList();
        return vals.Count > 0 ? (int)Math.Round(vals.Average()) : null;
    }

    private static string MaxDate(IEnumerable<DateTime?> dates)
    {
        var present = dates.Where(d => d.HasValue).Select(d => d!.Value).ToList();
        return present.Count > 0 ? present.Max().ToString("yyyy-MM-dd") : "";
    }

    private static int SeverityRank(string severity) =>
        severity switch { "high" => 3, "medium" => 2, "low" => 1, _ => 0 };
}
