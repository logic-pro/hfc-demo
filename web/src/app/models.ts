// Mirrors the API DTOs (HfcDemo records). Kept in one place so the contract
// is explicit and the compiler catches drift between client and server.
export interface Brand {
  id: string;
  name: string;
  tagline: string;
}

// A franchisee is the tenancy boundary (brand is the grouping). The picker uses
// this to stand in for a B2C/Entra login: selecting one mints a scoped token.
export interface Franchisee {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  region: string;
}

export interface DevTokenResponse {
  token: string;
  franchiseeId: string;
  brandId: string;
}

export interface Slot {
  id: number;
  territoryId: number;
  territoryName: string;
  startUtc: string;
  isBooked: boolean;
}

export interface Appointment {
  id: number;
  territoryId: number;
  startUtc: string;
  customerName: string;
  service: string;
  depositCents: number;
  depositPaid: boolean;
}

export interface BookRequest {
  slotId: number;
  customerName: string;
  service: string;
}

// The typed intake draft returned by POST /api/intake/parse. Mirrors the C#
// IntakeDraft. Every field is human-verifiable in the UI before it becomes a
// booking — source/usedAi/notice make the provenance explicit.
export type Urgency = 'Routine' | 'Soon' | 'Emergency';
export type TimeOfDay = 'Any' | 'Morning' | 'Afternoon' | 'Evening';

export interface IntakeDraft {
  customerName: string | null;
  service: string;
  urgency: Urgency;
  preferredTimeOfDay: TimeOfDay;
  preferredDate: string | null;
  territoryHint: string | null;
  notes: string;
  confidence: number;
  source: 'ai' | 'heuristic';
  usedAi: boolean;
  notice: string | null;
  model: string | null;
  latencyMs: number;
}

// ── Corporate executive dashboard (read model) ──────────────────────────────
// View models for the franchisor-CEO dashboard. These mirror the corporate
// read-model projections (docs/architecture/corporate-readmodel.sql), NOT the
// operational tables — the dashboard reads aggregates across franchisees, the
// one place the franchisee tenant filter is deliberately not applied (ADR-19).
//
// Provenance is first-class (ADR-20): every metric carries its data quality and
// an "as of" date. Financial fields stay value:null + dataQuality:'unavailable'
// + a gap note until completed_job.invoiceAmount + territory.royalty_rate exist.
// Deposits/estimates are never substituted for revenue.

export type DataQuality =
  | 'actual' // measured plane, app-native, near-real-time
  | 'proxy' // a stand-in measure, labelled as such
  | 'partial' // incomplete coverage for the period
  | 'estimated'
  | 'stale' // last good value, past its refresh window
  | 'unavailable'; // source not wired yet (e.g. financials) — NOT an error

// One tile's worth of metric, as it crosses the wire. The frontend owns
// formatting (number-format.util); the read model owns the calculation.
export interface Metric {
  value: number | null;
  deltaPercent?: number | null;
  sparkline?: number[];
  dataQuality: DataQuality;
  asOf: string; // ISO date of the underlying snapshot
  gap?: string; // shown when dataQuality === 'unavailable'
}

export interface HeroPeriod {
  type: 'MTD' | 'QTD' | 'YTD' | 'TTM';
  start: string;
  end: string;
}

// GET /api/corporate-dashboard/hero  ← executive_kpi_snapshot
export interface HeroVm {
  period: HeroPeriod;
  lastUpdated: string;
  metricVersion: string;
  metrics: {
    // measured plane — real from day one
    activeTerritories: Metric;
    atRiskTerritories: Metric;
    networkNps: Metric;
    newFranchiseSales: Metric;
    // reported plane — 'unavailable' until the two OLTP fields land
    grossSales: Metric;
    royaltyRevenue: Metric;
    sameTerritoryGrowth: Metric;
    collectionRate: Metric;
  };
}
