// Deterministic mock for the Reporting API (§C2). Stands in for alpha's
// `/api/reports/*` until live mode is switched on; it emits the IDENTICAL wire
// shapes (reports.models.ts), so the live swap is a one-line seam change in
// ReportsDataService and no component ever maps between two shapes.
//
// The synthetic universe mirrors the live read model: a brand → region →
// territory hierarchy with archetype / tenure-band / franchisee / status
// dimensions, and per-territory metrics derived deterministically from the
// territory id, so every run is stable and reproducible (no Math.random in the
// data path). Aggregation, provenance and notes follow the same rules as
// `api/Reporting/ReportingReadModel.cs`.

import {
  CatalogDimension,
  CatalogMetric,
  CatalogPeriod,
  ReportCatalog,
  ReportColumn,
  ReportMeta,
  ReportProvenance,
  ReportQueryRequest,
  ReportQueryResult,
  ReportRow,
  SavedReport,
  SavedReportInput,
} from './reports.models';

type Agg = 'sum' | 'avg' | 'count' | 'count_at_risk' | 'sum_watchlist';

interface MetricSpec extends CatalogMetric {
  agg: Agg;
  /** Per-row provenance (nps_score → measured | seeded | mixed). */
  perRow?: boolean;
  /** Raw per-fact value; null-yielding metrics rely on the aggregation. */
  value: (f: Fact) => number | null;
}

// ── Metric catalog (live keys, units, planes — mirrors §C2 table) ─────────────
const METRICS: MetricSpec[] = [
  m(
    'composite_score',
    'Composite Health Score',
    'score',
    'avg',
    'derived',
    true,
    false,
    false,
    'Weighted franchise_ops_v1 health score (0–100).',
    (f) => f.compositeScore,
  ),
  m(
    'financial_score',
    'Financial Score',
    'score',
    'avg',
    'derived',
    true,
    true,
    true,
    'Financial sub-score; pending-reporting territories are excluded (null).',
    (f) => f.financialScore,
  ),
  m(
    'customer_score',
    'Customer Score',
    'score',
    'avg',
    'derived',
    true,
    false,
    false,
    'Customer sub-score (NPS + ratings).',
    (f) => f.customerScore,
  ),
  m(
    'growth_score',
    'Growth Score',
    'score',
    'avg',
    'derived',
    true,
    false,
    false,
    'Growth sub-score (same-territory growth + slot fill).',
    (f) => f.growthScore,
  ),
  m(
    'compliance_score',
    'Compliance Score',
    'score',
    'avg',
    'derived',
    true,
    false,
    false,
    'Compliance sub-score (no-show + reporting).',
    (f) => f.complianceScore,
  ),
  {
    ...m(
      'nps_score',
      'NPS',
      'score',
      'avg',
      'measured',
      true,
      false,
      false,
      'Net Promoter Score — survey-measured where available, else seeded fallback.',
      (f) => f.npsScore,
    ),
    perRow: true,
  },
  m(
    'jobs_completed',
    'Jobs Completed',
    'count',
    'sum',
    'measured',
    true,
    false,
    false,
    'Completed jobs (measured from operational rows).',
    (f) => f.jobsCompleted,
  ),
  m(
    'slot_fill_rate',
    'Slot Fill Rate',
    'ratio',
    'avg',
    'measured',
    true,
    false,
    false,
    'Filled ÷ available slots (measured).',
    (f) => f.slotFillRate,
  ),
  m(
    'no_show_rate',
    'No-Show Rate',
    'ratio',
    'avg',
    'measured',
    false,
    false,
    false,
    'No-show ÷ booked (measured).',
    (f) => f.noShowRate,
  ),
  m(
    'gross_revenue',
    'Gross Revenue',
    'dollars',
    'sum',
    'seeded',
    true,
    false,
    true,
    'Reported gross revenue (illustrative/seeded).',
    (f) => f.grossRevenue,
  ),
  m(
    'royalty_revenue',
    'Royalty Revenue',
    'dollars',
    'sum',
    'seeded',
    true,
    false,
    true,
    'Royalty revenue = gross × rate (illustrative/seeded).',
    (f) => f.royaltyRevenue,
  ),
  m(
    'same_territory_growth',
    'Same-Territory Growth',
    'percent',
    'avg',
    'seeded',
    true,
    false,
    true,
    'YoY same-territory growth (illustrative/seeded).',
    (f) => f.sameTerritoryGrowth,
  ),
  m(
    'territory_count',
    'Active Territories',
    'count',
    'count',
    'measured',
    true,
    false,
    false,
    'Count of territories in the group.',
    () => null,
  ),
  m(
    'at_risk_count',
    'At-Risk Territories',
    'count',
    'count_at_risk',
    'derived',
    false,
    false,
    false,
    'Territories with composite health below 50.',
    () => null,
  ),
  m(
    'watchlist_count',
    'Open Watchlist Flags',
    'count',
    'sum_watchlist',
    'derived',
    false,
    false,
    false,
    'Open watchlist flags across the group (latest period).',
    () => null,
  ),
];

