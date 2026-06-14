// Fixture data — shaped EXACTLY like CONTRACT §2 DTOs so the swap to live Bravo
// (D17) is a data-source change only. Deliberately dramatic spread: clear top
// performers + 4 red at-risk territories, so the map and distribution have a story.
//
// Every territory carries lat/long (CONTRACT §1 / D1) so the map is alive. Scores
// are the only thing used for sort/color; the four sub-scores + drivers are the
// "explainable score" payload the scorecard reveals.

import {
  Archetype,
  BrandComparisonRow,
  CorporateDashboard,
  Driver,
  TenureBand,
  TerritoryHealthScore,
  TerritoryListItem,
  TerritoryListResponse,
  VitalSign,
  WatchlistFlag,
  WatchlistResponse,
} from './dashboard.models';

const ASOF_MEASURED = '2026-06-12';
const ASOF_REPORTED = '2026-05-31';

export interface BrandMeta {
  brandId: number;
  brandName: string;
  archetype: Archetype;
  accent: string; // brand chip color — chips, NOT whole themes
}

export const BRANDS: BrandMeta[] = [
  { brandId: 1, brandName: 'Budget Blinds', archetype: 'project_installation', accent: '#5B8CFF' },
  { brandId: 2, brandName: 'Two Maids', archetype: 'recurring_service', accent: '#36D6A0' },
  { brandId: 3, brandName: 'Mister Sparky', archetype: 'on_demand_dispatch', accent: '#FFB454' },
];

export const REGIONS = [
  { regionId: 1, regionName: 'West' },
  { regionId: 2, regionName: 'Southeast' },
];

// Compact seed row. Order chosen for legibility, not the wire format.
// [id, name, brandId, regionId, lat, lng, franchisee, openDate, tenure,
//   composite, financial|null, customer, growth, compliance,
//   nps, slotFill(0..1), noShow(0..1), grossRevK, jobsLtm, status]
type Row = [
  number, string, number, number, number, number, string, string, TenureBand,
  number, number | null, number, number, number,
  number, number, number, number, number, 'open' | 'sold' | 'available',
];

