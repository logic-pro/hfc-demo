import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { ProvenanceType, VitalSign } from '../dashboard.models';
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
      <article
        class="tile card"
        [attr.data-prov]="v.provenanceType"
        [attr.data-unavailable]="isUnavailable()"
        [class.plane-lit]="planeState() === 'lit'"
        [class.plane-dim]="planeState() === 'dim'"
        [style.--accent-line]="lineColor()"
        [style.--plane-color]="planeColor()"
      >
        <header class="tile-head">
          <span class="eyebrow">{{ v.label }}</span>
          <span class="prov" [attr.data-prov]="v.provenanceType" [title]="provTitle()">
            <span class="prov-dot"></span>{{ provLabel() }}
          </span>
        </header>

        @if (isUnavailable()) {
          <!-- Genuinely unsourced (refreshStatus 'missing'): show the gap, not a
               fake number. 'seeded' metrics keep their illustrative value above. -->
          <div class="tile-value unavailable" aria-label="Unavailable">—</div>
          <p class="gap-note"><span class="gap-tag">Unavailable</span>{{ gap() }}</p>
        } @else {
          <div class="tile-value tnum" [ecCountUp]="v.value" [unit]="v.unit" [delayMs]="delayMs"></div>

          <div class="tile-foot">
            <div class="trend" [attr.data-dir]="trendKind()">
              @if (v.trendPercent !== undefined) {
                <span class="arrow">{{ arrow() }}</span>
                <span class="tnum">{{ trendText() }}</span>
                <span class="trend-cap">{{ trendBasis() }}</span>
              }
            </div>
            @if (v.spark?.length) {
              <ec-sparkline class="tile-spark" [data]="v.spark!" [color]="lineColor()" [w]="116" [h]="32" />
            }
          </div>
        }

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
  // D16: the provenance plane the user is highlighting (null = show all equally).
  // This tile lights when it matches and dims when it doesn't — the "re-skin".
  @Input() set activePlane(p: ProvenanceType | null) { this._plane.set(p); }
  private readonly _v = signal<VitalSign | null>(null);
  private readonly _plane = signal<ProvenanceType | null>(null);
  readonly vital = this._v;

  readonly planeState = computed<'lit' | 'dim' | 'off'>(() => {
    const plane = this._plane();
    if (plane === null) return 'off';
    return this._v()!.provenanceType === plane ? 'lit' : 'dim';
  });

  // When lit, the tile glows in its own provenance colour (= the active plane).
  readonly planeColor = computed(() =>
    this.planeState() === 'lit' ? `var(--prov-${this._v()!.provenanceType})` : 'transparent',
  );

  // Higher-is-better for all hero metrics EXCEPT these (up = bad).
  private static readonly LOWER_IS_BETTER = new Set(['territories_at_risk', 'no_show_rate']);

  // Integration graft: when a metric is GENUINELY unsourced — refreshStatus
  // 'missing', or a null/NaN value from a live response — the tile must not render
  // an illustrative number. It degrades to a dashed 'Unavailable' + the gap note
  // (exactly what has to be wired). 'seeded' is NOT unavailable: it keeps its
  // labelled illustrative value (the demo's full-looking number). The gap copy is
  // a Charlie-side presentation aid keyed by metricKey (no CONTRACT §2 change).
  private static readonly GAP_BY_KEY: Record<string, string> = {
    system_revenue_ltm: 'Requires completed_job.invoiceAmount (OLTP field not yet wired)',
    royalty_revenue_ltm: 'Requires completed_job.invoiceAmount + territory.royalty_rate',
    royalty_collection_rate: 'Requires royalty invoicing + payment reporting',
    same_territory_growth_yoy: 'Requires ≥12 months of completed_job.invoiceAmount history',
  };

  readonly isUnavailable = computed(() => {
    const v = this._v();
    if (!v) return false;
    const value = v.value as number | null | undefined;
    return v.refreshStatus === 'missing' || value === null || value === undefined || Number.isNaN(value as number);
  });

  readonly gap = computed(
    () => KpiTileComponent.GAP_BY_KEY[this._v()!.metricKey] ?? 'Source not yet wired for this metric.',
  );

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

  // The delta's comparison basis. Default is YoY (vs the same period last year);
  // a metric whose VALUE is already a YoY rate must name a different reference so
  // the delta isn't a restatement of the value. Charlie-side presentation aid keyed
  // by metricKey — no CONTRACT §2 change.
  private static readonly TREND_BASIS: Record<string, string> = {
    same_territory_growth_yoy: 'vs 5.0% plan',
  };
  readonly trendBasis = computed(
    () => KpiTileComponent.TREND_BASIS[this._v()!.metricKey] ?? 'YoY',
  );

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
