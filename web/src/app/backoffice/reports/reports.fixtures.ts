// Deterministic mock for the reporting contract (§C2). Stands in for alpha's
// `/api/reports/*` until they land; the shapes are identical so the live swap is
// a one-line seam change in ReportsDataService (no component touches the data).
//
// The synthetic universe is a small brand → region → territory hierarchy with
// per-territory base metrics derived deterministically from the territory id, so
// every run is stable and reproducible (no Math.random in the data path).

import {
  Aggregation,
  DimensionKey,
  FilterOption,
  MetricDef,
  ReportCatalog,
  ReportColumn,
  ReportMeta,
  ReportQuery,
  ReportResult,
  ReportRow,
  SaveReportRequest,
  SavedReport,
} from './reports.models';

// ── Catalog ──────────────────────────────────────────────────────────────────
const METRICS: MetricDef[] = [
  { key: 'revenue', label: 'Revenue', unit: 'dollars', provenance: 'measured', agg: 'sum',
    description: 'Completed-job revenue computed from the booking system.' },
  { key: 'bookings', label: 'Bookings', unit: 'count', provenance: 'measured', agg: 'sum',
    description: 'Count of confirmed bookings in the period.' },
  { key: 'avgTicket', label: 'Avg ticket', unit: 'dollars', provenance: 'measured', agg: 'avg',
    description: 'Average revenue per completed job.' },
  { key: 'deposits', label: 'Deposits collected', unit: 'dollars', provenance: 'measured', agg: 'sum',
    description: 'Deposits taken at booking — a cash signal, not recognised revenue.' },
  { key: 'nps', label: 'NPS', unit: 'nps', provenance: 'measured', agg: 'avg',
    description: 'Net Promoter Score from post-job surveys.' },
  { key: 'compositeScore', label: 'Health score', unit: 'score', provenance: 'measured', agg: 'avg',
    description: 'Pre-computed territory health composite (0–100).' },
  { key: 'royaltyDue', label: 'Royalty due', unit: 'dollars', provenance: 'reported', agg: 'sum',
    description: 'Royalty owed, as submitted by the franchisee through billing.' },
  { key: 'marketingSpend', label: 'Marketing spend', unit: 'dollars', provenance: 'seeded', agg: 'sum',
    description: 'Illustrative co-op marketing spend — swappable to a real source.' },
  { key: 'conversionRate', label: 'Lead conversion', unit: 'percent', provenance: 'seeded', agg: 'avg',
    description: 'Illustrative lead→booking conversion — placeholder pending CRM feed.' },
];

const DIMENSIONS = [
  { key: 'brand' as DimensionKey, label: 'Brand', description: 'Roll up across each franchise brand.' },
  { key: 'region' as DimensionKey, label: 'Region', description: 'Roll up across each operating region.' },
  { key: 'territory' as DimensionKey, label: 'Territory', description: 'One row per territory (most granular).' },
];

const PERIODS = [
  { periodId: 202606, label: 'Trailing 12 months', trailingWindowMonths: 12 },
  { periodId: 202603, label: 'Trailing 6 months', trailingWindowMonths: 6 },
  { periodId: 202601, label: 'Trailing 3 months', trailingWindowMonths: 3 },
];

interface Territory {
  territoryId: number;
  territoryName: string;
  brandId: number;
  brandName: string;
  regionId: number;
  regionName: string;
}

const BRANDS = [
  { id: 1, name: 'TidyNest Cleaning' },
  { id: 2, name: 'GreenBlade Lawn' },
  { id: 3, name: 'PipeWorks Plumbing' },
  { id: 4, name: 'BrightSpark Electric' },
];

// Two regions per brand; 2–3 territories per region. Ids are stable and encode the
// hierarchy (regionId = brandId*10 + n) so filter chaining is trivial.
const REGION_DEFS = [
  { brandId: 1, n: 1, name: 'TidyNest · West' },
  { brandId: 1, n: 2, name: 'TidyNest · East' },
  { brandId: 2, n: 1, name: 'GreenBlade · South' },
  { brandId: 2, n: 2, name: 'GreenBlade · Central' },
  { brandId: 3, n: 1, name: 'PipeWorks · West' },
  { brandId: 3, n: 2, name: 'PipeWorks · Northeast' },
  { brandId: 4, n: 1, name: 'BrightSpark · Central' },
  { brandId: 4, n: 2, name: 'BrightSpark · Southeast' },
];