const ROWS: Row[] = [
  // ── Budget Blinds (project_installation) ──────────────────────────────────
  [1, 'Orange County North', 1, 1, 33.83, -117.85, 'Reyes Holdings LLC', '2019-03-01', 'mature', 88, 82, 84, 86, 91, 71, 0.89, 0.04, 1840, 612, 'open'],
  [2, 'San Diego Coastal', 1, 1, 32.86, -117.21, 'Marlowe Group', '2020-06-15', 'established', 81, 76, 79, 80, 90, 64, 0.84, 0.06, 1510, 540, 'open'],
  [3, 'Phoenix Metro', 1, 1, 33.45, -112.07, 'Sunstate Ventures', '2021-09-01', 'established', 72, 68, 70, 74, 82, 55, 0.79, 0.09, 1180, 498, 'open'],
  [4, 'Denver Front Range', 1, 1, 39.74, -104.99, 'Aspen Partners', '2022-11-01', 'ramping', 64, null, 61, 70, 79, 49, 0.74, 0.11, 760, 360, 'open'],
  [5, 'Atlanta North', 1, 2, 34.05, -84.30, 'Peachtree Ops', '2018-05-01', 'mature', 84, 80, 81, 82, 92, 67, 0.86, 0.05, 1690, 588, 'open'],
  [6, 'Charlotte Metro', 1, 2, 35.23, -80.84, 'Carolinas First', '2021-02-01', 'established', 69, 63, 66, 72, 80, 52, 0.77, 0.10, 1020, 446, 'open'],
  [7, 'Tampa Bay', 1, 2, 27.95, -82.46, 'Gulfstream LLC', '2023-04-01', 'ramping', 47, null, 44, 52, 61, 33, 0.66, 0.18, 470, 248, 'open'],
  [8, 'Nashville', 1, 2, 36.17, -86.78, 'Cumberland Co', '2020-10-01', 'established', 76, 72, 73, 77, 85, 60, 0.81, 0.07, 1280, 512, 'open'],

  // ── Two Maids (recurring_service) ─────────────────────────────────────────
  [9, 'Seattle Eastside', 2, 1, 47.61, -122.20, 'Cascade Clean LLC', '2019-07-01', 'mature', 90, 85, 88, 87, 93, 74, 0.91, 0.03, 1420, 1980, 'open'],
  [10, 'Portland Metro', 2, 1, 45.52, -122.68, 'Rosewood Services', '2021-05-01', 'established', 78, 74, 76, 79, 86, 62, 0.83, 0.06, 980, 1540, 'open'],
  [11, 'Sacramento Valley', 2, 1, 38.58, -121.49, 'Delta Home Co', '2022-08-01', 'ramping', 58, null, 55, 62, 73, 44, 0.71, 0.13, 540, 980, 'open'],
  [12, 'Las Vegas', 2, 1, 36.17, -115.14, 'Mojave Maids', '2023-01-01', 'ramping', 41, null, 36, 46, 58, 28, 0.62, 0.21, 360, 720, 'open'],
  [13, 'Orlando', 2, 2, 28.54, -81.38, 'Sunshine Home LLC', '2018-09-01', 'mature', 86, 82, 85, 84, 90, 70, 0.88, 0.04, 1310, 1860, 'open'],
  [14, 'Miami-Dade', 2, 2, 25.78, -80.21, 'Biscayne Partners', '2020-03-01', 'established', 74, 69, 71, 76, 84, 58, 0.80, 0.08, 1060, 1490, 'open'],
  [15, 'Raleigh-Durham', 2, 2, 35.84, -78.64, 'Triangle Clean Co', '2021-11-01', 'established', 71, 66, 69, 73, 81, 56, 0.78, 0.09, 870, 1320, 'open'],
  [16, 'Birmingham', 2, 2, 33.52, -86.81, 'Magic City Svcs', '2022-06-01', 'ramping', 53, null, 49, 57, 68, 39, 0.69, 0.15, 470, 880, 'open'],

  // ── Mister Sparky (on_demand_dispatch) ────────────────────────────────────
  [17, 'Salt Lake City', 3, 1, 40.76, -111.89, 'Wasatch Electric', '2019-02-01', 'mature', 83, 79, 80, 82, 89, 66, 0.85, 0.05, 1560, 720, 'open'],
  [18, 'Boise', 3, 1, 43.62, -116.21, 'Treasure Valley Co', '2021-07-01', 'established', 70, 65, 67, 73, 82, 54, 0.77, 0.10, 940, 510, 'open'],
  [19, 'Tucson', 3, 1, 32.22, -110.97, 'Saguaro Power LLC', '2022-10-01', 'ramping', 49, null, 45, 54, 63, 35, 0.67, 0.17, 520, 320, 'open'],
  [20, 'Albuquerque', 3, 1, 35.08, -106.65, 'Rio Grande Elec', '2020-12-01', 'established', 67, 61, 64, 70, 79, 50, 0.75, 0.11, 820, 470, 'open'],
  [21, 'Jacksonville', 3, 2, 30.33, -81.66, 'First Coast Power', '2019-11-01', 'mature', 80, 75, 78, 80, 88, 63, 0.84, 0.06, 1340, 660, 'open'],
  [22, 'Memphis', 3, 2, 35.12, -89.97, 'Bluff City Electric', '2023-03-01', 'ramping', 44, null, 40, 49, 60, 31, 0.64, 0.19, 380, 240, 'open'],
  [23, 'Savannah', 3, 2, 32.08, -81.09, 'Coastal Empire Co', '2021-04-01', 'established', 73, 68, 70, 75, 84, 57, 0.79, 0.08, 1010, 520, 'open'],
  [24, 'Charleston', 3, 2, 32.78, -79.93, 'Lowcountry Power', '2022-02-01', 'ramping', 61, null, 58, 65, 76, 47, 0.72, 0.12, 690, 410, 'open'],
];

const brandMeta = (id: number) => BRANDS.find((b) => b.brandId === id)!;
const regionName = (id: number) => REGIONS.find((r) => r.regionId === id)!.regionName;

// Re-export the raw rows as a richer internal record the services derive from.
export interface TerritorySeed {
  id: number; name: string; brandId: number; regionId: number;
  lat: number; lng: number; franchisee: string; openDate: string; tenure: TenureBand;
  composite: number; financial: number | null; customer: number; growth: number; compliance: number;
  nps: number; slotFill: number; noShow: number; grossRevK: number; jobsLtm: number;
  status: 'open' | 'sold' | 'available';
}

