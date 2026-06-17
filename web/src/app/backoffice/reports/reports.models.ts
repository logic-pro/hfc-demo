// Reporting view-model contracts — Back-Office Wave 1, CONTRACTS §C2 (v1.0).
//
// These mirror alpha's SHIPPED `/api/reports/*` wire shapes EXACTLY — the
// camelCase JSON of `api/Reporting/ReportingContracts.cs`. Keeping the local
// mock (reports.fixtures.ts) on the identical shape means flipping the `live`
// seam in ReportsDataService is the only change between fixtures and the live
// API — no component or fixture ever maps between two shapes (the dashboard's
// D17 fixtures→live pattern).
//
// Provenance is first-class on every metric: the product's "measured vs
// illustrative" honesty story (D16) carries through reporting, so a CEO can
// never mistake a seeded placeholder for an operational fact. The API decides
// the plane (`provenanceType`) and the honesty flag (`illustrative`) per metric
// over the contributing rows — the UI only renders them.

// `measured` (app-native) · `seeded` (illustrative/reported) · `derived`
// (a score over mixed planes) · `mixed` (a grouped metric spanning >1 plane).
export type ProvenanceType = 'measured' | 'seeded' | 'derived' | 'mixed';
// Wire units are open strings on the DTO; these are the values §C2 emits.
export type Unit = 'score' | 'count' | 'ratio' | 'dollars' | 'percent';

// ── GET /api/reports/catalog → ReportCatalogDto ───────────────────────────────
export interface CatalogMetric {
  key: string;
  label: string;
  unit: string;
  aggregation: string; // sum | avg | count | count_at_risk | sum_watchlist
  provenanceType: ProvenanceType;
  higherIsBetter: boolean;
  nullable: boolean;
  illustrative: boolean;
  description: string;
}

export interface CatalogDimension {
  key: string;
  label: string;
  hasId: boolean;
}

export interface CatalogPeriod {
  periodId: number;
  label: string;
  isLatest: boolean;
}

export interface ReportCatalog {
  metrics: CatalogMetric[];
  dimensions: CatalogDimension[];
  periods: CatalogPeriod[];
  /** Supported filter keys, e.g. ["brandId","regionId","archetype",…,"territoryIds"]. */
  filters: string[];
}

// ── POST /api/reports/query ──────────────────────────────────────────────────
export interface ReportFilters {
  brandId?: number | null;
  regionId?: number | null;
  archetype?: string | null;
  tenureBand?: string | null;
  status?: string | null;
  riskBand?: string | null; // healthy | watch | at_risk
  territoryIds?: number[] | null;
}

export interface ReportQueryRequest {
  /** Metric keys, required, ≥1, in display order. */
  metrics: string[];
  /** Group-by dimension keys; 0..n. `[]` → a single grand-total row. */
  dimensions: string[];
  /** Optional; defaults to the latest period server-side. */
  period?: number;
  filters?: ReportFilters;
}

export type ColumnKind = 'dimension' | 'metric';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  type: string; // "string" (dimension) | "number" (metric)
  // metric-only fields (omitted on dimension columns by the API)
  unit?: string;
  aggregation?: string;
  provenanceType?: ProvenanceType;
  illustrative?: boolean;
  higherIsBetter?: boolean;
  hasId?: boolean;
}

/**
 * A result row is a flat dictionary keyed by column key: dimension cells are
 * strings, metric cells are `number | null` (null = no contributing value, e.g.
 * a pending financial score). `dimensionKeys` carries the numeric ids of the
 * id-bearing dimensions selected — for charlie's drill-down.
 */
export interface ReportRow {
  dimensionKeys?: Record<string, number>;
  [columnKey: string]: number | string | null | Record<string, number> | undefined;
}

export interface ReportPeriodMeta {
  periodId: number;
  label: string;
}
export interface ReportScopeMeta {
  scopeLevel: string;
  territoryIds: number[];
}
export interface ReportProvenance {
  metricKey: string;
  provenanceType: ProvenanceType;
  asOfDate: string;
  illustrative: boolean;
}
export interface ReportNote {
  severity: string; // info | warning
  message: string;
}

export interface ReportMeta {
  period: ReportPeriodMeta;
  scope: ReportScopeMeta;
  rowCount: number;
  territoryCount: number;
  asOfMeasured: string;
  asOfReported: string;
  generatedAt: string;
  provenance: ReportProvenance[];
  notes: ReportNote[];
}

export interface ReportQueryResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  meta: ReportMeta;
}

// ── Saved reports — /api/reports/saved ────────────────────────────────────────
export interface SavedReportInput {
  name: string;
  description?: string;
  definition: ReportQueryRequest;
}

export interface SavedReport {
  id: string;
  name: string;
  description: string;
  definition: ReportQueryRequest;
  ownerScopeLevel: string;
  ownerScopeId: number | null;
  createdAt: string;
  updatedAt: string;
}

// ── Presentation helpers (self-contained so this lane ships independently) ────
export const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  measured: 'Measured',
  seeded: 'Illustrative',
  derived: 'Derived',
  mixed: 'Mixed',
};

// Map a provenance plane to a design-token colour var (never a raw hex). Only
// --prov-measured / --prov-reported / --prov-seeded are defined globally, so
// `derived` borrows the "reported" blue and `mixed` the "seeded" violet — the
// `illustrative` flag remains the primary honesty signal in the UI.
export const PROVENANCE_VAR: Record<ProvenanceType, string> = {
  measured: 'var(--prov-measured)',
  seeded: 'var(--prov-seeded)',
  derived: 'var(--prov-reported)',
  mixed: 'var(--prov-seeded)',
};

export function formatDollars(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** Human-facing cell formatter. Strings pass through; nullish → em dash. */
export function formatValue(value: number | string | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (Number.isNaN(value)) return '—';
  switch (unit) {
    case 'dollars':
      return formatDollars(value);
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'ratio':
      return value.toFixed(2);
    case 'score':
      return Math.round(value).toString();
    case 'count':
    default:
      return Math.abs(value) >= 1000 ? value.toLocaleString('en-US') : String(value);
  }
}

/** Excel number-format string for a unit (used by the XLSX export). */
export function excelNumFmt(unit?: string): string {
  switch (unit) {
    case 'dollars':
      return '$#,##0';
    case 'percent':
      return '0.0%';
    case 'ratio':
      return '0.00';
    case 'score':
      return '0';
    case 'count':
    default:
      return '#,##0';
  }
}
