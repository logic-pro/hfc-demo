// Single home for dashboard number formatting (skill rule: never show raw
// unformatted numbers; handle null explicitly). null/undefined => 'Unavailable'
// so an unwired financial metric never renders as "0" or "NaN".

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatSignedInteger(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat('en-US').format(value)}`;
}

export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

// value is a ratio: 0.082 => "8.2%"
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
  return value > 0 ? `+${formatted}` : formatted;
}

// NPS is a whole number (-100..100), not a percentage.
export function formatNps(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return Math.round(value).toString();
}
