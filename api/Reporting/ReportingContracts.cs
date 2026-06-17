using System.Text.Json.Serialization;

namespace HfcDemo.Reporting;

// ── Reporting API DTOs (alpha owns) — docs/backoffice/CONTRACTS.md §C2 ────────
// Read-only query layer over the EXISTING corporate read-model. These are the
// wire shapes charlie (Reports UI) builds against. Deliberately decoupled from
// the §1 storage row and the §2 dashboard DTOs (which alpha must NOT touch).

// ── GET /api/reports/catalog ──────────────────────────────────────────────────
public record ReportCatalogDto(
    IReadOnlyList<CatalogMetricDto> Metrics,
    IReadOnlyList<CatalogDimensionDto> Dimensions,
    IReadOnlyList<CatalogPeriodDto> Periods,
    IReadOnlyList<string> Filters);

public record CatalogMetricDto(
    string Key, string Label, string Unit, string Aggregation,
    string ProvenanceType, bool HigherIsBetter, bool Nullable, bool Illustrative,
    string Description);

public record CatalogDimensionDto(string Key, string Label, bool HasId);

public record CatalogPeriodDto(int PeriodId, string Label, bool IsLatest);

// ── POST /api/reports/query ─────────────────────────────────────────────────
public record ReportQueryRequest(
    List<string>? Metrics,
    List<string>? Dimensions,
    int? Period,
    ReportFilters? Filters);

public record ReportFilters(
    int? BrandId = null,
    int? RegionId = null,
    string? Archetype = null,
    string? TenureBand = null,
    string? Status = null,
    string? RiskBand = null,                 // healthy | watch | at_risk
    List<int>? TerritoryIds = null);

public record ReportQueryResultDto(
    IReadOnlyList<ReportColumnDto> Columns,
    IReadOnlyList<IDictionary<string, object?>> Rows,
    ReportMetaDto Meta);

public record ReportColumnDto(
    string Key, string Label, string Kind, string Type,
    // metric-only fields are omitted-when-null so dimension columns stay lean
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Unit,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Aggregation,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ProvenanceType,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Illustrative,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? HigherIsBetter,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? HasId);

public record ReportMetaDto(
    ReportPeriodDto Period,
    ReportScopeDto Scope,
    int RowCount,
    int TerritoryCount,
    string AsOfMeasured,
    string AsOfReported,
    string GeneratedAt,
    IReadOnlyList<ReportProvenanceDto> Provenance,
    IReadOnlyList<ReportNoteDto> Notes);

public record ReportPeriodDto(int PeriodId, string Label);
public record ReportScopeDto(string ScopeLevel, int[] TerritoryIds);
public record ReportProvenanceDto(string MetricKey, string ProvenanceType, string AsOfDate, bool Illustrative);
public record ReportNoteDto(string Severity, string Message);

// ── Saved reports ────────────────────────────────────────────────────────────
public record SavedReportInput(string? Name, string? Description, ReportQueryRequest? Definition);

public record SavedReportDto(
    string Id, string Name, string Description, ReportQueryRequest Definition,
    string OwnerScopeLevel, int? OwnerScopeId, string CreatedAt, string UpdatedAt);
