namespace HfcDemo.Dashboard;

// In-memory stub of the corporate read model. Everything is computed ONCE in
// the constructor — this is the demo-time stand-in for Alpha's boot-time
// `RecomputeRollup` job. Request-time handlers never recompute any of it.
//
// Swap target: replace this registration with an EF-backed IDashboardReadModel
// that SELECTs `territory_period_summary` when Alpha lands D2/D3. The §1 row
// shape (TerritoryPeriodSummary) and all §2 DTOs stay byte-for-byte identical.
public sealed class StubDashboardReadModel : IDashboardReadModel
{
    public int LatestPeriodId => 202605;            // May 2026
    private const string AsOfMeasured = "2026-06-12";
    private const string AsOfReported = "2026-05-31";

    // Documented score benchmarks (franchise_ops_v1). In Track 2 these move to
    // score_weight_config; here they exist only to LABEL pre-computed drivers,
    // never to recompute a score at request time.
    private const double NpsBenchmark = 58;
    private const double SlotFillBenchmark = 0.76;
    private const double NoShowBenchmark = 0.08;

    private static readonly string[] Regions = { "", "West", "Southeast" };
    private static readonly (string Name, string Archetype)[] Brands =
    {
        ("", ""),
        ("Budget Blinds", "project_installation"),
        ("Two Maids", "recurring_service"),
        ("Aussie Pet Mobile", "on_demand_service"),
    };

    private readonly List<TerritoryPeriodSummary> _rows = new();
    private readonly List<TerritoryDim> _dims = new();
    private readonly Dictionary<int, TerritoryScore> _scores = new();
    private readonly List<WatchlistFlag> _watchlist = new();
    private readonly CorporateRollup _corporate;

    public IReadOnlyList<TerritoryDim> Territories => _dims;
    public IReadOnlyList<WatchlistFlag> Watchlist => _watchlist;

    public TerritoryScore? Score(int territoryId, int periodId) =>
        periodId == LatestPeriodId && _scores.TryGetValue(territoryId, out var s) ? s : null;

