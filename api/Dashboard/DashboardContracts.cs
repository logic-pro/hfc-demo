using System.Text.Json.Serialization;

namespace HfcDemo.Dashboard;

// ── API DTOs (Bravo owns) — CONTRACT §2, FROZEN ─────────────────────────────
// These are the wire shapes Charlie builds against. They are deliberately
// DECOUPLED from the read-model row (§1 / TerritoryPeriodSummary): Bravo owns
// this seam, Alpha owns the storage. Match §2 byte-for-byte so Charlie's
// fixtures (copied verbatim from §2) light up the moment the base URL is live.
//
// Null policy: the app's JSON default keeps nulls (so `financial`/`financialScore`
// null is emitted — it *means* "pending financial reporting", a feature). The
// only fields we omit-when-null are the optional trend fields, which §2 shows
// present on some metrics and absent on others.

// GET /api/dashboard/corporate
public record CorporateDashboardDto(
    PeriodDto Period,
    ScopeDto Scope,
    IReadOnlyList<MetricDto> VitalSigns,
    IReadOnlyList<BrandComparisonDto> BrandComparison,
    IReadOnlyList<DataNoteDto> DataNotes);

public record PeriodDto(int PeriodId, string Label, int TrailingWindowMonths);

public record ScopeDto(string ScopeLevel, int[] TerritoryIds);

public record MetricDto(
    string MetricKey,
    string Label,
    double Value,
    string Unit,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TrendDirection,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? TrendPercent,
    string ProvenanceType,
    string AsOfDate,
    string RefreshStatus,
    string ConfidenceLevel);

public record BrandComparisonDto(
    int BrandId,
    string BrandName,
    string Archetype,
    int TerritoryCount,
    int CompositeHealthScore,
    int? FinancialScore,
    int? CustomerScore,
    int? GrowthScore,
    int? ComplianceScore,
    int WatchlistCount,
    string TopIssue);

public record DataNoteDto(string Severity, string Message);

// GET /api/territories/{id}/health-score
public record HealthScoreDto(
    int TerritoryId,
    string TerritoryName,
    string BrandName,
    string RegionName,
    int PeriodId,
    string ScoreStatus,
    ScoreVersionDto ScoreVersion,
    ScoresDto Scores,
    IReadOnlyList<ScoreNoteDto> ScoreNotes,
    IReadOnlyList<DriverDto> Drivers);

public record ScoreVersionDto(string ScoreVersionId, string OwnerTeam);

public record ScoresDto(int Composite, int? Financial, int? Customer, int? Growth, int? Compliance);

public record ScoreNoteDto(string Type, string Message);

public record DriverDto(
    string SubScore,
    string MetricKey,
    string Label,
    double Value,
    double Benchmark,
    string Impact,
    string Severity,
    string ProvenanceType,
    string AsOfDate,
    // CONTRACT §2 v1.3, ADDITIVE — appended last so the §2 driver shape stays
    // byte-identical and Charlie's verbatim fixtures keep deserializing. Closes
    // the provenance-completeness gap: drivers were the one metric array carrying
    // only two of the three ADR-20 fields; now every metric carries all three.
    string RefreshStatus);

// GET /api/dashboard/watchlist
public record WatchlistDto(IReadOnlyList<WatchlistItemDto> Items, int TotalCount);

public record WatchlistItemDto(
    string WatchlistFlagId,
    int TerritoryId,
    string TerritoryName,
    string BrandName,
    string RegionName,
    string FlagKey,
    string Category,
    string Severity,
    string Status,
    double CurrentValue,
    double ThresholdValue,
    string DetectedAt,
    string Explanation);

// GET /api/dashboard/map  (CONTRACT v1.1, additive — see §2)
// Lean projection for the territory-health map (D12): one dot per territory,
// shaded by composite score. Separate from /api/territories on purpose — the
// registry item carries no score, the map needs no franchisee/openDate.
public record MapDto(IReadOnlyList<MapItemDto> Items, int TotalCount);

public record MapItemDto(
    int TerritoryId,
    string TerritoryName,
    int BrandId,
    string BrandName,
    int RegionId,
    double Lat,
    double Lng,
    int CompositeScore,
    string ScoreStatus,
    bool AtRisk);

// GET /api/territories
public record TerritoryPageDto(
    IReadOnlyList<TerritoryListItemDto> Items,
    int Page,
    int PageSize,
    int TotalCount);

public record TerritoryListItemDto(
    int TerritoryId,
    string TerritoryName,
    int BrandId,
    string BrandName,
    int RegionId,
    string RegionName,
    string FranchiseeName,
    string OpenDate,
    string TenureBand,
    string Archetype,
    string Status);
// NOTE: lat/long intentionally NOT here — CONTRACT §2 territory item omits them.
// The map (D12) needs them; that is a proposed v1→v1.1 CONTRACT bump, not a fork.
// Read model already carries lat/lng (see TerritoryDim) ready for that bump.
