using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// ── D3/D4/D5 — RecomputeRollup ──────────────────────────────────────────────
// The single sanctioned CORPORATE AGGREGATOR. It is the only reader that crosses
// the franchisee tenant boundary, and it does so on purpose, via
// IgnoreQueryFilters(): the franchisor is entitled to consolidate its network.
// Everything it touches operationally is read-only; its only writes are to the
// corporate read model (territory_period_summary + watchlist_flag).
//
//   D3  territory→period materialization + provenance/as-of stamping
//   D4  4 sub-scores + composite (franchise_ops_v1 weights, tenure-adjusted,
//       financial = null → pending_financial_reporting)
//   D5  watchlist flag rows (CONTRACT §4 rules; event publish is Track 2)
//
// Cadence for the demo is one on-demand/boot rebuild (CONTRACT decision). It is a
// full rebuild — idempotent: clears the read model and rewrites it, so re-runs
// never duplicate rows or flags.
public static class Rollup
{
    // ── Score config — the ONE documented weight block (franchise_ops_v1). ────
    // Track 2 (N3) moves these to score_weight_config; for v1 they live here,
    // versioned, so every score is reproducible and explainable.
    public const string ScoreVersion = "franchise_ops_v1";

    private const double WFinancial = 0.30;
    private const double WCustomer  = 0.25;
    private const double WGrowth    = 0.25;
    private const double WCompliance = 0.20;

    // Tenure ramp factors: launch/ramping territories are compared against a
    // discounted benchmark (a ramp curve), not the mature brand benchmark, so a
    // young unit producing 80% of mature output is not mislabeled at-risk.
    private static double TenureFactor(string band) => band switch
    {
        "launch"      => 0.55,
        "ramping"     => 0.78,
        "established" => 0.95,
        _             => 1.00, // mature
    };

    // Watchlist thresholds (CONTRACT §4).
    private const int NpsThreshold = 50;
    private const double NoShowThreshold = 0.12;
    private const double RevDeteriorationRatio = 0.60; // < 60% of brand avg

    public static void Recompute(AppDb db)
    {
        var now = DateTime.UtcNow;

        // ── Reference data (cross-tenant; brands/regions aren't tenant-filtered)
        var brands = db.Brands.AsNoTracking().ToList()
            .ToDictionary(b => b.Id, b => b);
        // Franchisee slug → numeric dashboard id (read model's franchisee_id,
        // CONTRACT §1). The operational isolation key is the slug; the corporate
        // read model is keyed by the Num bridge.
        var franchiseeNum = db.Franchisees.AsNoTracking().ToList()
            .ToDictionary(f => f.Id, f => f.Num);

        // ADR-19: RecomputeRollup is the ONE sanctioned corporate cross-tenant
        // aggregator. IgnoreQueryFilters() deliberately bypasses the FranchiseeId
        // tenant boundary here — the franchisor is entitled to consolidate its
        // whole network into the read model. This is the only code path allowed
        // to read across franchisees; every request-time reader stays filtered.
        var territories = db.Territories.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.RegionId != null)           // dashboard set only
            .ToList();
        var terrIds = territories.Select(t => t.Id).ToHashSet();

        // ── Measured plane: aggregate real Slot/Appointment rows by period ────
        // Pulled cross-tenant, grouped in memory by (territory, YYYYMM).
        var slots = db.Slots.IgnoreQueryFilters().AsNoTracking()
            .Where(s => terrIds.Contains(s.TerritoryId)).ToList();
        var appts = db.Appointments.IgnoreQueryFilters().AsNoTracking()
            .Where(a => terrIds.Contains(a.TerritoryId)).ToList();

        // total + booked slots, and as-of (latest data date) per (terr, period)
        var slotAgg = slots
            .GroupBy(s => (s.TerritoryId, Period: Pid(s.StartUtc)))
            .ToDictionary(g => g.Key, g => (
                Total: g.Count(),
                Booked: g.Count(s => s.IsBooked),
                AsOf: g.Max(s => s.StartUtc)));
        var apptAgg = appts
            .GroupBy(a => (a.TerritoryId, Period: Pid(a.StartUtc)))
            .ToDictionary(g => g.Key, g => (
                Completed: g.Count(a => a.Status == "completed"),
                NoShow: g.Count(a => a.Status == "no_show"),
                Booked: g.Count()));