function m(
  key: string,
  label: string,
  unit: string,
  agg: Agg,
  provenanceType: CatalogMetric['provenanceType'],
  higherIsBetter: boolean,
  nullable: boolean,
  illustrative: boolean,
  description: string,
  value: (f: Fact) => number | null,
): MetricSpec {
  return {
    key,
    label,
    unit,
    aggregation: agg,
    agg,
    provenanceType,
    higherIsBetter,
    nullable,
    illustrative,
    description,
    value,
  };
}

// ── Dimensions (live set) ─────────────────────────────────────────────────────
interface DimSpec extends CatalogDimension {
  idField?: string;
  of: (f: Fact) => { label: string; id?: number };
}
const DIMENSIONS: DimSpec[] = [
  {
    key: 'brand',
    label: 'Brand',
    hasId: true,
    idField: 'brandId',
    of: (f) => ({ label: f.brandName, id: f.brandId }),
  },
  {
    key: 'region',
    label: 'Region',
    hasId: true,
    idField: 'regionId',
    of: (f) => ({ label: f.regionName, id: f.regionId }),
  },
  { key: 'archetype', label: 'Archetype', hasId: false, of: (f) => ({ label: f.archetype }) },
  { key: 'tenure_band', label: 'Tenure Band', hasId: false, of: (f) => ({ label: f.tenureBand }) },
  {
    key: 'territory',
    label: 'Territory',
    hasId: true,
    idField: 'territoryId',
    of: (f) => ({ label: f.territoryName, id: f.territoryId }),
  },
  {
    key: 'franchisee',
    label: 'Franchisee',
    hasId: true,
    idField: 'franchiseeId',
    of: (f) => ({ label: f.franchiseeName, id: f.franchiseeId }),
  },
  { key: 'status', label: 'Status', hasId: false, of: (f) => ({ label: f.status }) },
];

const PERIODS: CatalogPeriod[] = [
  { periodId: 202605, label: 'May 2026', isLatest: true },
  { periodId: 202604, label: 'April 2026', isLatest: false },
  { periodId: 202603, label: 'March 2026', isLatest: false },
];
const LATEST = 202605;
const FILTER_KEYS = [
  'brandId',
  'regionId',
  'archetype',
  'tenureBand',
  'status',
  'riskBand',
  'territoryIds',
];

// ── Synthetic universe ────────────────────────────────────────────────────────
interface Fact {
  periodId: number;
  territoryId: number;
  territoryName: string;
  brandId: number;
  brandName: string;
  regionId: number;
  regionName: string;
  archetype: string;
  tenureBand: string;
  franchiseeId: number;
  franchiseeName: string;
  status: string;
  jobsCompleted: number;
  slotFillRate: number;
  noShowRate: number;
  grossRevenue: number;
  royaltyRevenue: number;
  sameTerritoryGrowth: number;
  npsScore: number;
  compositeScore: number;
  financialScore: number | null;
  customerScore: number | null;
  growthScore: number | null;
  complianceScore: number | null;
  npsMeasured: boolean;
  atRisk: boolean;
  watchlistCount: number;
  asOfMeasured: string;
  asOfReported: string;
}

