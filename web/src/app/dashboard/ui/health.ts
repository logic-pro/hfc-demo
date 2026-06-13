// The single health language for the whole product. Color ONLY ever means health;
// the brand accent means "this is brand X"; gray means neutral. One scale, used by
// the map, the gauge, the tiles, the table — so the product reads as one system.

import { ConfidenceLevel, ProvenanceType, Unit } from '../dashboard.models';

export type HealthBand = 'critical' | 'warning' | 'fair' | 'good' | 'strong';

// Composite 0..100 → band. Floors tuned to the seeded spread so the 4 red
// territories land in `critical` and the top performers in `strong`.
export function band(score: number): HealthBand {
  if (score < 50) return 'critical';
  if (score < 62) return 'warning';
  if (score < 72) return 'fair';
  if (score < 82) return 'good';
  return 'strong';
}

// Resolved hex for canvas use (SVG fills/strokes) — mirrors the CSS custom props
// in theme.css so TS-driven dataviz and CSS-driven chrome never drift.
export const HEALTH_HEX: Record<HealthBand, string> = {
  critical: '#FF5470',
  warning: '#FF9F45',
  fair: '#FFD166',
  good: '#5FE3C0',
  strong: '#2FD3A6',
};

export const healthColor = (score: number): string => HEALTH_HEX[band(score)];

// CSS var token for a band — lets templates color via the shared palette.
export const healthVar = (score: number): string => `var(--health-${band(score)})`;

// ── Value formatting ─────────────────────────────────────────────────────────
// Hero numbers are the product. Format them tightly and consistently.
export function formatValue(value: number, unit: Unit): string {
  switch (unit) {
    case 'dollars':
      return formatDollars(value);
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'ratio':
      return value.toFixed(2);
    case 'nps':
      return Math.round(value).toString();
    case 'score':
      return Math.round(value).toString();
    case 'count':
    default:
      return formatCount(value);
  }
}

export function formatDollars(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function formatCount(v: number): string {
  if (v >= 1_000) return v.toLocaleString('en-US');
  return v.toString();
}

// The count-up animation needs to know how to render an interpolated value.
export function formatPartial(value: number, unit: Unit): string {
  switch (unit) {
    case 'dollars':
      return formatDollars(value);
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'ratio':
      return value.toFixed(2);
    default:
      return formatCount(Math.round(value));
  }
}

// ── Provenance language (D16 is built on this) ────────────────────────────────
export const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  measured: 'Measured',
  reported: 'Reported',
  seeded: 'Illustrative',
};

export const PROVENANCE_BLURB: Record<ProvenanceType, string> = {
  measured: 'Computed directly from the booking/operations system.',
  reported: 'Submitted by the franchisee through royalty/billing reporting.',
  seeded: 'Illustrative placeholder — swappable to a real source with no shape change.',
};

export const CONFIDENCE_DOTS: Record<ConfidenceLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};