        // ── Reported plane: one MonthlyReport per (territory, period) ──────────
        var reports = db.MonthlyReports.IgnoreQueryFilters().AsNoTracking()
            .Where(r => terrIds.Contains(r.TerritoryId)).ToList();

        // ── Pass A: assemble raw per-(territory, period) facts ────────────────
        var rows = new List<Row>();
        foreach (var r in reports)
        {
            var terr = territories.First(t => t.Id == r.TerritoryId);
            var brand = brands[r.BrandId];
            var key = (r.TerritoryId, r.PeriodId);

            slotAgg.TryGetValue(key, out var sa);
            apptAgg.TryGetValue(key, out var aa);

            int totalSlots = sa.Total;
            int bookedSlots = sa.Booked;
            double fill = totalSlots > 0 ? (double)bookedSlots / totalSlots : 0;
            double noShow = aa.Booked > 0 ? (double)aa.NoShow / aa.Booked : 0;

            double royaltyRate = brand.RoyaltyRate;
            double royaltyRevenue = r.GrossRevenue * royaltyRate;

            rows.Add(new Row
            {
                Terr = terr, Brand = brand, PeriodId = r.PeriodId,
                PeriodStart = r.PeriodStart, PeriodEnd = r.PeriodEnd,
                TenureBand = TenureBand(terr.OpenDate, r.PeriodEnd),
                JobsCompleted = aa.Completed,
                SlotFillRate = fill,
                NoShowRate = noShow,
                Reported = r.Reported,
                GrossRevenue = r.GrossRevenue,
                RoyaltyRate = royaltyRate,
                RoyaltyRevenue = royaltyRevenue,
                RoyaltyCollected = r.RoyaltyCollected,
                CollectionRate = royaltyRevenue > 0 ? r.RoyaltyCollected / royaltyRevenue : 0,
                SameTerritoryGrowth = r.SameTerritoryGrowth,
                NpsScore = r.NpsScore,
                GoogleRating = r.GoogleRating,
                QuoteToClose = r.QuoteToClose,
                AsOfMeasured = sa.Total > 0 ? sa.AsOf : r.PeriodEnd,
                AsOfReported = r.ReportedAt,
            });
        }

        // ── Pass B: brand-period benchmarks (the normalization baseline) ──────
        // Mean of each metric across a brand's territories in that period. Used
        // by the relative sub-score components; tenure factor discounts it per row.
        var bench = rows
            .GroupBy(x => (x.Brand.Id, x.PeriodId))
            .ToDictionary(g => g.Key, g => new Bench(
                Gross: Avg(g.Where(x => x.Reported).Select(x => x.GrossRevenue)),
                Fill: Avg(g.Select(x => x.SlotFillRate)),
                Nps: Avg(g.Select(x => (double)x.NpsScore))));

        // ── Pass C: scores (D4) + read-model rows, and gather for watchlist ───
        db.WatchlistFlags.RemoveRange(db.WatchlistFlags);
        db.TerritoryPeriodSummaries.RemoveRange(db.TerritoryPeriodSummaries);
        db.SaveChanges();