    public CorporateRollup Corporate(int periodId, int trailingWindow, int? brandId, int? regionId)
    {
        var brands = _corporate.BrandComparison
            .Where(b => brandId is null || b.BrandId == brandId)
            .ToList();
        // regionId can't narrow a portfolio brand roll-up without re-aggregating
        // (forbidden at request time); we note it rather than fake it.
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

    public StubDashboardReadModel()
    {
        // ── Seed: 24 territories, deliberately dramatic spread (D1 intent) ───
        // (name, brand 1-3, region 1-2, tenure, status, lat, lng,
        //  composite, customer, growth, compliance, jobs, slotFill, noShow,
        //  nps, grossRevenue, royaltyRate)  — financial sub-score is pending.
        var seed = new (string Name, int Brand, int Region, string Tenure, string Status,
            double Lat, double Lng, int Comp, int Cust, int Grow, int Comp2,
            int Jobs, double Slot, double NoShow, int Nps, double Rev, double Royalty)[]
        {
            ("Orange County North", 1, 1, "mature",      "open", 33.72, -117.83, 67, 42, 71, 85,  920, 0.81, 0.06, 34, 2_340_000, 0.05),
            ("Orange County South", 1, 1, "established",  "open", 33.59, -117.87, 82, 80, 84, 88,  870, 0.79, 0.05, 61, 2_180_000, 0.05),
            ("San Diego Coast",     1, 1, "mature",      "open", 32.85, -117.27, 91, 88, 93, 90, 1010, 0.88, 0.03, 72, 2_910_000, 0.05),
            ("Inland Empire",       1, 1, "ramping",     "open", 34.06, -117.19, 44, 38, 49, 52,  410, 0.62, 0.14, 41, 1_020_000, 0.05),
            ("Phoenix Metro",       1, 2, "established",  "open", 33.45, -112.07, 76, 70, 78, 81,  780, 0.77, 0.07, 58, 1_960_000, 0.05),
            ("Tucson",              1, 2, "ramping",     "open", 32.22, -110.97, 39, 31, 44, 47,  300, 0.58, 0.17, 29, 760_000,  0.05),
            ("Sacramento Valley",   1, 1, "mature",      "open", 38.58, -121.49, 79, 75, 80, 84,  840, 0.80, 0.06, 60, 2_050_000, 0.05),
            ("Las Vegas",           1, 2, "established",  "open", 36.17, -115.14, 71, 66, 73, 79,  690, 0.74, 0.08, 55, 1_730_000, 0.05),

            ("Atlanta North",       2, 2, "mature",      "open", 34.07, -84.28,  85, 83, 86, 89,  640, 0.84, 0.04, 66, 1_540_000, 0.06),
            ("Atlanta South",       2, 2, "established",  "open", 33.55, -84.40,  73, 69, 74, 80,  560, 0.76, 0.07, 57, 1_290_000, 0.06),
            ("Charlotte",           2, 2, "established",  "open", 35.23, -80.84,  68, 60, 70, 78,  520, 0.73, 0.09, 52, 1_180_000, 0.06),
            ("Raleigh-Durham",      2, 2, "ramping",     "open", 35.84, -78.78,  41, 35, 46, 49,  240, 0.60, 0.15, 38, 540_000,  0.06),
            ("Nashville",           2, 2, "mature",      "open", 36.16, -86.78,  88, 86, 89, 91,  710, 0.86, 0.04, 70, 1_700_000, 0.06),
            ("Portland",            2, 1, "established",  "open", 45.52, -122.68, 64, 56, 66, 74,  470, 0.71, 0.10, 49, 1_060_000, 0.06),
            ("Seattle",             2, 1, "mature",      "open", 47.61, -122.33, 80, 77, 82, 85,  680, 0.81, 0.05, 62, 1_620_000, 0.06),
            ("Denver",              2, 1, "ramping",     "open", 39.74, -104.99, 35, 28, 40, 44,  190, 0.55, 0.19, 31, 430_000,  0.06),

            ("Dallas-Fort Worth",   3, 2, "mature",      "open", 32.78, -96.80,  83, 79, 85, 87,  1120, 0.85, 0.05, 64, 980_000,  0.07),
            ("Houston",             3, 2, "established",  "open", 29.76, -95.37,  70, 64, 72, 78,  900, 0.75, 0.08, 54, 820_000,  0.07),
            ("Austin",              3, 2, "ramping",     "open", 30.27, -97.74,  58, 50, 61, 69,  640, 0.69, 0.11, 47, 560_000,  0.07),
            ("Miami-Dade",          3, 2, "established",  "open", 25.76, -80.19,  46, 39, 50, 55,  520, 0.64, 0.13, 42, 470_000,  0.07),
            ("Tampa Bay",           3, 2, "mature",      "open", 27.95, -82.46,  77, 73, 79, 82,  830, 0.78, 0.06, 59, 760_000,  0.07),
            ("Los Angeles West",    3, 1, "mature",      "open", 34.05, -118.45, 90, 87, 92, 89, 1280, 0.87, 0.03, 71, 1_140_000, 0.07),
            ("San Francisco Bay",   3, 1, "established",  "open", 37.77, -122.42, 81, 78, 83, 84,  990, 0.82, 0.05, 63, 990_000,  0.07),
            ("Fresno",              3, 1, "launch",      "open", 36.74, -119.79, 33, 26, 38, 43,  120, 0.52, 0.21, 28, 210_000,  0.07),
        };

        int wf = 9001;
        for (int i = 0; i < seed.Length; i++)
        {
            var s = seed[i];
            int territoryId = i + 1;
            int franchiseeId = 100 + ((territoryId - 1) / 3 + 1);   // 3 territories per franchisee
            string franchiseeName = $"{Regions[s.Region]} Franchise Group {franchiseeId}";
            string brandName = Brands[s.Brand].Name;
            string archetype = Brands[s.Brand].Archetype;
            string regionName = Regions[s.Region];

            // Financial sub-score is ALWAYS pending in the demo (no reported
            // royalty cycle) → null score, status partial. Seeds still display
            // as labeled tiles, but never fabricate the *score* from them.
            double royaltyRevenue = s.Rev * s.Royalty;
            string scoreStatus = "partial";

            _rows.Add(new TerritoryPeriodSummary
            {
                TerritoryId = territoryId,
                BrandId = s.Brand,
                RegionId = s.Region,
                FranchiseeId = franchiseeId,
                PeriodId = LatestPeriodId,
                PeriodStart = "2026-05-01",
                PeriodEnd = "2026-05-31",
                TenureBand = s.Tenure,
                JobsCompleted = s.Jobs,
                SlotFillRate = s.Slot,
                NoShowRate = s.NoShow,
                GrossRevenue = s.Rev,
                RoyaltyRate = s.Royalty,
                RoyaltyRevenue = royaltyRevenue,
                RoyaltyCollected = royaltyRevenue * 0.94,
                SameTerritoryGrowth = 0.04,
                NpsScore = s.Nps,
                GoogleRating = 4.2,
                QuoteToClose = 0.38,
                FinancialScore = null,
                CustomerScore = s.Cust,
                GrowthScore = s.Grow,
                ComplianceScore = s.Comp2,
                CompositeScore = s.Comp,
                ScoreStatus = scoreStatus,
                AsOfMeasured = AsOfMeasured,
                AsOfReported = AsOfReported,
                RefreshStatus = "current",
                LoadedAt = AsOfMeasured + "T06:00:00Z",
            });

            _dims.Add(new TerritoryDim(
                territoryId, s.Name, s.Brand, brandName, s.Region, regionName,
                franchiseeId, franchiseeName, OpenDateFor(s.Tenure), s.Tenure,
                archetype, s.Status, s.Lat, s.Lng));

            // ── Pre-computed drivers (top ± movers vs benchmark) ─────────────
            var drivers = new List<DriverData>
            {
                MakeDriver("customer", "nps_score", "NPS", s.Nps, NpsBenchmark, higherIsBetter: true, "seeded"),
                MakeDriver("growth", "slot_fill_rate", "Slot Fill Rate", s.Slot, SlotFillBenchmark, higherIsBetter: true, "measured"),
                MakeDriver("compliance", "no_show_rate", "No-Show Rate", s.NoShow, NoShowBenchmark, higherIsBetter: false, "measured"),
            }
            .OrderByDescending(d => SeverityRank(d.Severity))
            .ToList();

            _scores[territoryId] = new TerritoryScore(
                territoryId, LatestPeriodId, s.Name, brandName, regionName,
                scoreStatus, "franchise_ops_v1", "Franchise Ops",
                s.Comp, null, s.Cust, s.Grow, s.Comp2,
                new[] { ("missing_input",
                    "Financial score pending — current royalty-cycle reporting not received.") },
                drivers);

            // ── Pre-computed watchlist flags ─────────────────────────────────
            if (s.Nps < 50)
                _watchlist.Add(new WatchlistFlag($"WF-{wf++}", territoryId, s.Name, brandName, regionName,
                    "nps_below_threshold", "customer", s.Nps < 35 ? "high" : "medium", "open",
                    s.Nps, 50, AsOfMeasured + "T08:30:00Z",
                    "NPS below brand threshold; declined two consecutive periods."));
            if (s.NoShow > 0.12)
                _watchlist.Add(new WatchlistFlag($"WF-{wf++}", territoryId, s.Name, brandName, regionName,
                    "no_show_spike", "operations", s.NoShow > 0.16 ? "high" : "medium", "open",
                    s.NoShow, 0.12, AsOfMeasured + "T08:30:00Z",
                    "No-show rate exceeded threshold across two periods."));
            if (s.Comp < 45)
                _watchlist.Add(new WatchlistFlag($"WF-{wf++}", territoryId, s.Name, brandName, regionName,
                    "pending_financial_reporting", "financial", "medium", "open",
                    0, 1, AsOfMeasured + "T08:30:00Z",
                    "No reported revenue this royalty cycle; financial score withheld."));
        }

        _corporate = BuildCorporate();
    }

    // ── Boot-time roll-up (territory → brand → corporate) ────────────────────
    private CorporateRollup BuildCorporate()
    {
        int territoryCount = _dims.Count;
        int atRisk = _rows.Count(r => r.CompositeScore < 50);
        int jobsLtm = _rows.Sum(r => r.JobsCompleted) * 12;             // illustrative LTM
        double systemRevenueLtm = _rows.Sum(r => r.GrossRevenue) * 12;
        double royaltyLtm = _rows.Sum(r => r.RoyaltyRevenue) * 12;
        double netSlotFill = _rows.Average(r => r.SlotFillRate);
        int networkNps = (int)Math.Round(_rows.Average(r => r.NpsScore));

        var vitalSigns = new List<VitalSign>
        {
            new("jobs_completed_ltm", "Jobs Completed LTM", jobsLtm, "count",
                "up", 6.1, "measured", AsOfMeasured, "current", "high"),
            new("active_territories", "Active Territories", territoryCount, "count",
                "up", 4.3, "measured", AsOfMeasured, "current", "high"),
            new("network_slot_fill_rate", "Network Slot Fill Rate", Math.Round(netSlotFill, 2), "ratio",
                "up", 2.0, "measured", AsOfMeasured, "current", "high"),
            new("at_risk_territories", "At-Risk Territories", atRisk, "count",
                "up", 11.0, "measured", AsOfMeasured, "current", "medium"),
            new("system_revenue_ltm", "System Revenue LTM", Math.Round(systemRevenueLtm), "dollars",
                null, null, "seeded", AsOfReported, "seeded", "low"),
            new("royalty_revenue_ltm", "Royalty Revenue LTM", Math.Round(royaltyLtm), "dollars",
                null, null, "seeded", AsOfReported, "seeded", "low"),
            new("same_territory_growth", "Same-Territory Growth", 4.3, "percent",
                null, null, "seeded", AsOfReported, "seeded", "low"),
            new("network_nps", "Network NPS", networkNps, "score",
                null, null, "seeded", AsOfReported, "seeded", "low"),
        };

        var brandComparison = _dims
            .GroupBy(d => d.BrandId)
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                var scores = g.Select(d => _scores[d.TerritoryId]).ToList();
                var territoryIds = g.Select(d => d.TerritoryId).ToHashSet();
                int wlCount = _watchlist.Count(w => territoryIds.Contains(w.TerritoryId));
                return new BrandRollup(
                    g.Key, Brands[g.Key].Name, Brands[g.Key].Archetype, g.Count(),
                    (int)Math.Round(scores.Average(s => s.Composite)),
                    null,                                              // financial pending
                    (int)Math.Round(scores.Average(s => (double)s.Customer!)),
                    (int)Math.Round(scores.Average(s => (double)s.Growth!)),
                    (int)Math.Round(scores.Average(s => (double)s.Compliance!)),
                    wlCount,
                    TopIssueFor(territoryIds));
            })
            .ToList();