const CITY = ['Metro', 'Lakeside', 'Highland', 'Riverton', 'Fairview', 'Oakmont', 'Crestwood'];

function buildTerritories(): Territory[] {
  const out: Territory[] = [];
  let tid = 100;
  for (const r of REGION_DEFS) {
    const brand = BRANDS.find((b) => b.id === r.brandId)!;
    const regionId = r.brandId * 10 + r.n;
    const count = 2 + ((regionId + r.n) % 2); // 2 or 3
    for (let i = 0; i < count; i++) {
      tid += 1;
      const city = CITY[(tid + i) % CITY.length];
      out.push({
        territoryId: tid,
        territoryName: `${city} (${brand.name.split(' ')[0]})`,
        brandId: r.brandId,
        brandName: brand.name,
        regionId,
        regionName: r.name,
      });
    }
  }
  return out;
}

const TERRITORIES = buildTerritories();

// Deterministic 0..1 from an id + salt — stable across runs (no PRNG state).
function seeded(id: number, salt: number): number {
  const x = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Per-territory base metric values. Period scales the magnitude so shorter
// trailing windows show proportionally smaller totals (honest, not flat).
function baseMetrics(t: Territory, periodScale: number): Record<string, number> {
  const bookings = Math.round((80 + seeded(t.territoryId, 1) * 220) * periodScale);
  const avgTicket = 180 + Math.round(seeded(t.territoryId, 2) * 640);
  const revenue = bookings * avgTicket;
  return {
    bookings,
    avgTicket,
    revenue,
    deposits: Math.round(revenue * (0.18 + seeded(t.territoryId, 3) * 0.1)),
    nps: 20 + Math.round(seeded(t.territoryId, 4) * 60),
    compositeScore: 45 + Math.round(seeded(t.territoryId, 5) * 50),
    royaltyDue: Math.round(revenue * 0.06),
    marketingSpend: Math.round((3000 + seeded(t.territoryId, 6) * 12000) * periodScale),
    conversionRate: 0.15 + seeded(t.territoryId, 7) * 0.35,
  };
}

export function buildCatalog(): ReportCatalog {
  const brands: FilterOption[] = BRANDS.map((b) => ({ id: b.id, label: b.name }));
  const regions: FilterOption[] = REGION_DEFS.map((r) => ({
    id: r.brandId * 10 + r.n,
    label: r.name,
    brandId: r.brandId,
  }));
  const territories: FilterOption[] = TERRITORIES.map((t) => ({
    id: t.territoryId,
    label: t.territoryName,
    brandId: t.brandId,
    regionId: t.regionId,
  }));
  return {
    metrics: METRICS.map((m) => ({ ...m })),
    dimensions: DIMENSIONS.map((d) => ({ ...d })),
    periods: PERIODS.map((p) => ({ ...p })),
    filters: { brands, regions, territories },
  };
}

function aggregate(values: number[], agg: Aggregation): number {
  if (!values.length) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return agg === 'avg' ? sum / values.length : sum;
}

function groupOf(t: Territory, dim: DimensionKey): { id: number; label: string } {
  switch (dim) {
    case 'brand':
      return { id: t.brandId, label: t.brandName };
    case 'region':
      return { id: t.regionId, label: t.regionName };
    case 'territory':
    default:
      return { id: t.territoryId, label: t.territoryName };
  }
}

/** Compute a report result from a query against the synthetic universe. */
export function runReport(query: ReportQuery): ReportResult {
  const metrics = query.metrics
    .map((k) => METRICS.find((m) => m.key === k))
    .filter((m): m is MetricDef => !!m);
  const dim = DIMENSIONS.find((d) => d.key === query.dimension) ?? DIMENSIONS[0];
  const period = PERIODS.find((p) => p.periodId === query.periodId) ?? PERIODS[0];
  const periodScale = period.trailingWindowMonths / 12;

  const f = query.filters;
  const scoped = TERRITORIES.filter(
    (t) =>
      (!f.brandIds.length || f.brandIds.includes(t.brandId)) &&
      (!f.regionIds.length || f.regionIds.includes(t.regionId)) &&
      (!f.territoryIds.length || f.territoryIds.includes(t.territoryId)),
  );

  // Bucket the scoped territories by the chosen dimension member.
  const buckets = new Map<number, { label: string; rows: Record<string, number>[] }>();
  for (const t of scoped) {
    const g = groupOf(t, query.dimension);
    if (!buckets.has(g.id)) buckets.set(g.id, { label: g.label, rows: [] });
    buckets.get(g.id)!.rows.push(baseMetrics(t, periodScale));
  }

  const columns: ReportColumn[] = [
    { key: '__dim', label: dim.label, kind: 'dimension' },
    ...metrics.map<ReportColumn>((m) => ({
      key: m.key,
      label: m.label,
      kind: 'metric',
      unit: m.unit,
      provenance: m.provenance,
      agg: m.agg,
    })),
  ];

  const rows: ReportRow[] = [...buckets.entries()]
    .map(([id, b]) => {
      const cells: Record<string, number | string | null> = { __dim: b.label };
      for (const m of metrics) {
        cells[m.key] = aggregate(b.rows.map((r) => r[m.key] ?? 0), m.agg);
      }
      return { key: String(id), cells, _label: b.label };
    })
    // Stable, useful default order: by the first metric descending, else by label.
    .sort((a, b) => {
      const k = metrics[0]?.key;
      if (k) return (Number(b.cells[k]) || 0) - (Number(a.cells[k]) || 0);
      return String(a.cells['__dim']).localeCompare(String(b.cells['__dim']));
    })
    .map(({ _label, ...row }) => row);

  const meta: ReportMeta = {
    generatedAt: new Date().toISOString(),
    periodLabel: period.label,
    dimensionLabel: dim.label,
    rowCount: rows.length,
    measuredMetrics: metrics.filter((m) => m.provenance === 'measured').map((m) => m.key),
    reportedMetrics: metrics.filter((m) => m.provenance === 'reported').map((m) => m.key),
    illustrativeMetrics: metrics.filter((m) => m.provenance === 'seeded').map((m) => m.key),
    provenanceByMetric: Object.fromEntries(metrics.map((m) => [m.key, m.provenance])),
  };

  return { columns, rows, meta };
}

// ── Saved-report store (in-memory; persists for the session in mock mode) ──────
const savedStore: SavedReport[] = [
  {
    id: 'seed-portfolio-revenue',
    name: 'Portfolio revenue by brand',
    createdAt: '2026-06-01T09:00:00.000Z',
    query: {
      metrics: ['revenue', 'bookings', 'avgTicket'],
      dimension: 'brand',
      periodId: 202606,
      filters: { brandIds: [], regionIds: [], territoryIds: [] },
    },
  },
  {
    id: 'seed-region-health',
    name: 'Region health & NPS',
    createdAt: '2026-06-05T14:30:00.000Z',
    query: {
      metrics: ['compositeScore', 'nps', 'revenue'],
      dimension: 'region',
      periodId: 202603,
      filters: { brandIds: [], regionIds: [], territoryIds: [] },
    },
  },
];

export function listSaved(): SavedReport[] {
  return savedStore.map((s) => ({ ...s, query: structuredClone(s.query) }));
}

export function saveReport(req: SaveReportRequest): SavedReport {
  const saved: SavedReport = {
    id: `rpt-${Date.now()}`,
    name: req.name.trim() || 'Untitled report',
    query: structuredClone(req.query),
    createdAt: new Date().toISOString(),
  };
  savedStore.unshift(saved);
  return { ...saved, query: structuredClone(saved.query) };
}

export function deleteSaved(id: string): void {
  const i = savedStore.findIndex((s) => s.id === id);
  if (i >= 0) savedStore.splice(i, 1);
}
