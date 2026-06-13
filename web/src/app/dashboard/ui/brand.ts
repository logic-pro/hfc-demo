// Brand identity palette. A brand accent means "this is brand X" — it NEVER
// encodes health (the health scale owns color-as-meaning). Used for chips,
// legends and filter buttons only. One source so map/table/distribution agree.

export const BRAND_ACCENTS: Record<number, string> = {
  1: '#5B8CFF', // Budget Blinds
  2: '#36D6A0', // Two Maids
  3: '#FFB454', // Mister Sparky
};

export const brandAccent = (id: number): string => BRAND_ACCENTS[id] ?? 'var(--accent)';
