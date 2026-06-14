namespace HfcDemo.Dashboard;

// ── Read-model seam (Bravo consumes; Alpha materializes) ────────────────────
// The dashboard endpoints read ONLY from this interface — never from the
// operational AppDb (Appointment/Slot). Today it's an in-memory stub; when
// Alpha's `territory_period_summary` lands (D2/D3), swap StubDashboardReadModel
// for an EF-backed impl behind this SAME interface — no DTO/shape change.
//
// Governance (corporate-rollup-readmodel-architect + franchise-kpi-metric-guard):
//   • Scores, roll-ups, watchlist flags, and drivers are PRE-COMPUTED (here, in
//     the stub ctor — the stand-in for the boot-time RecomputeRollup job).
//   • Request-time handlers do projection only: filter / sort / paginate / scope.
//     No aggregation, no scoring, no trailing-window math on the request path.
public interface IDashboardReadModel
{
    int LatestPeriodId { get; }

    // D9 registry dimension (incl. lat/lng for the future map bump).
    IReadOnlyList<TerritoryDim> Territories { get; }

    // D7 — pre-computed score + drivers for a territory/period (null if absent).
    TerritoryScore? Score(int territoryId, int periodId);

    // D6 — pre-rolled corporate vital signs + brand comparison (NOT recomputed
    // at request time). brandId/regionId narrow the brand-comparison rows only.
    CorporateRollup Corporate(int periodId, int trailingWindow, int? brandId, int? regionId);

    // D8 — pre-computed watchlist flag rows.
    IReadOnlyList<WatchlistFlag> Watchlist { get; }
}

// ── §1 read-model row — `territory_period_summary` (Alpha's storage shape) ───
// Held in-memory by the stub exactly as §1 defines it, so the Alpha swap is a
// storage change only. The denormalized display names live in TerritoryDim.
public sealed class TerritoryPeriodSummary
{
    public int TerritoryId { get; init; }
    public int BrandId { get; init; }
    public int RegionId { get; init; }
    public int? FranchiseeId { get; init; }
    public int PeriodId { get; init; }              // YYYYMM
    public string PeriodStart { get; init; } = "";
    public string PeriodEnd { get; init; } = "";
    public string TenureBand { get; init; } = "";   // launch|ramping|established|mature

    // measured plane (real)
    public int JobsCompleted { get; init; }
    public double SlotFillRate { get; init; }       // 0..1
    public double NoShowRate { get; init; }         // 0..1

    // seeded plane (illustrative; labeled in API)
    public double GrossRevenue { get; init; }
    public double RoyaltyRate { get; init; }
    public double RoyaltyRevenue { get; init; }
    public double RoyaltyCollected { get; init; }
    public double SameTerritoryGrowth { get; init; }
    public int NpsScore { get; init; }              // 0..100; seeded -> measured on Slice C
    public double GoogleRating { get; init; }
    public double QuoteToClose { get; init; }

    // scores (Alpha computes in RecomputeRollup; here baked in ctor)
    public double? FinancialScore { get; init; }    // null => pending_financial_reporting
    public double? CustomerScore { get; init; }
    public double? GrowthScore { get; init; }
    public double? ComplianceScore { get; init; }
    public double CompositeScore { get; init; }
    public string ScoreVersion { get; init; } = "franchise_ops_v1";
    public string ScoreStatus { get; init; } = "complete";

    // provenance / freshness
    public string AsOfMeasured { get; init; } = "";
    public string AsOfReported { get; init; } = "";
    public string RefreshStatus { get; init; } = "current";
    public string LoadedAt { get; init; } = "";
}

// ── Dimension + pre-computed projections (the rest of the read model) ────────
public sealed record TerritoryDim(
    int TerritoryId, string TerritoryName, int BrandId, string BrandName,
    int RegionId, string RegionName, int? FranchiseeId, string FranchiseeName,
    string OpenDate, string TenureBand, string Archetype, string Status,
    double Lat, double Lng,
    // Operational franchisee SLUG (Franchisee.Id) carried alongside the numeric
    // FranchiseeId — CONTRACT §1 v1.2's `franchisee_slug`. The bridge Bravo's RBAC
    // franchisee lens matches on: Slice A's token claim is the slug, so the scope
    // resolver compares claim→dim slug-to-slug instead of fail-closing on the
    // numeric id mismatch. Trailing-optional so it stays purely additive (the stub
    // leaves it "" — its franchisee lens was already fail-closed by design).
    string FranchiseeSlug = "");

public sealed record DriverData(
    string SubScore, string MetricKey, string Label, double Value, double Benchmark,
    string Impact, string Severity, string ProvenanceType, string AsOfDate,
    // CONTRACT §2 v1.3, additive: drivers now carry refreshStatus too, so EVERY
    // metric the dashboard emits satisfies the ADR-20 invariant (provenanceType +
    // asOfDate + refreshStatus). Trailing field — purely additive, existing fields
    // byte-identical; mirrors the v1.1 (map) / v1.2 (franchisee_slug) precedents.
    string RefreshStatus = "current");

public sealed record TerritoryScore(
    int TerritoryId, int PeriodId, string TerritoryName, string BrandName, string RegionName,
    string ScoreStatus, string ScoreVersionId, string ScoreOwnerTeam,
    int Composite, int? Financial, int? Customer, int? Growth, int? Compliance,
    IReadOnlyList<(string Type, string Message)> Notes,
    IReadOnlyList<DriverData> Drivers);

public sealed record VitalSign(
    string MetricKey, string Label, double Value, string Unit,
    string? TrendDirection, double? TrendPercent,
    string ProvenanceType, string AsOfDate, string RefreshStatus, string ConfidenceLevel);

public sealed record BrandRollup(
    int BrandId, string BrandName, string Archetype, int TerritoryCount,
    int CompositeHealthScore, int? FinancialScore, int? CustomerScore, int? GrowthScore,
    int? ComplianceScore, int WatchlistCount, string TopIssue);

public sealed record CorporateRollup(
    int PeriodId, string PeriodLabel, int TrailingWindowMonths,
    IReadOnlyList<VitalSign> VitalSigns,
    IReadOnlyList<BrandRollup> BrandComparison,
    IReadOnlyList<(string Severity, string Message)> DataNotes);

public sealed record WatchlistFlag(
    string WatchlistFlagId, int TerritoryId, string TerritoryName, string BrandName,
    string RegionName, string FlagKey, string Category, string Severity, string Status,
    double CurrentValue, double ThresholdValue, string DetectedAt, string Explanation);