const BRANDS = [
  { id: 1, name: 'Budget Blinds' },
  { id: 2, name: 'Bath Tune-Up' },
  { id: 3, name: 'Two Maids' },
  { id: 4, name: 'Mosquito Joe' },
];
const REGION_DEFS = [
  { brandId: 1, n: 1, name: 'Budget Blinds · West' },
  { brandId: 1, n: 2, name: 'Budget Blinds · East' },
  { brandId: 2, n: 1, name: 'Bath Tune-Up · South' },
  { brandId: 2, n: 2, name: 'Bath Tune-Up · Central' },
  { brandId: 3, n: 1, name: 'Two Maids · West' },
  { brandId: 3, n: 2, name: 'Two Maids · Northeast' },
  { brandId: 4, n: 1, name: 'Mosquito Joe · Central' },
  { brandId: 4, n: 2, name: 'Mosquito Joe · Southeast' },
];
const ARCHETYPES = ['recurring_service', 'project_based', 'seasonal'];
const TENURE_BANDS = ['new', 'growing', 'mature'];
const STATUSES = ['open', 'open', 'open', 'pending_financial_reporting']; // weighted toward open
const CITY = ['Metro', 'Lakeside', 'Highland', 'Riverton', 'Fairview', 'Oakmont', 'Crestwood'];