export const SEEDS: TerritorySeed[] = ROWS.map((r) => ({
  id: r[0], name: r[1], brandId: r[2], regionId: r[3], lat: r[4], lng: r[5],
  franchisee: r[6], openDate: r[7], tenure: r[8],
  composite: r[9], financial: r[10], customer: r[11], growth: r[12], compliance: r[13],
  nps: r[14], slotFill: r[15], noShow: r[16], grossRevK: r[17], jobsLtm: r[18], status: r[19],
}));

// ── /api/territories ────────────────────────────────────────────────────────
export function buildTerritoryList(): TerritoryListResponse {
  const items: TerritoryListItem[] = SEEDS.map((s) => ({
    territoryId: s.id,
    territoryName: s.name,
    brandId: s.brandId,
    brandName: brandMeta(s.brandId).brandName,
    regionId: s.regionId,
    regionName: regionName(s.regionId),
    franchiseeName: s.franchisee,
    openDate: s.openDate,
    tenureBand: s.tenure,
    archetype: brandMeta(s.brandId).archetype,
    status: s.status,
    lat: s.lat,
    lng: s.lng,
    compositeScore: s.composite,
  }));
  return { items, page: 1, pageSize: 50, totalCount: items.length };
}

// ── /api/dashboard/corporate ──────────────────────────────────────────────────
// A short, eased, believable trailing series for each hero tile (12 points, LTM).
const spark = (end: number, swing: number, dip = false): number[] => {
  const pts: number[] = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const base = end - swing * (1 - t);
    const wobble = Math.sin(i * 1.7) * swing * 0.12;
    const late = dip && i > 8 ? -swing * 0.18 * (i - 8) : 0;
    pts.push(Math.max(0, base + wobble + late));
  }
  return pts;
};

export function buildCorporateDashboard(): CorporateDashboard {
  const atRisk = SEEDS.filter((s) => s.composite < 50).length;

  const vitalSigns: VitalSign[] = [
    {
      metricKey: 'system_revenue_ltm', label: 'System Revenue LTM', value: 42_800_000,
      unit: 'dollars', trendDirection: 'up', trendPercent: 6.1,
      provenanceType: 'seeded', asOfDate: ASOF_REPORTED, refreshStatus: 'seeded', confidenceLevel: 'low',
      spark: spark(42.8, 7.5),
    },
    {
      metricKey: 'royalty_revenue_ltm', label: 'Royalty Revenue LTM', value: 2_996_000,
      unit: 'dollars', trendDirection: 'up', trendPercent: 5.4,
      provenanceType: 'seeded', asOfDate: ASOF_REPORTED, refreshStatus: 'seeded', confidenceLevel: 'low',
      spark: spark(3.0, 0.5),
    },
    {
      metricKey: 'royalty_collection_rate', label: 'Royalty Collection Rate', value: 0.942,
      unit: 'percent', trendDirection: 'down', trendPercent: -1.3,
      provenanceType: 'seeded', asOfDate: ASOF_REPORTED, refreshStatus: 'seeded', confidenceLevel: 'low',
      spark: spark(0.942, 0.05, true),
    },
    {
      metricKey: 'same_territory_growth_yoy', label: 'Same-Territory Growth YoY', value: 0.043,
      // The value IS a YoY growth rate — so its delta must compare against a
      // DIFFERENT reference, not restate itself ("4.3%" + "▲4.3% YoY"). Here:
      // 4.3% actual vs a 5.0% plan target = 0.7pt behind plan (the kpi-tile keys
      // the "vs 5.0% plan" basis caption off this metricKey).
      unit: 'percent', trendDirection: 'down', trendPercent: -0.7,
      provenanceType: 'seeded', asOfDate: ASOF_REPORTED, refreshStatus: 'seeded', confidenceLevel: 'low',
      spark: spark(0.043, 0.03),
    },
    {
      metricKey: 'jobs_completed_ltm', label: 'Jobs Completed LTM', value: 18_520,
      unit: 'count', trendDirection: 'up', trendPercent: 6.1,
      provenanceType: 'measured', asOfDate: ASOF_MEASURED, refreshStatus: 'current', confidenceLevel: 'high',
      spark: spark(18.52, 3.0),
    },
    {
      metricKey: 'active_territories', label: 'Active Territories', value: 24,
      unit: 'count', trendDirection: 'up', trendPercent: 9.1,
      provenanceType: 'measured', asOfDate: ASOF_MEASURED, refreshStatus: 'current', confidenceLevel: 'high',
      spark: spark(24, 4),
    },
    {
      metricKey: 'territories_at_risk', label: 'Territories At Risk', value: atRisk,
      unit: 'count', trendDirection: 'up', trendPercent: 33.0,
      provenanceType: 'measured', asOfDate: ASOF_MEASURED, refreshStatus: 'current', confidenceLevel: 'high',
      spark: spark(atRisk, 3),
    },
    {
      metricKey: 'network_nps', label: 'Network NPS', value: 51,
      unit: 'nps', trendDirection: 'down', trendPercent: -3.8,
      provenanceType: 'seeded', asOfDate: ASOF_MEASURED, refreshStatus: 'seeded', confidenceLevel: 'medium',
      spark: spark(51, 8, true),
    },
  ];

  const brandComparison: BrandComparisonRow[] = BRANDS.map((b) => {
    const rows = SEEDS.filter((s) => s.brandId === b.brandId);
    const avg = (sel: (s: TerritorySeed) => number) =>
      Math.round(rows.reduce((a, s) => a + sel(s), 0) / rows.length);
    const watch = rows.filter((s) => s.composite < 50 || s.nps < 40).length;
    const topIssue =
      avg((s) => s.nps) < 45 ? 'NPS deterioration'
        : rows.some((s) => s.composite < 50) ? 'At-risk territories'
          : avg((s) => s.growth) < 65 ? 'Growth softening'
            : 'Stable';
    return {
      brandId: b.brandId, brandName: b.brandName, archetype: b.archetype,
      territoryCount: rows.length,
      compositeHealthScore: avg((s) => s.composite),
      financialScore: null, // brand-level financial pending while reporting lags
      customerScore: avg((s) => s.customer),
      growthScore: avg((s) => s.growth),
      complianceScore: avg((s) => s.compliance),
      watchlistCount: watch,
      topIssue,
    };
  });

  return {
    period: { periodId: 202605, label: 'May 2026', trailingWindowMonths: 12 },
    scope: { scopeLevel: 'corporate', territoryIds: [] },
    vitalSigns,
    brandComparison,
    dataNotes: [
      {
        severity: 'info',
        message:
          'Financial metrics are illustrative/seeded and lag measured operational metrics. ' +
          'Operational KPIs (jobs completed, slot fill, no-show) are measured from the booking system.',
      },
      {
        severity: 'warning',
        message: 'Network NPS is seeded pending the NPS pipeline (Slice C); flips to measured with a single data-source change.',
      },
    ],
  };
}

