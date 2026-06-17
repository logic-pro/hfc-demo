import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PROVENANCE_VAR, ProvenanceType, formatValue } from './reports.models';

export interface ChartDatum {
  label: string;
  value: number;
}

interface Bar {
  label: string;
  short: string;
  value: number;
  display: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Hand-rolled SVG bar chart — no chart lib, design tokens only (mirrors the
// dashboard's "draw it ourselves" viz identity). Charts ONE metric across the
// grouped dimension members, scaled to the tallest bar. Illustrative metrics
// render with a hatched fill and a caption so a seeded number never reads as
// boldly as a measured one (D16). Empty/degenerate inputs render an honest note,
// never a broken axis.
@Component({
  selector: 'bo-report-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bars().length) {
      <figure class="m-0">
        <figcaption class="mb-2 flex items-baseline justify-between gap-2">
          <span class="text-sm font-semibold text-[var(--ink-strong)]">{{ metricLabel() }}</span>
          <span class="text-[11px] text-[var(--ink-muted)]">by {{ dimensionLabel() }}</span>
        </figcaption>
        <svg
          [attr.viewBox]="'0 0 ' + W + ' ' + H"
          width="100%"
          [attr.height]="H"
          role="img"
          [attr.aria-label]="ariaLabel()"
          class="block"
        >
          <defs>
            <pattern
              id="bo-illustrative-hatch"
              width="6"
              height="6"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width="6" height="6" [attr.fill]="barFill()" opacity="0.35" />
              <line x1="0" y1="0" x2="0" y2="6" [attr.stroke]="barFill()" stroke-width="3" />
            </pattern>
          </defs>

          <!-- Gridlines + y baseline -->
          @for (g of gridLines(); track g.v) {
            <line
              [attr.x1]="PAD_L"
              [attr.x2]="W - PAD_R"
              [attr.y1]="g.y"
              [attr.y2]="g.y"
              stroke="var(--line)"
              stroke-width="1"
              [attr.stroke-dasharray]="g.v === 0 ? '0' : '2 4'"
            />
            <text
              [attr.x]="PAD_L - 8"
              [attr.y]="g.y + 4"
              text-anchor="end"
              class="fill-[var(--ink-muted)]"
              style="font-size: 10px"
            >
              {{ g.label }}
            </text>
          }

          <!-- Bars -->
          @for (b of bars(); track b.label) {
            <g>
              <rect
                [attr.x]="b.x"
                [attr.y]="b.y"
                [attr.width]="b.w"
                [attr.height]="b.h"
                rx="3"
                [attr.fill]="illustrative() ? 'url(#bo-illustrative-hatch)' : barFill()"
              >
                <title>{{ b.label }}: {{ b.display }}</title>
              </rect>
              <text
                [attr.x]="b.x + b.w / 2"
                [attr.y]="b.y - 5"
                text-anchor="middle"
                class="fill-[var(--ink)]"
                style="font-size: 10px; font-weight: 600"
              >
                {{ b.display }}
              </text>
              <text
                [attr.x]="b.x + b.w / 2"
                [attr.y]="H - PAD_B + 14"
                text-anchor="middle"
                class="fill-[var(--ink-muted)]"
                style="font-size: 10px"
              >
                {{ b.short }}
              </text>
            </g>
          }
        </svg>
        @if (illustrative()) {
          <p class="mt-1 text-[11px] italic text-[var(--ink-muted)]">
            Hatched bars — illustrative metric, not measured from operations.
          </p>
        }
      </figure>
    } @else {
      <p class="py-8 text-center text-sm text-[var(--ink-muted)]">
        No chartable values for this metric.
      </p>
    }
  `,
})
export class ReportChartComponent {
  readonly data = input<ChartDatum[]>([]);
  readonly metricLabel = input<string>('');
  readonly dimensionLabel = input<string>('');
  readonly unit = input<string | undefined>(undefined);
  readonly provenance = input<ProvenanceType | undefined>(undefined);
  /** Honesty flag straight off the API column — the primary signal, not the plane. */
  readonly illustrativeFlag = input<boolean>(false);

  // viewBox geometry — fixed coordinate space, scaled responsively by width="100%".
  readonly W = 720;
  readonly H = 240;
  readonly PAD_L = 56;
  readonly PAD_R = 16;
  readonly PAD_T = 18;
  readonly PAD_B = 28;

  readonly illustrative = computed(() => this.illustrativeFlag() || this.provenance() === 'seeded');
  readonly barFill = computed(() => {
    const p = this.provenance();
    if (this.illustrative()) return PROVENANCE_VAR.seeded;
    return p && p !== 'measured' ? PROVENANCE_VAR[p] : 'var(--accent)';
  });

  private readonly max = computed(() => {
    const vals = this.data().map((d) => d.value);
    const m = Math.max(0, ...vals);
    return m === 0 ? 1 : m;
  });

  readonly bars = computed<Bar[]>(() => {
    const data = this.data();
    if (!data.length) return [];
    const plotW = this.W - this.PAD_L - this.PAD_R;
    const plotH = this.H - this.PAD_T - this.PAD_B;
    const max = this.max();
    const slot = plotW / data.length;
    const barW = Math.min(64, slot * 0.62);
    return data.map((d, i) => {
      const h = max > 0 ? Math.max(1, (Math.max(0, d.value) / max) * plotH) : 1;
      const x = this.PAD_L + slot * i + (slot - barW) / 2;
      const y = this.PAD_T + (plotH - h);
      return {
        label: d.label,
        short: d.label.length > 12 ? d.label.slice(0, 11) + '…' : d.label,
        value: d.value,
        display: formatValue(d.value, this.unit()),
        x,
        y,
        w: barW,
        h,
      };
    });
  });

  readonly gridLines = computed(() => {
    const max = this.max();
    const plotH = this.H - this.PAD_T - this.PAD_B;
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const v = (max / steps) * i;
      const y = this.PAD_T + plotH - (plotH * i) / steps;
      return { v, y, label: formatValue(v, this.unit()) };
    });
  });

  readonly ariaLabel = computed(() => {
    const parts = this.bars().map((b) => `${b.label}: ${b.display}`);
    return `${this.metricLabel()} by ${this.dimensionLabel()}. ${parts.join('; ')}`;
  });
}
