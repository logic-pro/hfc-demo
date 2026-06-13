import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { VitalSign } from '../dashboard.models';
import { CountUpDirective } from '../ui/count-up.directive';
import { SparklineComponent } from '../ui/sparkline';
import { PROVENANCE_LABEL, CONFIDENCE_DOTS } from '../ui/health';

// D11 — a single hero tile: count-up value, draw-in sparkline, trend delta, a
// provenance badge + as-of, and confidence dots. The provenance badge is on the
// HERO row (not buried) so the measured/illustrative split reads in the first 3s.
@Component({
  selector: 'ec-kpi-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountUpDirective, SparklineComponent],
  template: `
    @if (vital(); as v) {
      <article class="tile card" [attr.data-prov]="v.provenanceType" [style.--accent-line]="lineColor()">
        <header class="tile-head">
          <span class="eyebrow">{{ v.label }}</span>
          <span class="prov" [attr.data-prov]="v.provenanceType" [title]="provTitle()">
            <span class="prov-dot"></span>{{ provLabel() }}
          </span>
        </header>

        <div class="tile-value tnum" [ecCountUp]="v.value" [unit]="v.unit" [delayMs]="delayMs"></div>

        <div class="tile-foot">
          <div class="trend" [attr.data-dir]="trendKind()">
            @if (v.trendPercent !== undefined) {
              <span class="arrow">{{ arrow() }}</span>
              <span class="tnum">{{ trendText() }}</span>
              <span class="trend-cap">YoY</span>
            }
          </div>
          @if (v.spark?.length) {
            <ec-sparkline class="tile-spark" [data]="v.spark!" [color]="lineColor()" [w]="116" [h]="32" />
          }
        </div>

        <footer class="tile-meta">
          <span class="asof tnum">as of {{ v.asOfDate }}</span>
          <span class="conf" [attr.title]="v.confidenceLevel + ' confidence'">
            @for (d of dots(); track $index) {
              <span class="conf-dot" [class.lit]="d"></span>
            }
          </span>
        </footer>
      </article>
    }
  `,
  styleUrl: './kpi-tile.css',
})
export class KpiTileComponent {
  @Input({ required: true }) set data(v: VitalSign) { this._v.set(v); }
  @Input() delayMs = 0;
  private readonly _v = signal<VitalSign | null>(null);
  readonly vital = this._v;

  // Higher-is-better for all hero metrics EXCEPT these (up = bad).
  private static readonly LOWER_IS_BETTER = new Set(['territories_at_risk', 'no_show_rate']);

  readonly provLabel = computed(() => PROVENANCE_LABEL[this._v()!.provenanceType]);
  readonly provTitle = computed(() => {
    const v = this._v()!;
    return `${PROVENANCE_LABEL[v.provenanceType]} · refresh: ${v.refreshStatus} · ${v.confidenceLevel} confidence`;
  });

  readonly trendKind = computed<'good' | 'bad' | 'flat'>(() => {
    const v = this._v()!;
    if (v.trendPercent === undefined || v.trendDirection === 'flat') return 'flat';
    const up = v.trendDirection === 'up';
    const lowerBetter = KpiTileComponent.LOWER_IS_BETTER.has(v.metricKey);
    const good = lowerBetter ? !up : up;
    return good ? 'good' : 'bad';
  });

  readonly arrow = computed(() => {
    const d = this._v()!.trendDirection;
    return d === 'up' ? '▲' : d === 'down' ? '▼' : '–';
  });

  readonly trendText = computed(() => {
    const p = this._v()!.trendPercent ?? 0;
    return `${Math.abs(p).toFixed(1)}%`;
  });

  // Sparkline / accent line track the trend's goodness, never the raw direction.
  readonly lineColor = computed(() => {
    const k = this.trendKind();
    return k === 'good' ? 'var(--health-strong)' : k === 'bad' ? 'var(--health-warning)' : 'var(--ink-3)';
  });

  readonly dots = computed(() => {
    const lit = CONFIDENCE_DOTS[this._v()!.confidenceLevel];
    return [0, 1, 2].map((i) => i < lit);
  });
}
