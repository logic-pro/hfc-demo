import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { Driver, SubScoreKey, TerritoryHealthScore } from '../dashboard.models';
import { RadialGaugeComponent } from '../ui/radial-gauge';
import { PROVENANCE_LABEL, band, healthVar } from '../ui/health';

interface SubBar { key: SubScoreKey; label: string; value: number | null; }

// D14 — the "explainable score" reveal. A territory's composite as an animated
// radial gauge, the four sub-scores as health-colored bars (financial may be
// pending — shown honestly, never fabricated), and the top ± drivers with their
// provenance. Slides in as a drawer when a territory is selected on the map/table.
@Component({
  selector: 'ec-scorecard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RadialGaugeComponent],
  template: `
    <div class="scrim" [class.open]="open" (click)="close.emit()"></div>
    <aside class="drawer" [class.open]="open" role="dialog" aria-label="Territory scorecard" aria-modal="true">
      @if (loading) {
        <div class="sc-loading">
          <div class="sk-circle"></div>
          <div class="sk-line w60"></div>
          <div class="sk-line w40"></div>
        </div>
      } @else if (score(); as s) {
        <header class="sc-head">
          <div class="sc-id">
            <span class="eyebrow">Territory Scorecard</span>
            <h2>{{ s.territoryName }}</h2>
            <div class="sc-sub">
              <span>{{ s.brandName }}</span><span class="sep">·</span><span>{{ s.regionName }}</span>
            </div>
          </div>
          <button class="sc-close" (click)="close.emit()" aria-label="Close scorecard">✕</button>
        </header>

        <!-- Composite gauge -->
        <section class="sc-gauge">
          <ec-radial-gauge [value]="s.scores.composite" [size]="176" [sublabel]="'Composite'" />
          <div class="sc-status" [attr.data-status]="s.scoreStatus">
            <span class="status-dot"></span>
            {{ statusLabel(s.scoreStatus) }}
          </div>
          <div class="sc-version">{{ s.scoreVersion.scoreVersionId }} · {{ s.scoreVersion.ownerTeam }}</div>
        </section>

        <!-- Sub-score bars -->
        <section class="sc-bars">
          @for (b of bars(); track b.key) {
            <div class="bar-row" [class.pending]="b.value === null">
              <div class="bar-top">
                <span class="bar-label">{{ b.label }}</span>
                @if (b.value === null) {
                  <span class="bar-pending">pending</span>
                } @else {
                  <span class="bar-val tnum">{{ b.value }}</span>
                }
              </div>
              <div class="bar-track">
                @if (b.value !== null) {
                  <div class="bar-fill" [style.width.%]="b.value" [style.background]="healthVar(b.value)"></div>
                } @else {
                  <div class="bar-fill pending-fill"></div>
                }
              </div>
            </div>
          }
        </section>

        <!-- Score notes -->
        @if (s.scoreNotes.length) {
          <section class="sc-notes">
            @for (n of s.scoreNotes; track n.message) {
              <div class="sc-note" [attr.data-type]="n.type">{{ n.message }}</div>
            }
          </section>
        }

        <!-- Drivers -->
        <section class="sc-drivers">
          <span class="eyebrow">Top drivers</span>
          @for (d of score()!.drivers; track d.metricKey) {
            <div class="driver" [attr.data-impact]="d.impact">
              <div class="dr-arrow">{{ d.impact === 'positive' ? '▲' : '▼' }}</div>
              <div class="dr-body">
                <div class="dr-top">
                  <span class="dr-label">{{ d.label }}</span>
                  <span class="dr-sev" [attr.data-sev]="d.severity">{{ d.severity }}</span>
                </div>
                <div class="dr-meta">
                  <span class="dr-val tnum">{{ fmt(d) }}</span>
                  <span class="dr-bench tnum">vs {{ fmtBench(d) }} benchmark</span>
                  <span class="dr-prov" [attr.data-prov]="d.provenanceType">{{ prov(d) }}</span>
                </div>
              </div>
            </div>
          }
        </section>
      } @else {
        <div class="sc-empty"><p>No scorecard for this territory.</p></div>
      }
    </aside>
  `,
  styleUrl: './scorecard.css',
})
export class ScorecardComponent {
  @Input() set data(v: TerritoryHealthScore | null) { this._score.set(v); }
  @Input() loading = false;
  @Input() open = false;
  @Output() close = new EventEmitter<void>();

  private readonly _score = signal<TerritoryHealthScore | null>(null);
  readonly score = this._score;

  readonly bars = computed<SubBar[]>(() => {
    const s = this._score();
    if (!s) return [];
    return [
      { key: 'financial', label: 'Financial', value: s.scores.financial },
      { key: 'customer', label: 'Customer', value: s.scores.customer },
      { key: 'growth', label: 'Growth', value: s.scores.growth },
      { key: 'compliance', label: 'Compliance', value: s.scores.compliance },
    ];
  });

  healthVar(v: number): string { return healthVar(v); }
  band(v: number): string { return band(v); }

  statusLabel(s: string): string {
    return s === 'complete' ? 'Score complete'
      : s === 'partial' ? 'Partial — some inputs pending'
        : 'Financial reporting pending';
  }

  // Drivers carry heterogeneous units — format by metric shape.
  fmt(d: Driver): string { return this.fmtValue(d.metricKey, d.value); }
  fmtBench(d: Driver): string { return this.fmtValue(d.metricKey, d.benchmark); }
  private fmtValue(key: string, v: number): string {
    if (key.includes('rate')) return `${(v * 100).toFixed(0)}%`;
    if (key === 'nps_score') return Math.round(v).toString();
    return Math.round(v).toString();
  }
  prov(d: Driver): string { return PROVENANCE_LABEL[d.provenanceType]; }
}
