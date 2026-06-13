namespace HfcDemo;

// ── Corporate read model (Alpha owns) ───────────────────────────────────────
// These tables are the franchisor's pre-aggregated reporting plane. The CEO
// dashboard reads ONLY from here — never from raw franchisee operational rows.
// RecomputeRollup is the single sanctioned cross-tenant reader that populates
// them (it bypasses the tenant query filter on purpose); everything downstream
// is read-only and scope-filtered by Bravo before query. There is deliberately
// NO tenant query filter on these entities: they are the corporate plane, and
// the franchisee/corporate lens is a scope filter applied pre-query, per the
// CONTRACT RBAC decision — not row-level tenancy.

// territory_period_summary — CONTRACT §1, verbatim. Wide, typed, one row per
// (territory_id, period_id). Each metric group carries its provenance trio
// (the per-row as_of_* + refresh_status summarize the per-metric planes).
public class TerritoryPeriodSummary
{
    public int TerritoryId { get; set; }          // FK   (composite key part 1)
    public int BrandId { get; set; }              // Brand.Num, denormalized for fast filter
    public int RegionId { get; set; }             // denormalized
    public int FranchiseeId { get; set; }
    public int PeriodId { get; set; }             // YYYYMM (composite key part 2)
    public DateTime PeriodStart { get; set; }
    public DateTime PeriodEnd { get; set; }
    public string TenureBand { get; set; } = "";  // launch | ramping | established | mature

    // ── measured plane (real — derived from Slot/Appointment) ────────────────
    public int JobsCompleted { get; set; }
    public double SlotFillRate { get; set; }      // 0..1
    public double NoShowRate { get; set; }        // 0..1

    // ── seeded plane (illustrative; labeled in API) ──────────────────────────
    public double GrossRevenue { get; set; }
    public double RoyaltyRate { get; set; }       // 0..1
    public double RoyaltyRevenue { get; set; }    // = GrossRevenue * RoyaltyRate
    public double RoyaltyCollected { get; set; }
    public double SameTerritoryGrowth { get; set; } // seeded (needs history)
    public int NpsScore { get; set; }             // 0..100; seeded -> measured on Slice C
    public double GoogleRating { get; set; }
    public double QuoteToClose { get; set; }      // 0..1

    // ── scores (Alpha computes in RecomputeRollup; see CONTRACT §3) ───────────
    public double? FinancialScore { get; set; }   // null => pending_financial_reporting
    public double? CustomerScore { get; set; }
    public double? GrowthScore { get; set; }
    public double? ComplianceScore { get; set; }
    public double CompositeScore { get; set; }    // 0..100, for sort/color only
    public string ScoreVersion { get; set; } = "";
    public string ScoreStatus { get; set; } = ""; // complete | partial | pending_financial_reporting

    // ── provenance / freshness (per-row summary) ─────────────────────────────
    public DateTime? AsOfMeasured { get; set; }
    public DateTime? AsOfReported { get; set; }
    public string RefreshStatus { get; set; } = ""; // current | stale | missing | pending | seeded
    public DateTime LoadedAt { get; set; }
}

// watchlist_flag — CONTRACT §4. Stored as rows (event publish is Track 2).
// One row per active flag on a (territory, period). Recomputed by the rollup;
// the id is deterministic so a re-run is idempotent (no duplicate flags).
public class WatchlistFlag
{
    public string WatchlistFlagId { get; set; } = ""; // e.g. "WF-1-202605-nps_below_threshold"
    public int TerritoryId { get; set; }
    public int BrandId { get; set; }                  // Brand.Num
    public int RegionId { get; set; }
    public int PeriodId { get; set; }
    public string FlagKey { get; set; } = "";         // nps_below_threshold | revenue_deterioration | no_show_spike | pending_financial_reporting
    public string Category { get; set; } = "";        // customer | growth | compliance
    public string Severity { get; set; } = "";        // high | medium | low
    public string Status { get; set; } = "open";      // open (resolution is Track 2)
    public double CurrentValue { get; set; }
    public double ThresholdValue { get; set; }
    public DateTime DetectedAt { get; set; }
    public string Explanation { get; set; } = "";
}