// ── /api/territories/{id}/health-score ────────────────────────────────────────
export function buildHealthScore(territoryId: number): TerritoryHealthScore | null {
  const s = SEEDS.find((x) => x.id === territoryId);
  if (!s) return null;
  const b = brandMeta(s.brandId);
  const brandRows = SEEDS.filter((x) => x.brandId === s.brandId);
  const bench = (sel: (r: TerritorySeed) => number) =>
    brandRows.reduce((a, r) => a + sel(r), 0) / brandRows.length;

  const npsBench = Math.round(bench((r) => r.nps));
  const fillBench = +(bench((r) => r.slotFill)).toFixed(2);
  const noShowBench = +(bench((r) => r.noShow)).toFixed(2);

  const drivers: Driver[] = [
    {
      subScore: 'customer', metricKey: 'nps_score', label: 'NPS',
      value: s.nps, benchmark: npsBench,
      impact: s.nps >= npsBench ? 'positive' : 'negative',
      severity: s.nps < npsBench - 12 ? 'high' : s.nps < npsBench ? 'medium' : 'low',
      provenanceType: 'seeded', asOfDate: ASOF_MEASURED,
    },
    {
      subScore: 'growth', metricKey: 'slot_fill_rate', label: 'Slot Fill Rate',
      value: s.slotFill, benchmark: fillBench,
      impact: s.slotFill >= fillBench ? 'positive' : 'negative',
      severity: s.slotFill < fillBench - 0.08 ? 'high' : s.slotFill < fillBench ? 'medium' : 'low',
      provenanceType: 'measured', asOfDate: ASOF_MEASURED,
    },
    {
      subScore: 'customer', metricKey: 'no_show_rate', label: 'No-Show Rate',
      value: s.noShow, benchmark: noShowBench,
      impact: s.noShow <= noShowBench ? 'positive' : 'negative',
      severity: s.noShow > noShowBench + 0.05 ? 'high' : s.noShow > noShowBench ? 'medium' : 'low',
      provenanceType: 'measured', asOfDate: ASOF_MEASURED,
    },
    {
      subScore: 'compliance', metricKey: 'royalty_collected', label: 'Royalty Collection',
      value: s.compliance, benchmark: 85,
      impact: s.compliance >= 85 ? 'positive' : 'negative',
      severity: s.compliance < 70 ? 'high' : s.compliance < 85 ? 'medium' : 'low',
      provenanceType: 'seeded', asOfDate: ASOF_REPORTED,
    },
  ];

  const scoreStatus = s.financial === null ? 'pending_financial_reporting' : 'complete';
  const scoreNotes = [
    ...(s.financial === null
      ? [{ type: 'missing_input' as const, message: 'Financial score pending — current royalty-cycle reporting not received.' }]
      : []),
    ...(s.tenure === 'ramping' || s.tenure === 'launch'
      ? [{ type: 'tenure_adjusted' as const, message: `Sub-scores tenure-adjusted: this ${s.tenure} territory is compared to a ramp curve, not the mature benchmark.` }]
      : []),
  ];

  return {
    territoryId: s.id,
    territoryName: s.name,
    brandName: b.brandName,
    regionName: regionName(s.regionId),
    periodId: 202605,
    scoreStatus,
    scoreVersion: { scoreVersionId: 'franchise_ops_v1', ownerTeam: 'Franchise Ops' },
    scores: {
      composite: s.composite,
      financial: s.financial,
      customer: s.customer,
      growth: s.growth,
      compliance: s.compliance,
    },
    scoreNotes,
    // Show the strongest signals first: highest severity, negatives before positives.
    drivers: drivers.sort((a, c) => {
      const sv = { high: 0, medium: 1, low: 2 };
      if (sv[a.severity] !== sv[c.severity]) return sv[a.severity] - sv[c.severity];
      return a.impact === c.impact ? 0 : a.impact === 'negative' ? -1 : 1;
    }),
  };
}

