// Reporting view-model contracts — Back-Office Wave 1, CONTRACTS §C2.
//
// The Report Builder (this lane) is built against these exact shapes and mocks
// them locally until alpha's `/api/reports/*` endpoints land. Flipping the `live`
// seam in ReportsDataService is then the only change required — no shape change —
// mirroring the dashboard's D17 fixtures→live pattern.
//
// Provenance is first-class on every metric: the product's "measured vs
// illustrative" honesty story (D16) carries through reporting, so a CEO can never
// mistake a seeded placeholder for an operational fact.

export type ProvenanceType = 'measured' | 'reported' | 'seeded';
export type Unit = 'count' | 'dollars' | 'percent' | 'ratio' | 'score' | 'nps';
export type Aggregation = 'sum' | 'avg';
export type DimensionKey = 'brand' | 'region' | 'territory';

// ── GET /api/reports/catalog ────────────────────────────────────────────────
export interface MetricDef {
  key: string;
  label: string;
  unit: Unit;
  provenance: ProvenanceType;
  /** How the metric rolls up across the grouped dimension members. */
  agg: Aggregation;
  description: string;
}

export interface DimensionDef {
  key: DimensionKey;
  label: string;
  description: string;
}

export interface PeriodOption {
  periodId: number;
  label: string;
  trailingWindowMonths: number;
}

/** A selectable filter member. `brandId`/`regionId` let the UI chain the pickers. */
export interface FilterOption {
  id: number;
  label: string;
  brandId?: number;
  regionId?: number;
}

export interface ReportCatalog {
  metrics: MetricDef[];
  dimensions: DimensionDef[];
  periods: PeriodOption[];
  filters: {
    brands: FilterOption[];
    regions: FilterOption[];
    territories: FilterOption[];
  };
}

// ── POST /api/reports/run ───────────────────────────────────────────────────
export interface ReportQuery {
  /** Metric keys, in display order. */
  metrics: string[];
  /** Group-by dimension. */
  dimension: DimensionKey;
  periodId: number;
  filters: {
    brandIds: number[];
    regionIds: number[];
    territoryIds: number[];
  };
}

export type ColumnKind = 'dimension' | 'metric';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  unit?: Unit;
  provenance?: ProvenanceType;
  agg?: Aggregation;
}

export interface ReportRow {
  /** Stable row id — the dimension member id, as a string. */
  key: string;
  /** Cell values keyed by column key. Dimension cell is the member label. */
  cells: Record<string, number | string | null>;
}

export interface ReportMeta {
  generatedAt: string; // ISO timestamp
  periodLabel: string;
  dimensionLabel: string;
  rowCount: number;
  // Honest provenance roll-up for this run (D16): which selected metrics are real.
  measuredMetrics: string[];
  reportedMetrics: string[];
  illustrativeMetrics: string[];
  provenanceByMetric: Record<string, ProvenanceType>;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  meta: ReportMeta;
}

// ── /api/reports/saved ──────────────────────────────────────────────────────
export interface SavedReport {
  id: string;
  name: string;
  query: ReportQuery;
  createdAt: string; // ISO timestamp
}

export interface SaveReportRequest {
  name: string;
  query: ReportQuery;
}

// ── Presentation helpers (self-contained so this lane ships independently) ────
export const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  measured: 'Measured',
  reported: 'Reported',
  seeded: 'Illustrative',
};

/** Map a provenance plane to its design-token colour var (never a raw hex). */
export const PROVENANCE_VAR: Record<ProvenanceType, string> = {
  measured: 'var(--prov-measured)',
  reported: 'var(--prov-reported)',
  seeded: 'var(--prov-seeded)',
};

export function formatDollars(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** Human-facing cell formatter. Strings pass through; nullish → em dash. */
export function formatValue(value: number | string | null | undefined, unit?: Unit): string {
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
    case 'nps':
    case 'score':
      return Math.round(value).toString();
    case 'count':
    default:
      return value >= 1000 ? value.toLocaleString('en-US') : String(value);
  }
}

/** Excel number-format string for a unit (used by the XLSX export). */
export function excelNumFmt(unit?: Unit): string {
  switch (unit) {
    case 'dollars':
      return '$#,##0';
    case 'percent':
      return '0.0%';
    case 'ratio':
      return '0.00';
    case 'nps':
    case 'score':
      return '0';
    case 'count':
    default:
      return '#,##0';
  }
}