        foreach (var x in rows)
        {
            var b = bench[(x.Brand.Id, x.PeriodId)];
            double tf = TenureFactor(x.TenureBand);

            // financial: null whenever required reported inputs are missing.
            double? financial = !x.Reported ? (double?)null
                : 0.6 * Rel(x.GrossRevenue, b.Gross * tf) + 0.4 * Clamp01to100(x.CollectionRate * 100);

            double customer = 0.7 * Math.Clamp(x.NpsScore, 0, 100)
                            + 0.3 * Clamp01to100((x.GoogleRating - 3.0) / 2.0 * 100);

            double growth = 0.55 * Math.Clamp(50 + x.SameTerritoryGrowth * 250, 0, 100)
                          + 0.45 * Rel(x.SlotFillRate, b.Fill * tf);

            double compliance = 0.7 * Math.Clamp(100 - x.NoShowRate * 400, 0, 100)
                              + 0.3 * (x.Reported ? 100 : 0);

            // composite = weighted mean of AVAILABLE sub-scores (renormalized).
            double composite = WeightedAvailable(financial, customer, growth, compliance);

            string status = !x.Reported ? "pending_financial_reporting"
                          : financial == null ? "partial" : "complete";

            db.TerritoryPeriodSummaries.Add(new TerritoryPeriodSummary
            {
                TerritoryId = x.Terr.Id,
                BrandId = x.Brand.Num,
                RegionId = x.Terr.RegionId ?? 0,
                FranchiseeId = franchiseeNum.GetValueOrDefault(x.Terr.FranchiseeId),
                FranchiseeSlug = x.Terr.FranchiseeId,   // operational slug → Bravo's RBAC lens (CONTRACT §1 v1.2)
                PeriodId = x.PeriodId,
                PeriodStart = x.PeriodStart,
                PeriodEnd = x.PeriodEnd,
                TenureBand = x.TenureBand,
                JobsCompleted = x.JobsCompleted,
                SlotFillRate = Round(x.SlotFillRate, 4),
                NoShowRate = Round(x.NoShowRate, 4),
                GrossRevenue = Round(x.GrossRevenue, 2),
                RoyaltyRate = x.RoyaltyRate,
                RoyaltyRevenue = Round(x.RoyaltyRevenue, 2),
                RoyaltyCollected = Round(x.RoyaltyCollected, 2),
                SameTerritoryGrowth = Round(x.SameTerritoryGrowth, 4),
                NpsScore = x.NpsScore,
                GoogleRating = x.GoogleRating,
                QuoteToClose = Round(x.QuoteToClose, 4),
                FinancialScore = financial is null ? null : Round(financial.Value, 1),
                CustomerScore = Round(customer, 1),
                GrowthScore = Round(growth, 1),
                ComplianceScore = Round(compliance, 1),
                CompositeScore = Round(composite, 1),
                ScoreVersion = ScoreVersion,
                ScoreStatus = status,
                AsOfMeasured = x.AsOfMeasured,
                AsOfReported = x.AsOfReported,
                RefreshStatus = x.Reported ? "current" : "pending",
                LoadedAt = now,
            });
        }
        db.SaveChanges();