// Deterministic 0..1 from an id + salt — stable across runs (no PRNG state).
function seeded(id: number, salt: number): number {
  const x = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildFacts(): Fact[] {
  const out: Fact[] = [];
  let tid = 100;
  let fid = 500;
  for (const r of REGION_DEFS) {
    const brand = BRANDS.find((b) => b.id === r.brandId)!;
    const regionId = r.brandId * 10 + r.n;
    const count = 2 + ((regionId + r.n) % 2); // 2 or 3 territories
    for (let i = 0; i < count; i++) {
      tid += 1;
      fid += 1;
      const city = CITY[(tid + i) % CITY.length];
      const archetype = ARCHETYPES[tid % ARCHETYPES.length];
      const tenureBand = TENURE_BANDS[(tid + 1) % TENURE_BANDS.length];
      const status = STATUSES[tid % STATUSES.length];
      for (const p of PERIODS) {
        const scale = 1 - (LATEST - p.periodId) * 0.06; // shorter-ago periods slightly larger
        const jobsCompleted = Math.round((80 + seeded(tid, 1) * 220) * scale);
        const avgTicket = 180 + Math.round(seeded(tid, 2) * 640);
        const grossRevenue = Math.round(jobsCompleted * avgTicket);
        const composite = Math.round((42 + seeded(tid, 5) * 52) * 10) / 10;
        const pending = status === 'pending_financial_reporting';
        out.push({
          periodId: p.periodId,
          territoryId: tid,
          territoryName: `${city} (${brand.name.split(' ')[0]})`,
          brandId: r.brandId,
          brandName: brand.name,
          regionId,
          regionName: r.name,
          archetype,
          tenureBand,
          franchiseeId: fid,
          franchiseeName: `${city} Holdings`,
          status,
          jobsCompleted,
          slotFillRate: Math.round((0.62 + seeded(tid, 8) * 0.34) * 1e4) / 1e4,
          noShowRate: Math.round((0.03 + seeded(tid, 9) * 0.14) * 1e4) / 1e4,
          grossRevenue,
          royaltyRevenue: Math.round(grossRevenue * 0.06),
          sameTerritoryGrowth: Math.round((-0.05 + seeded(tid, 10) * 0.28) * 1e4) / 1e4,
          npsScore: 20 + Math.round(seeded(tid, 4) * 60),
          compositeScore: composite,
          financialScore: pending ? null : Math.round((40 + seeded(tid, 11) * 55) * 10) / 10,
          customerScore: Math.round((45 + seeded(tid, 12) * 50) * 10) / 10,
          growthScore: Math.round((40 + seeded(tid, 13) * 55) * 10) / 10,
          complianceScore: Math.round((55 + seeded(tid, 14) * 42) * 10) / 10,
          npsMeasured: seeded(tid, 15) > 0.4, // ~60% survey-measured
          atRisk: composite < 50,
          watchlistCount:
            p.periodId === LATEST && composite < 50 ? 1 + Math.round(seeded(tid, 16) * 2) : 0,
          asOfMeasured: '2026-05-31',
          asOfReported: '2026-05-31',
        });
      }
    }
  }
  return out;
}

const FACTS = buildFacts();

export function buildCatalog(): ReportCatalog {
  return {
    metrics: METRICS.map((s) => ({
      key: s.key,
      label: s.label,
      unit: s.unit,
      aggregation: s.aggregation,
      provenanceType: s.provenanceType,
      higherIsBetter: s.higherIsBetter,
      nullable: s.nullable,
      illustrative: s.illustrative,
      description: s.description,
    })),
    dimensions: DIMENSIONS.map((d) => ({ key: d.key, label: d.label, hasId: d.hasId })),
    periods: PERIODS.map((p) => ({ ...p })),
    filters: [...FILTER_KEYS],
  };
}

function passes(f: Fact, q: ReportQueryRequest['filters']): boolean {
  if (!q) return true;
  if (q.brandId != null && f.brandId !== q.brandId) return false;
  if (q.regionId != null && f.regionId !== q.regionId) return false;
  if (q.archetype && f.archetype.toLowerCase() !== q.archetype.toLowerCase()) return false;
  if (q.tenureBand && f.tenureBand.toLowerCase() !== q.tenureBand.toLowerCase()) return false;
  if (q.status && f.status.toLowerCase() !== q.status.toLowerCase()) return false;
  if (q.territoryIds && q.territoryIds.length && !q.territoryIds.includes(f.territoryId))
    return false;
  if (q.riskBand === 'healthy' && !(f.compositeScore >= 70)) return false;
  if (q.riskBand === 'watch' && !(f.compositeScore >= 50 && f.compositeScore < 70)) return false;
  if (q.riskBand === 'at_risk' && !(f.compositeScore < 50)) return false;
  return true;
}

function aggregate(spec: MetricSpec, facts: Fact[]): number | null {
  switch (spec.agg) {
    case 'count':
      return facts.length;
    case 'count_at_risk':
      return facts.filter((f) => f.atRisk).length;
    case 'sum_watchlist':
      return facts.reduce((a, f) => a + f.watchlistCount, 0);
    default: {
      const vals = facts.map((f) => spec.value(f)).filter((v): v is number => v !== null);
      if (!vals.length) return null;
      const total = vals.reduce((a, b) => a + b, 0);
      const raw = spec.agg === 'avg' ? total / vals.length : total;
      // mirror the read model's decimals: scores 1dp, ratio/percent 4dp, money/count int
      const dp =
        spec.unit === 'score' ? 1 : spec.unit === 'ratio' || spec.unit === 'percent' ? 4 : 0;
      const f = Math.pow(10, dp);
      return Math.round(raw * f) / f;
    }
  }
}

function provenanceFor(spec: MetricSpec, rows: Fact[]): ReportProvenance {
  if (spec.perRow) {
    const anyMeasured = rows.some((r) => r.npsMeasured);
    const anySeeded = rows.some((r) => !r.npsMeasured);
    const type = anyMeasured && anySeeded ? 'mixed' : anyMeasured ? 'measured' : 'seeded';
    return {
      metricKey: spec.key,
      provenanceType: type,
      asOfDate: '2026-05-31',
      illustrative: anySeeded,
    };
  }
  return {
    metricKey: spec.key,
    provenanceType: spec.provenanceType,
    asOfDate: '2026-05-31',
    illustrative: spec.illustrative,
  };
}

/** Compute a report result from a query against the synthetic universe. */
export function runReport(req: ReportQueryRequest): ReportQueryResult {
  const metrics = (req.metrics ?? [])
    .map((k) => METRICS.find((m) => m.key === k))
    .filter((s): s is MetricSpec => !!s);
  const dims = (req.dimensions ?? [])
    .map((k) => DIMENSIONS.find((d) => d.key === k))
    .filter((d): d is DimSpec => !!d);
  const periodId = req.period ?? LATEST;
  const period = PERIODS.find((p) => p.periodId === periodId) ?? PERIODS[0];

  const rows = FACTS.filter((f) => f.periodId === periodId).filter((f) => passes(f, req.filters));

  // Group by the selected dimensions' label tuple ([] dims → one grand total).
  const groups = new Map<string, Fact[]>();
  for (const f of rows) {
    const key = dims.map((d) => d.of(f).label).join('▸') || '__total__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const columns: ReportColumn[] = [
    ...dims.map<ReportColumn>((d) => ({
      key: d.key,
      label: d.label,
      kind: 'dimension',
      type: 'string',
      hasId: d.hasId,
    })),
    ...metrics.map<ReportColumn>((s) => {
      const prov = provenanceFor(s, rows);
      return {
        key: s.key,
        label: s.label,
        kind: 'metric',
        type: 'number',
        unit: s.unit,
        aggregation: s.aggregation,
        provenanceType: prov.provenanceType,
        illustrative: prov.illustrative,
        higherIsBetter: s.higherIsBetter,
      };
    }),
  ];

  const outRows: ReportRow[] = [...groups.values()]
    .map((facts) => {
      const row: ReportRow = {};
      const dimKeys: Record<string, number> = {};
      for (const d of dims) {
        const v = d.of(facts[0]);
        row[d.key] = v.label;
        if (d.hasId && d.idField && v.id != null) dimKeys[d.idField] = v.id;
      }
      for (const s of metrics) row[s.key] = aggregate(s, facts);
      row.dimensionKeys = dimKeys;
      return row;
    })
    // Stable, useful default order: by the first metric descending, else by dim label.
    .sort((a, b) => {
      const k = metrics[0]?.key;
      if (k) return (Number(b[k]) || 0) - (Number(a[k]) || 0);
      const dk = dims[0]?.key;
      return dk ? String(a[dk]).localeCompare(String(b[dk])) : 0;
    });

  const provenance = metrics.map((s) => provenanceFor(s, rows));
  const notes: ReportMeta['notes'] = [];
  if (metrics.some((s) => s.illustrative) || provenance.some((p) => p.illustrative)) {
    notes.push({
      severity: 'info',
      message: 'Financial metrics are illustrative/seeded and lag measured operational metrics.',
    });
  }
  if (metrics.some((s) => s.key === 'financial_score')) {
    const pending = rows.filter((r) => r.financialScore === null).length;
    if (pending > 0) {
      notes.push({
        severity: 'warning',
        message: `${pending} territory(ies) excluded from financial_score — current royalty-cycle reporting not received.`,
      });
    }
  }

  const meta: ReportMeta = {
    period: { periodId, label: period.label },
    scope: { scopeLevel: 'corporate', territoryIds: [...new Set(rows.map((r) => r.territoryId))] },
    rowCount: outRows.length,
    territoryCount: new Set(rows.map((r) => r.territoryId)).size,
    asOfMeasured: '2026-05-31',
    asOfReported: '2026-05-31',
    generatedAt: new Date().toISOString(),
    provenance,
    notes,
  };

  return { columns, rows: outRows, meta };
}

// ── Saved-report store (in-memory; persists for the session in mock mode) ──────
const savedStore: SavedReport[] = [
  saved(
    'seed-portfolio-revenue',
    'Portfolio revenue by brand',
    'Gross revenue, jobs and health by brand',
    {
      metrics: ['gross_revenue', 'jobs_completed', 'composite_score'],
      dimensions: ['brand'],
      period: LATEST,
      filters: {},
    },
    '2026-06-01T09:00:00.000Z',
  ),
  saved(
    'seed-region-risk',
    'Region risk & NPS',
    'At-risk counts and NPS by region',
    {
      metrics: ['composite_score', 'at_risk_count', 'nps_score'],
      dimensions: ['region'],
      period: LATEST,
      filters: { riskBand: 'at_risk' },
    },
    '2026-06-05T14:30:00.000Z',
  ),
];

function saved(
  id: string,
  name: string,
  description: string,
  definition: ReportQueryRequest,
  when: string,
): SavedReport {
  return {
    id,
    name,
    description,
    definition,
    ownerScopeLevel: 'corporate',
    ownerScopeId: null,
    createdAt: when,
    updatedAt: when,
  };
}

export function listSaved(): SavedReport[] {
  return savedStore.map((s) => ({ ...s, definition: structuredClone(s.definition) }));
}

export function saveReport(req: SavedReportInput): SavedReport {
  const now = new Date().toISOString();
  const rec: SavedReport = {
    id: `rep_${Date.now().toString(36)}`,
    name: req.name.trim() || 'Untitled report',
    description: (req.description ?? '').trim(),
    definition: structuredClone(req.definition),
    ownerScopeLevel: 'corporate',
    ownerScopeId: null,
    createdAt: now,
    updatedAt: now,
  };
  savedStore.unshift(rec);
  return { ...rec, definition: structuredClone(rec.definition) };
}

export function deleteSaved(id: string): void {
  const i = savedStore.findIndex((s) => s.id === id);
  if (i >= 0) savedStore.splice(i, 1);
}