        var notes = new List<(string, string)>
        {
            ("info", "Financial metrics are illustrative/seeded and lag measured operational metrics."),
        };

        return new CorporateRollup(LatestPeriodId, "May 2026", 12, vitalSigns, brandComparison, notes);
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
            "pending_financial_reporting" => "Financial reporting gap",
            _ => "None",
        };
    }

    private static DriverData MakeDriver(string subScore, string key, string label,
        double value, double benchmark, bool higherIsBetter, string provenance)
    {
        bool good = higherIsBetter ? value >= benchmark : value <= benchmark;
        double gap = Math.Abs(value - benchmark) / (benchmark == 0 ? 1 : benchmark);
        string severity = gap > 0.25 ? "high" : gap > 0.10 ? "medium" : "low";
        // refreshStatus follows the provenance plane (CONTRACT §2 v1.3): measured
        // => "current", seeded => "seeded" — every driver now carries all three.
        return new DriverData(subScore, key, label, value, benchmark,
            good ? "positive" : "negative", severity, provenance, AsOfMeasured,
            provenance == "measured" ? "current" : "seeded");
    }

    private static int SeverityRank(string severity) =>
        severity switch { "high" => 3, "medium" => 2, "low" => 1, _ => 0 };

    private static string OpenDateFor(string tenure) => tenure switch
    {
        "mature" => "2018-03-01",
        "established" => "2021-06-01",
        "ramping" => "2024-01-15",
        "launch" => "2025-09-01",
        _ => "2022-04-01",
    };
}
