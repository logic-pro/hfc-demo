# HFC brand palette — source of truth for BOTH light & dark themes

User-provided official HFC (Home Franchise Concepts) brand colors. Every theme we build — light AND dark —
must be grounded in these. Confirmed against the HFC homepage (orange hero, maroon CTA, warm-grey logo).

| Hex | Name | Character |
|---|---|---|
| `#e7602a` | HFC Orange | PRIMARY brand — hero, CTAs, active states, links |
| `#f99c1c` | HFC Amber/Gold | SECONDARY accent — highlights, the logo "house", secondary series |
| `#7c0000` | HFC Maroon | DEEP accent — strong CTAs ("GET STARTED"), emphasis, critical/at-risk |
| `#d2cac2` | Warm Stone | warm light NEUTRAL — light surfaces/panels; on dark = muted/eyebrow text |
| `#646261` | Warm Grey | NEUTRAL text — muted/secondary copy, borders |

## Role mapping (design tokens — apply to BOTH themes)
Tokens stay the same; only their values flip between light/dark.

### LIGHT theme
- `--bg`            #faf8f6 (warm near-white)   · `--surface` #ffffff · `--surface-2` #d2cac2 @ ~25% (warm stone tint)
- `--ink`          #2a2724 (warm near-black)    · `--ink-muted` #646261
- `--line`         #d2cac2 @ ~55%
- `--accent`       #e7602a (orange)  · `--accent-2` #f99c1c (amber) · `--accent-deep` #7c0000 (maroon)
- `--good` keep semantic green; `--warning` #f99c1c; `--critical`/at-risk #7c0000 (or a red derived from it)

### DARK theme (warm-dark, NOT the current cold slate/teal)
- `--bg`            #1a1614 (warm charcoal, faint maroon undertone) · `--surface` #241e1b · `--surface-2` #2e2723
- `--ink`          #f3ece6 (warm off-white)     · `--ink-muted` #d2cac2 (warm stone reads as muted on dark)
- `--line`         #646261 @ ~40%
- `--accent`       #f99c1c (amber pops better than orange on dark) · `--accent-2` #e7602a (orange) · `--accent-deep` #7c0000
- glow/at-risk:    #e7602a / #7c0000 instead of the current teal `#5fe3c0`

## Notes / guardrails
- The current Executive dashboard dark theme uses a cold slate + teal-green accent (`--ink-0`, `#5fe3c0`). Migrate its accents to the HFC palette above so dark mode is on-brand, not generic.
- Keep semantic health colors legible (strong/good/fair/warning/critical) but tie warning→amber, critical/at-risk→maroon where it reads well; never rely on color alone (keep text + glyph).
- Contrast: verify WCAG AA for text on every surface in BOTH themes (orange-on-white and stone-on-dark are the risky pairs).
- Toggle: CSS custom-property driven, `[data-theme="light"|"dark"]`, persist in localStorage, default to `prefers-color-scheme`, apply before first paint (no flash).
