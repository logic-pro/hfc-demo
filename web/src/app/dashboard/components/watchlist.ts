import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { WatchlistFlag } from '../dashboard.models';

type SevFilter = 'all' | 'high' | 'medium';

const FLAG_LABEL: Record<string, string> = {
  nps_below_threshold: 'NPS below threshold',
  no_show_spike: 'No-show spike',
  pending_financial_reporting: 'Financial reporting pending',
  revenue_deterioration: 'Revenue deterioration',
};

const CATEGORY_LABEL: Record<string, string> = {
  customer: 'Customer',
  financial: 'Financial',
  growth: 'Growth',
  compliance: 'Compliance',
};

// D15 — the watchlist action queue. The franchisor's "what needs intervention
// now" list: every open flag (CONTRACT §4 rules), severity-sorted so the highest-
// urgency work is first. Here the meaningful colour is SEVERITY, not brand — the
// rail and chips encode urgency on the shared red/amber language, brand stays a
// quiet tag so the eye triages by risk. A severity filter triages further; each
// row drills to the same territory scorecard the map and distribution open, so the
// whole dashboard converges on one explainable-score surface. Financial-pending is
// itself a flag — the missing royalty cycle is surfaced as work, never hidden.
@Component({
  selector: 'ec-watchlist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <section class="card wl-card">
      <header class="wl-head">
        <div class="wl-title">
          <span class="eyebrow">Watchlist · Action Queue</span>
          <h2>Where intervention is needed now</h2>
        </div>
        <div class="wl-sum">
          <span class="sum-badge" data-sev="high">{{ counts().high }} high</span>
          <span class="sum-badge" data-sev="medium">{{ counts().medium }} medium</span>
          <span class="sum-terr">across {{ territoryCount() }} territories</span>
        </div>
      </header>

      <div class="wl-filter" role="group" aria-label="Filter by severity">
        <button class="wf-btn" [class.on]="sev() === 'all'" (click)="setSev('all')">
          All <span class="wf-n tnum">{{ total() }}</span>
        </button>
        <button class="wf-btn" data-sev="high" [class.on]="sev() === 'high'" (click)="setSev('high')">
          High <span class="wf-n tnum">{{ counts().high }}</span>
        </button>
        <button class="wf-btn" data-sev="medium" [class.on]="sev() === 'medium'" (click)="setSev('medium')">
          Medium <span class="wf-n tnum">{{ counts().medium }}</span>
        </button>
      </div>

      @if (loading) {
        <ul class="wl-list">
          @for (s of skeletons; track $index) {
            <li class="wl-row sk" aria-hidden="true">
              <span class="wl-rail"></span>
              <div class="wl-main"><span class="sk-line w50"></span><span class="sk-line w30"></span></div>
            </li>
          }
        </ul>
      } @else if (rows().length) {
        <ul class="wl-list">
          @for (f of rows(); track f.watchlistFlagId) {
            <li
              class="wl-row"
              [attr.data-sev]="f.severity"
              (click)="select.emit(f.territoryId)"
              (keydown.enter)="select.emit(f.territoryId)"
              tabindex="0"
              role="button"
              [attr.aria-label]="flagLabel(f.flagKey) + ' at ' + f.territoryName + ' — open scorecard'"
            >
              <span class="wl-rail"></span>
              <div class="wl-main">
                <div class="wl-l1">
                  <span class="wl-flag">{{ flagLabel(f.flagKey) }}</span>
                  <span class="wl-cat">{{ catLabel(f.category) }}</span>
                </div>
                <div class="wl-l2">
                  <span class="wl-terr">{{ f.territoryName }}</span>
                  <span class="wl-dot" aria-hidden="true">·</span>
                  <span class="wl-brand">{{ f.brandName }}</span>
                  <span class="wl-region">{{ f.regionName }}</span>
                </div>
                <p class="wl-why">{{ f.explanation }}</p>
              </div>
              <div class="wl-right">
                @if (gauge(f); as g) {
                  <span class="wl-metric tnum">
                    <span class="m-cur">{{ g.cur }}</span>
                    <span class="m-vs">vs {{ g.thr }}</span>
                  </span>
                } @else {
                  <span class="wl-metric none">awaiting</span>
                }
                <span class="wl-time tnum">{{ f.detectedAt | date: 'MMM d · HH:mm' }}</span>
              </div>
              <span class="wl-go" aria-hidden="true">→</span>
            </li>
          }
        </ul>
      } @else {
        <p class="wl-empty">
          No {{ sev() === 'all' ? '' : sev() + ' ' }}flags open — the network is clear for this filter.
        </p>
      }
    </section>
  `,
  styleUrl: './watchlist.css',
})
export class WatchlistComponent {
  @Input({ required: true }) set flags(v: WatchlistFlag[]) { this._flags.set(v ?? []); }
  @Input() loading = false;
  @Output() select = new EventEmitter<number>();

  private readonly _flags = signal<WatchlistFlag[]>([]);
  readonly sev = signal<SevFilter>('all');
  readonly skeletons = Array.from({ length: 4 });

  private static readonly SEV_RANK = { high: 0, medium: 1, low: 2 } as const;

  readonly counts = computed(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const f of this._flags()) c[f.severity]++;
    return c;
  });
  readonly total = computed(() => this._flags().length);

  // Filtered + severity-sorted (then most-below-threshold first within a severity).
  readonly rows = computed<WatchlistFlag[]>(() => {
    const s = this.sev();
    const list = s === 'all' ? this._flags() : this._flags().filter((f) => f.severity === s);
    return [...list].sort((a, b) => {
      const r = WatchlistComponent.SEV_RANK[a.severity] - WatchlistComponent.SEV_RANK[b.severity];
      return r !== 0 ? r : this.gap(b) - this.gap(a);
    });
  });

  readonly territoryCount = computed(() => new Set(this.rows().map((f) => f.territoryId)).size);

  // How far past threshold a flag sits, normalized so severities compare sanely.
  private gap(f: WatchlistFlag): number {
    if (!f.thresholdValue) return 0;
    return Math.abs(f.currentValue - f.thresholdValue) / Math.abs(f.thresholdValue);
  }

  setSev(s: SevFilter): void { this.sev.set(s); }

  flagLabel(key: string): string { return FLAG_LABEL[key] ?? key; }
  catLabel(cat: string): string { return CATEGORY_LABEL[cat] ?? cat; }

  // Current-vs-threshold readout, formatted to the metric. Pending-financial has no
  // honest number to show (that's the point) → null renders as "awaiting".
  gauge(f: WatchlistFlag): { cur: string; thr: string } | null {
    switch (f.flagKey) {
      case 'no_show_spike':
        return { cur: this.pct(f.currentValue), thr: this.pct(f.thresholdValue) };
      case 'pending_financial_reporting':
        return null;
      default:
        return { cur: String(f.currentValue), thr: String(f.thresholdValue) };
    }
  }

  private pct(v: number): string { return `${Math.round(v * 100)}%`; }
}
