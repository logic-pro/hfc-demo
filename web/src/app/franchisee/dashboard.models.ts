// ─────────────────────────────────────────────────────────────────────────────
// Dashboard contract + view-models.
//
// Two layers, kept explicit so the compiler catches client/server drift:
//   1. *Dto types      — exactly what GET /api/dashboard returns (the read model).
//   2. *Vm types       — what presentational components render (formatted strings,
//                        status enums). The page maps Dto -> Vm once.
//
// The franchisee never aggregates raw rows: the API returns this pre-shaped.
// See API-CONTRACT.md for the endpoint definition.
// ─────────────────────────────────────────────────────────────────────────────

// ── filters / period ─────────────────────────────────────────────────────────
export type PeriodType = 'WTD' | 'MTD' | 'QTD' | 'YTD';

export interface DashboardFilters {
  period: PeriodType;
  territoryId: number | null; // null = all territories in the brand
}

export interface PeriodDto {
  type: PeriodType;
  label: string;          // "This month"
  start: string;          // ISO
  end: string;            // ISO
}

// ── generic async page state (skill: DashboardState<T>) ──────────────────────
export interface DashboardState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
}

export function initialState<T>(): DashboardState<T> {
  return { data: null, loading: true, error: null, lastUpdated: null };
}

// ── data quality / provenance (operator plane is measured; revenue is absent) ─
export type DataQuality = 'measured' | 'unavailable';

// ── KPIs ─────────────────────────────────────────────────────────────────────
export type KpiKey =
  | 'bookings'
  | 'slot_fill_rate'
  | 'deposit_conversion'
  | 'deposit_volume'
  | 'expired_abandoned';

export type KpiUnit = 'count' | 'percent' | 'currency_cents';

export type MetricStatus = 'good' | 'warning' | 'bad' | 'neutral';

/** The drill target a KPI/stage/territory click applies to the action table. */
export type ActionStageFilter =
  | 'all'
  | 'open_slots'
  | 'deposit_unpaid'
  | 'deposit_paid'
  | 'expired';

export interface KpiDto {
  key: KpiKey;
  label: string;
  value: number | null;        // raw; cents for currency, ratio 0..1 for percent
  unit: KpiUnit;
  deltaPercent: number | null; // vs comparison period, ratio (e.g. 0.082)
  trend: number[];             // sparkline series
  status: MetricStatus;
  dataQuality: DataQuality;
  higherIsBetter: boolean;
  tooltip: string;
  drillTo: ActionStageFilter;
}

// ── booking / fill trend ─────────────────────────────────────────────────────
export interface TrendPointDto {
  date: string;        // ISO day
  bookings: number;
  filledSlots: number;
  openSlots: number;
}

// ── deposit funnel — mirrors the Durable booking workflow ────────────────────
// Booked → Reminded → DepositPaid → Finalized   (Expired = the leak path)
export type FunnelStageKey =
  | 'Booked'
  | 'Reminded'
  | 'DepositPaid'
  | 'Finalized'
  | 'Expired';

export interface FunnelStageDto {
  stage: FunnelStageKey;
  count: number;
  /** ratio retained from the previous stage (null for the first / for leaks) */
  conversionFromPrev: number | null;
  isLeak: boolean;             // true for Expired
  drillTo: ActionStageFilter;
}

// ── territory breakdown ──────────────────────────────────────────────────────
export interface TerritoryRowDto {
  territoryId: number;
  territoryName: string;
  bookings: number;
  fillRate: number;            // 0..1
  depositConversion: number;   // 0..1
  needsActionCount: number;
}

// ── action table rows (appointments needing follow-up) ───────────────────────
export interface ActionRowDto {
  appointmentId: number;
  customerName: string;
  territoryId: number;
  territoryName: string;
  startUtc: string;
  service: string;
  depositCents: number;
  depositPaid: boolean;
  stage: FunnelStageKey;
  recommendedAction: string;
  severity: MetricStatus;
}

// ── the whole response ───────────────────────────────────────────────────────
export interface DashboardResponse {
  period: PeriodDto;
  lastUpdated: string;
  territory: { id: number; name: string } | null;
  kpis: KpiDto[];
  bookingTrend: TrendPointDto[];
  depositFunnel: FunnelStageDto[];
  territoryBreakdown: TerritoryRowDto[];
  actionRows: ActionRowDto[];
  // Money available is deposits only. True job revenue is not in the system.
  revenue: { available: false; reason: string };
}

// ── presentational view-models (formatted, status-ready) ─────────────────────

/** Direction of the delta — drives the GLYPH (▲ ▼ —), independent of good/bad.
 *  Status colour says "is this good or bad"; direction says "which way did it
 *  move". Keeping them separate stops the ▼ +20% contradiction. */
export type DeltaDirection = 'up' | 'down' | 'flat';

export interface KpiCardVm {
  key: KpiKey;
  label: string;
  formattedValue: string;
  deltaLabel: string | null;
  deltaDirection: DeltaDirection; // glyph direction, from the numeric delta sign
  deltaStatus: MetricStatus;   // colour of the delta chip (text-backed, never colour-only)
  status: MetricStatus;
  trend: number[];
  dataQuality: DataQuality;
  tooltip: string;
  drillTo: ActionStageFilter;
  /** True when this metric has no activity this period (e.g. zero deposits).
   *  Renders as an honest neutral "none this period" state — never a red alarm. */
  isEmpty: boolean;
  emptyLabel: string | null;   // e.g. "No deposits this period"
}
