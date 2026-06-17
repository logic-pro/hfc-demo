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
// in styles.css so TS-driven dataviz and CSS-driven chrome never drift. Tuned for
// the executive dashboard's dark canvas and grounded in the HFC palette: critical
// = maroon-family red, warning = HFC orange, fair = HFC amber/gold, and good/
// strong keep a semantic green (the spec keeps green = good) — a perceptually
// separable ramp where every band reads distinctly at a glance.
export const HEALTH_HEX: Record<HealthBand, string> = {
  critical: '#FF6B6B',
  warning: '#E7602A',
  fair: '#F9C04C',
  good: '#5CCB8E',
  strong: '#2FD3A6',
};

export const healthColor = (score: number): string => HEALTH_HEX[band(score)];

// CSS var token for a band — lets templates color via the shared palette.
export const healthVar = (score: number): string => `var(--health-${band(score)})`;
export const bandHex = (b: HealthBand): string => HEALTH_HEX[b];
export const bandVar = (b: HealthBand): string => `var(--health-${b})`;

// Bands low→high — the x-axis order for the distribution histogram. Worst on the
// left so the eye reads the at-risk tail first (where intervention lives).
export const BANDS: HealthBand[] = ['critical', 'warning', 'fair', 'good', 'strong'];

export const BAND_LABEL: Record<HealthBand, string> = {
  critical: 'Critical',
  warning: 'Warning',
  fair: 'Fair',
  good: 'Good',
  strong: 'Strong',
};

// Human-readable score ranges — must mirror the floors in band() above.
export const BAND_RANGE: Record<HealthBand, string> = {
  critical: '<50',
  warning: '50–61',
  fair: '62–71',
  good: '72–81',
  strong: '82+',
};

// ── Value formatting ─────────────────────────────────────────────────────────
// Hero numbers are the product. Format them tightly and consistently.
// Null-safe (integration graft): CONTRACT §2 types value as a non-null `number`,
// but a live response can omit/null a metric whose source isn't wired yet. Guard
// at this single formatting seam so a missing value renders a clear 'Unavailable'
// — never a misleading 0 or a raw 'NaN'.
export function formatValue(value: number | null | undefined, unit: Unit): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Unavailable';
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
export function formatPartial(value: number | null | undefined, unit: Unit): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Unavailable';
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
