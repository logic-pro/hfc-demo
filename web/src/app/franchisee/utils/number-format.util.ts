// Single home for number/label formatting so no component reinvents it.
// Every formatter handles null explicitly → "Unavailable", never "NaN" / "$NaN".

import { KpiUnit, MetricStatus } from '../dashboard.models';

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatPercent(ratio: number | null | undefined, decimals = 1): string {
  if (ratio === null || ratio === undefined) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(ratio);
}

/** Deposits are stored in cents. Compact ($8.4K) for tiles. */
export function formatCurrencyCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

export function formatKpiValue(value: number | null, unit: KpiUnit): string {
  switch (unit) {
    case 'percent':
      return formatPercent(value);
    case 'currency_cents':
      return formatCurrencyCents(value);
    case 'count':
    default:
      return formatCount(value);
  }
}

/** Signed delta chip text, e.g. "+8.2%" / "−3.1%" / null when no comparison. */
export function formatDeltaPercent(ratio: number | null | undefined): string | null {
  if (ratio === null || ratio === undefined) return null;
  const sign = ratio > 0 ? '+' : ratio < 0 ? '−' : '';
  const pct = new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(Math.abs(ratio));
  return `${sign}${pct}`;
}

/**
 * Status of a delta given the metric's polarity. A drop in fill-rate is bad;
 * a drop in expired-bookings is good. Keeps colour semantics honest.
 */
export function deltaStatus(
  ratio: number | null | undefined,
  higherIsBetter: boolean,
): MetricStatus {
  if (ratio === null || ratio === undefined || ratio === 0) return 'neutral';
  const improving = higherIsBetter ? ratio > 0 : ratio < 0;
  return improving ? 'good' : 'bad';
}

export function formatDayShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateTimeShort(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
