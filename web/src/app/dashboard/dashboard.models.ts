// Dashboard view-model contracts — copied VERBATIM from CONTRACT.md §2 (v1).
// Charlie builds against these exact shapes; D17 swaps the data source from
// fixtures to live Bravo endpoints with NO shape change.
//
// Provenance is a first-class field on every metric: the "measured vs
// reported/seeded" separation is the product's honesty story (D16), not fine print.

export type ProvenanceType = 'measured' | 'seeded' | 'reported';
export type RefreshStatus = 'current' | 'stale' | 'missing' | 'pending' | 'seeded';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type TrendDirection = 'up' | 'down' | 'flat';
export type ScoreStatus = 'complete' | 'partial' | 'pending_financial_reporting';
export type Impact = 'positive' | 'negative';
export type Severity = 'high' | 'medium' | 'low';
export type SubScoreKey = 'financial' | 'customer' | 'growth' | 'compliance';
export type TenureBand = 'launch' | 'ramping' | 'established' | 'mature';
export type Archetype = 'project_installation' | 'recurring_service' | 'on_demand_dispatch';
export type Unit = 'count' | 'dollars' | 'percent' | 'ratio' | 'score' | 'nps';

// ── GET /api/territories ────────────────────────────────────────────────────
export interface TerritoryListItem {
  territoryId: number;
  territoryName: string;
  brandId: number;
  brandName: string;
  regionId: number;
  regionName: string;
  franchiseeName: string;
  openDate: string;
  tenureBand: TenureBand;
  archetype: Archetype;
  status: 'open' | 'sold' | 'available';
  // lat/long are part of the registry (CONTRACT §1 D1 / D9) so the map is alive.
  lat: number;
  lng: number;
  compositeScore: number;
}

export interface TerritoryListResponse {
  items: TerritoryListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

// ── GET /api/dashboard/corporate ────────────────────────────────────────────
export interface PeriodInfo {
  periodId: number;
  label: string;
  trailingWindowMonths: number;
}

export interface ScopeInfo {
  scopeLevel: 'corporate' | 'brand' | 'region' | 'territory' | 'franchisee';
  territoryIds: number[];
}

export interface VitalSign {
  metricKey: string;
  label: string;
  value: number;
  unit: Unit;
  trendDirection?: TrendDirection;
  trendPercent?: number;
  provenanceType: ProvenanceType;
  asOfDate: string;
  refreshStatus: RefreshStatus;
  confidenceLevel: ConfidenceLevel;
  // Sparkline series — trailing-window points (Charlie-side presentation aid;
  // Bravo may omit, in which case the tile renders without a sparkline).
  spark?: number[];
}

export interface BrandComparisonRow {
  brandId: number;
  brandName: string;
  archetype: Archetype;
  territoryCount: number;
  compositeHealthScore: number;
  financialScore: number | null;
  customerScore: number;
  growthScore: number;
  complianceScore: number;
  watchlistCount: number;
  topIssue: string;
}

export interface DataNote {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface CorporateDashboard {
  period: PeriodInfo;
  scope: ScopeInfo;
  vitalSigns: VitalSign[];
  brandComparison: BrandComparisonRow[];
  dataNotes: DataNote[];
}

// ── GET /api/territories/{id}/health-score ──────────────────────────────────
export interface ScoreVersion {
  scoreVersionId: string;
  ownerTeam: string;
}

export interface SubScores {
  composite: number;
  financial: number | null;
  customer: number;
  growth: number;
  compliance: number;
}

export interface ScoreNote {
  type: 'missing_input' | 'tenure_adjusted' | 'info';
  message: string;
}

export interface Driver {
  subScore: SubScoreKey;
  metricKey: string;
  label: string;
  value: number;
  benchmark: number;
  impact: Impact;
  severity: Severity;
  provenanceType: ProvenanceType;
  asOfDate: string;
}

export interface TerritoryHealthScore {
  territoryId: number;
  territoryName: string;
  brandName: string;
  regionName: string;
  periodId: number;
  scoreStatus: ScoreStatus;
  scoreVersion: ScoreVersion;
  scores: SubScores;
  scoreNotes: ScoreNote[];
  drivers: Driver[];
}

// ── GET /api/dashboard/watchlist ────────────────────────────────────────────
export interface WatchlistFlag {
  watchlistFlagId: string;
  territoryId: number;
  territoryName: string;
  brandName: string;
  regionName: string;
  flagKey: string;
  category: 'customer' | 'financial' | 'growth' | 'compliance';
  severity: Severity;
  status: 'open' | 'acknowledged' | 'resolved';
  currentValue: number;
  thresholdValue: number;
  detectedAt: string;
  explanation: string;
}

export interface WatchlistResponse {
  items: WatchlistFlag[];
  totalCount: number;
}