// ── /api/dashboard/watchlist ──────────────────────────────────────────────────
export function buildWatchlist(): WatchlistResponse {
  const items: WatchlistFlag[] = [];
  let seq = 9001;
  for (const s of SEEDS) {
    const b = brandMeta(s.brandId);
    const common = {
      territoryId: s.id, territoryName: s.name, brandName: b.brandName,
      regionName: regionName(s.regionId), status: 'open' as const,
    };
    if (s.nps < 50) {
      items.push({
        ...common, watchlistFlagId: `WF-${seq++}`, flagKey: 'nps_below_threshold',
        category: 'customer', severity: s.nps < 35 ? 'high' : 'medium',
        currentValue: s.nps, thresholdValue: 50, detectedAt: `${ASOF_MEASURED}T08:30:00Z`,
        explanation: 'NPS below brand threshold; declined two consecutive periods.',
      });
    }
    if (s.noShow > 0.15) {
      items.push({
        ...common, watchlistFlagId: `WF-${seq++}`, flagKey: 'no_show_spike',
        category: 'customer', severity: s.noShow > 0.18 ? 'high' : 'medium',
        currentValue: +s.noShow.toFixed(2), thresholdValue: 0.15, detectedAt: `${ASOF_MEASURED}T08:30:00Z`,
        explanation: 'No-show rate exceeded threshold for two consecutive periods.',
      });
    }
    if (s.financial === null) {
      items.push({
        ...common, watchlistFlagId: `WF-${seq++}`, flagKey: 'pending_financial_reporting',
        category: 'financial', severity: 'medium',
        currentValue: 0, thresholdValue: 1, detectedAt: `${ASOF_REPORTED}T23:59:00Z`,
        explanation: 'No reported revenue received this royalty cycle; financial sub-score withheld.',
      });
    }
    if (s.composite < 50) {
      items.push({
        ...common, watchlistFlagId: `WF-${seq++}`, flagKey: 'revenue_deterioration',
        category: 'growth', severity: 'high',
        currentValue: s.composite, thresholdValue: 50, detectedAt: `${ASOF_REPORTED}T23:59:00Z`,
        explanation: 'Composite health below intervention floor (seeded revenue trend <60% of brand avg ×3 periods).',
      });
    }
  }
  // Highest severity first, then most-below-threshold.
  const sv = { high: 0, medium: 1, low: 2 };
  items.sort((a, c) => sv[a.severity] - sv[c.severity]);
  return { items, totalCount: items.length };
}