        ComputeWatchlist(db, rows, bench, now);
    }

    // ── D5 watchlist — flags on the LATEST period per territory ───────────────
    private static void ComputeWatchlist(AppDb db, List<Row> rows, Dictionary<(string, int), Bench> bench, DateTime now)
    {
        int latest = rows.Max(x => x.PeriodId);
        // per-territory history ordered newest→oldest for the consecutive-period rules
        var byTerr = rows.GroupBy(x => x.Terr.Id)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.PeriodId).ToList());

        foreach (var hist in byTerr.Values)
        {
            var cur = hist[0];
            if (cur.PeriodId != latest) continue;       // only flag current state
            var flags = new List<WatchlistFlag>();

            // pending_financial_reporting — current cycle's report not received
            if (!cur.Reported)
                flags.Add(Flag(cur, "pending_financial_reporting", "compliance", "high", now,
                    current: 0, threshold: 0,
                    "Financial score pending — current royalty-cycle reporting not received."));

            // nps_below_threshold (<50); high if also declined two consecutive periods
            if (cur.NpsScore < NpsThreshold)
            {
                bool declining = hist.Count >= 3 && hist[0].NpsScore < hist[1].NpsScore && hist[1].NpsScore < hist[2].NpsScore;
                flags.Add(Flag(cur, "nps_below_threshold", "customer", declining ? "high" : "medium", now,
                    current: cur.NpsScore, threshold: NpsThreshold,
                    declining
                        ? "NPS below brand threshold; declined two consecutive periods."
                        : "NPS below brand threshold."));
            }

            // revenue_deterioration — < 60% brand avg for the last 3 periods (seeded)
            if (hist.Count >= 3)
            {
                bool below3 = hist.Take(3).All(x =>
                {
                    var bm = bench[(x.Brand.Id, x.PeriodId)].Gross;
                    return x.Reported && bm > 0 && x.GrossRevenue < RevDeteriorationRatio * bm;
                });
                if (below3)
                {
                    double bm0 = bench[(cur.Brand.Id, cur.PeriodId)].Gross;
                    flags.Add(Flag(cur, "revenue_deterioration", "growth", "high", now,
                        current: Round(cur.GrossRevenue, 0), threshold: Round(RevDeteriorationRatio * bm0, 0),
                        "Gross revenue below 60% of brand average for three consecutive periods (illustrative/seeded)."));
                }
            }

            // no_show_spike — measured no-show above threshold for the last 2 periods
            if (hist.Count >= 2 && hist.Take(2).All(x => x.NoShowRate > NoShowThreshold))
            {
                flags.Add(Flag(cur, "no_show_spike", "compliance", "high", now,
                    current: Round(cur.NoShowRate, 3), threshold: NoShowThreshold,
                    "No-show rate above threshold for two consecutive periods (measured)."));
            }

            db.WatchlistFlags.AddRange(flags);
        }
        db.SaveChanges();
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    private static WatchlistFlag Flag(Row cur, string key, string category, string severity,
        DateTime now, double current, double threshold, string explanation) => new()
    {
        WatchlistFlagId = $"WF-{cur.Terr.Id}-{cur.PeriodId}-{key}",
        TerritoryId = cur.Terr.Id, BrandId = cur.Brand.Num, RegionId = cur.Terr.RegionId ?? 0,
        PeriodId = cur.PeriodId, FlagKey = key, Category = category, Severity = severity,
        Status = "open", CurrentValue = current, ThresholdValue = threshold,
        DetectedAt = now, Explanation = explanation,
    };

    // Relative score vs benchmark: 50 at benchmark, ±0.8 sensitivity, clamped.
    private static double Rel(double value, double benchmark)
        => benchmark <= 0 ? 50 : Math.Clamp(50 + 0.8 * (value / benchmark - 1) * 100, 0, 100);

    private static double Clamp01to100(double v) => Math.Clamp(v, 0, 100);

    private static double WeightedAvailable(double? fin, double cust, double growth, double comp)
    {
        double wsum = 0, acc = 0;
        if (fin is not null) { acc += WFinancial * fin.Value; wsum += WFinancial; }
        acc += WCustomer * cust; wsum += WCustomer;
        acc += WGrowth * growth; wsum += WGrowth;
        acc += WCompliance * comp; wsum += WCompliance;
        return wsum > 0 ? acc / wsum : 0;
    }

    private static int Pid(DateTime d) => d.Year * 100 + d.Month;

    private static string TenureBand(DateTime? open, DateTime asOf)
    {
        if (open is null) return "established";
        int months = (asOf.Year - open.Value.Year) * 12 + asOf.Month - open.Value.Month;
        return months < 6 ? "launch" : months < 18 ? "ramping" : months < 48 ? "established" : "mature";
    }

    private static double Avg(IEnumerable<double> xs) { var l = xs.ToList(); return l.Count > 0 ? l.Average() : 0; }
    private static double Round(double v, int d) => Math.Round(v, d);

    private record struct Bench(double Gross, double Fill, double Nps);

    private class Row
    {
        public Territory Terr = null!;
        public Brand Brand = null!;
        public int PeriodId;
        public DateTime PeriodStart, PeriodEnd;
        public string TenureBand = "";
        public int JobsCompleted;
        public double SlotFillRate, NoShowRate;
        public bool Reported;
        public double GrossRevenue, RoyaltyRate, RoyaltyRevenue, RoyaltyCollected, CollectionRate;
        public double SameTerritoryGrowth;
        public int NpsScore;
        public double GoogleRating, QuoteToClose;
        public DateTime? AsOfMeasured, AsOfReported;
    }
}
