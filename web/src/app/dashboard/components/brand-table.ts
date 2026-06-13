import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal,
} from '@angular/core';
import { Archetype, BrandComparisonRow } from '../dashboard.models';
import { healthColor, healthVar } from '../ui/health';
import { brandAccent } from '../ui/brand';

type SortKey = 'composite' | 'customer' | 'growth' | 'compliance' | 'watchlist' | 'territories';

const ARCHETYPE_LABEL: Record<Archetype, string> = {
  project_installation: 'Project install',
  recurring_service: 'Recurring service',
  on_demand_dispatch: 'On-demand dispatch',
};

// D13 (right) — the franchisor's portfolio comparison. Three brands ranked by
// composite health, sub-scores shown as health-colored bars (financial is honestly
// "pending" — never fabricated, CONTRACT §3), watchlist load and the lead issue.
// Sortable columns; clicking a brand row drills — it filters the distribution
// histogram beside it to that brand. The composite color is the ONLY color that
// means health; the brand swatch means identity.
@Component({
  selector: 'ec-brand-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card bt-card">
      <header class="bt-head">
        <div class="bt-title">
          <span class="eyebrow">Brand Comparison · Portfolio</span>
          <h2>Which brand earns the next dollar?</h2>
        </div>
        <span class="bt-hint">Click a brand to filter the distribution →</span>
      </header>

      <div class="bt-scroll">
        <table class="bt">
          <thead>
            <tr>
              <th class="c-rank">#</th>
              <th class="c-brand">Brand</th>
              <th class="c-num sortable" [class.on]="sortKey() === 'territories'" (click)="sort('territories')">
                Terr.{{ caret('territories') }}
              </th>
              <th class="c-metric sortable" [class.on]="sortKey() === 'composite'" (click)="sort('composite')">
                Composite{{ caret('composite') }}
              </th>
              <th class="c-metric sortable" [class.on]="sortKey() === 'customer'" (click)="sort('customer')">
                Customer{{ caret('customer') }}
              </th>
              <th class="c-metric sortable" [class.on]="sortKey() === 'growth'" (click)="sort('growth')">
                Growth{{ caret('growth') }}
              </th>
              <th class="c-metric sortable" [class.on]="sortKey() === 'compliance'" (click)="sort('compliance')">
                Compliance{{ caret('compliance') }}
              </th>
              <th class="c-fin">Financial</th>
              <th class="c-num sortable" [class.on]="sortKey() === 'watchlist'" (click)="sort('watchlist')">
                Flags{{ caret('watchlist') }}
              </th>
              <th class="c-issue">Top issue</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.brandId; let i = $index) {
              <tr
                class="bt-row"
                [class.sel]="r.brandId === selectedBrandId"
                (click)="selectBrand.emit(r.brandId)"
                (keydown.enter)="selectBrand.emit(r.brandId)"
                tabindex="0"
                role="button"
                [attr.aria-pressed]="r.brandId === selectedBrandId"
                [attr.aria-label]="'Filter distribution to ' + r.brandName"
              >
                <td class="c-rank"><span class="rank tnum">{{ i + 1 }}</span></td>
                <td class="c-brand">
                  <span class="b-swatch" [style.background]="accent(r.brandId)"></span>
                  <span class="b-id">
                    <span class="b-name">{{ r.brandName }}</span>
                    <span class="b-arch">{{ archetype(r.archetype) }}</span>
                  </span>
                </td>
                <td class="c-num tnum">{{ r.territoryCount }}</td>

                <td class="c-metric">
                  <div class="m-cell">
                    <span class="m-val tnum" [style.color]="hColor(r.compositeHealthScore)">{{ r.compositeHealthScore }}</span>
                    <span class="m-track"><span class="m-fill" [style.width.%]="r.compositeHealthScore" [style.background]="hVar(r.compositeHealthScore)"></span></span>
                  </div>
                </td>
                <td class="c-metric">
                  <div class="m-cell">
                    <span class="m-val tnum">{{ r.customerScore }}</span>
                    <span class="m-track"><span class="m-fill" [style.width.%]="r.customerScore" [style.background]="hVar(r.customerScore)"></span></span>
                  </div>
                </td>
                <td class="c-metric">
                  <div class="m-cell">
                    <span class="m-val tnum">{{ r.growthScore }}</span>
                    <span class="m-track"><span class="m-fill" [style.width.%]="r.growthScore" [style.background]="hVar(r.growthScore)"></span></span>
                  </div>
                </td>
                <td class="c-metric">
                  <div class="m-cell">
                    <span class="m-val tnum">{{ r.complianceScore }}</span>
                    <span class="m-track"><span class="m-fill" [style.width.%]="r.complianceScore" [style.background]="hVar(r.complianceScore)"></span></span>
                  </div>
                </td>

                <td class="c-fin">
                  @if (r.financialScore === null) {
                    <span class="fin-pending" title="Financial sub-score withheld until reported royalty data lands (CONTRACT §3) — never fabricated from seeds.">pending</span>
                  } @else {
                    <span class="m-val tnum">{{ r.financialScore }}</span>
                  }
                </td>

                <td class="c-num">
                  <span class="flags tnum" [attr.data-load]="flagLoad(r.watchlistCount)">{{ r.watchlistCount }}</span>
                </td>
                <td class="c-issue">
                  <span class="issue" [class.ok]="r.topIssue === 'Stable'">{{ r.topIssue }}</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <footer class="bt-foot">
        <span class="foot-note">
          Composite color encodes health; the brand swatch is identity only. Financial is withheld until reported royalty data lands — shown honestly, not seeded.
        </span>
      </footer>
    </section>
  `,
  styleUrl: './brand-table.css',
})
export class BrandTableComponent {
  @Input({ required: true }) set brands(v: BrandComparisonRow[]) { this._rows.set(v ?? []); }
  @Input() selectedBrandId: number | null = null;
  @Output() selectBrand = new EventEmitter<number>();

  private readonly _rows = signal<BrandComparisonRow[]>([]);
  readonly sortKey = signal<SortKey>('composite');
  // Health scores sort high→low (best first); watchlist flags sort high→low too
  // (heaviest load first) — both default to descending, which reads as "ranked".
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  private static readonly FIELD: Record<SortKey, (r: BrandComparisonRow) => number> = {
    composite: (r) => r.compositeHealthScore,
    customer: (r) => r.customerScore,
    growth: (r) => r.growthScore,
    compliance: (r) => r.complianceScore,
    watchlist: (r) => r.watchlistCount,
    territories: (r) => r.territoryCount,
  };

  readonly rows = computed<BrandComparisonRow[]>(() => {
    const sel = BrandTableComponent.FIELD[this.sortKey()];
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return [...this._rows()].sort((a, b) => (sel(a) - sel(b)) * dir);
  });

  sort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('desc');
    }
  }

  caret(key: SortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 'asc' ? ' ↑' : ' ↓';
  }

  flagLoad(n: number): 'none' | 'some' | 'heavy' { return n === 0 ? 'none' : n <= 2 ? 'some' : 'heavy'; }
  archetype(a: Archetype): string { return ARCHETYPE_LABEL[a]; }
  accent(id: number): string { return brandAccent(id); }
  hColor(v: number): string { return healthColor(v); }
  hVar(v: number): string { return healthVar(v); }
}
