import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CorporateApiService } from './corporate-api.service';
import { KpiGridComponent } from './components/kpi-grid.component';
import { KpiCardVm } from './components/kpi-card.component';
import { HeroVm, Metric } from '../models';
import {
  formatCurrencyCompact,
  formatInteger,
  formatNps,
  formatPercent,
  formatSignedPercent,
} from './utils/number-format.util';

// View 1 — Portfolio. Smart container: fetches the hero snapshot, maps it to
// presentational card VMs, and owns loading/error state. Proves two things the
// rest of the dashboard depends on: the provenance treatment (measured 'actual'
// tiles vs. financial 'unavailable' tiles with a gap note) and the read-down
// auth scope (CorporateApiService, not the franchisee-scoped ApiService).
@Component({
  selector: 'app-portfolio-page',
  imports: [KpiGridComponent],
  template: `
    <div class="page">
      <header class="head">
        <div>
          <h1>Executive Dashboard</h1>
          <p class="sub">HFC portfolio — network health, growth, and risk across all brands.</p>
        </div>
        <div class="meta">
          <span class="period">{{ periodLabel() }}</span>
          @if (hero(); as h) {
            <span class="asof">Updated {{ asOf(h.lastUpdated) }} · {{ h.metricVersion }}</span>
          }
        </div>
      </header>

      @if (error()) {
        <div class="banner error" role="alert">
          <div>
            <strong>Unable to load portfolio metrics.</strong>
            <span>The read model didn’t respond. Check the corporate API and try again.</span>
          </div>
          <button class="btn" (click)="load()">Retry</button>
        </div>
      }

      <app-kpi-grid [cards]="cards()" [loading]="loading()" />

      <p class="footnote">
        Measured metrics are app-native and near-real-time. Financial metrics are
        <strong>unavailable</strong> until completed-job revenue and territory royalty rates are
        integrated — shown honestly rather than substituted with deposits or estimates.
      </p>
    </div>
  `,
  styles: [
    `
      .page { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
      .head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 1rem;
        border-bottom: 1px solid #e3e8ef;
        padding-bottom: 1rem;
        margin-bottom: 1.25rem;
        flex-wrap: wrap;
      }
      h1 { margin: 0; font-size: 1.5rem; letter-spacing: -0.5px; color: #14202e; }
      .sub { margin: 0.25rem 0 0; color: #6b7a8d; font-size: 0.9rem; }
      .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 0.2rem; }
      .period {
        font-size: 0.8rem; font-weight: 700; color: #1f6feb;
        background: #e7eefc; border-radius: 999px; padding: 0.15rem 0.6rem;
      }
      .asof { font-size: 0.75rem; color: #97a4b4; }
      .banner {
        display: flex; align-items: center; justify-content: space-between; gap: 1rem;
        margin-bottom: 1rem; padding: 0.8rem 1rem; border-radius: 8px; font-size: 0.9rem;
        background: #fdecec; color: #b3261e;
      }
      .banner span { display: block; font-weight: 400; margin-top: 0.15rem; }
      .btn {
        border: 1px solid #b3261e; background: #b3261e; color: #fff;
        border-radius: 7px; padding: 0.4rem 0.9rem; font-size: 0.85rem; cursor: pointer;
        white-space: nowrap;
      }
      .footnote {
        margin-top: 1.5rem; font-size: 0.8rem; color: #97a4b4; line-height: 1.5;
        border-top: 1px dashed #e3e8ef; padding-top: 1rem;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioPageComponent implements OnInit {
  private api = inject(CorporateApiService);

  readonly hero = signal<HeroVm | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);

  readonly periodLabel = computed(() => {
    const h = this.hero();
    return h ? `${h.period.type} · ${h.period.start} → ${h.period.end}` : 'QTD';
  });

  readonly cards = computed<KpiCardVm[]>(() => {
    const h = this.hero();
    if (!h) return [];
    const m = h.metrics;
    return [
      this.measured('activeTerritories', 'Active territories', m.activeTerritories, formatInteger, true, 'last quarter'),
      this.measured('atRiskTerritories', 'At-risk territories', m.atRiskTerritories, formatInteger, false, 'last quarter'),
      this.measured('networkNps', 'Network NPS', m.networkNps, formatNps, true, 'last quarter'),
      this.measured('newFranchiseSales', 'New franchise sales', m.newFranchiseSales, formatInteger, true, 'last quarter'),
      this.financial('grossSales', 'System-wide gross sales', m.grossSales, formatCurrencyCompact),
      this.financial('royaltyRevenue', 'Royalty revenue', m.royaltyRevenue, formatCurrencyCompact),
      this.financial('sameTerritoryGrowth', 'Same-territory growth', m.sameTerritoryGrowth, formatPercent),
      this.financial('collectionRate', 'Royalty collection rate', m.collectionRate, formatPercent),
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set(false);
    this.loading.set(true);
    this.api.getHero('QTD').subscribe({
      next: (h) => {
        this.hero.set(h);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  asOf(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Measured tile: real value, delta drives the status color.
  private measured(
    id: string,
    label: string,
    metric: Metric,
    fmt: (v: number | null) => string,
    higherIsGood: boolean,
    periodWord: string,
  ): KpiCardVm {
    const d = metric.deltaPercent ?? null;
    let status: KpiCardVm['status'] = 'neutral';
    if (d !== null && d !== 0) {
      const improving = higherIsGood ? d > 0 : d < 0;
      status = improving ? 'good' : 'bad';
    }
    return {
      id,
      label,
      displayValue: fmt(metric.value),
      deltaLabel: d === null ? null : `${formatSignedPercent(d)} vs ${periodWord}`,
      status,
      dataQuality: metric.dataQuality,
      trend: metric.sparkline ?? null,
    };
  }

  // Financial tile: unwired in v1 — render the 'unavailable' state + gap note.
  private financial(id: string, label: string, metric: Metric, fmt: (v: number | null) => string): KpiCardVm {
    const unavailable = metric.dataQuality === 'unavailable' || metric.value === null;
    return {
      id,
      label,
      displayValue: fmt(metric.value),
      status: unavailable ? 'unavailable' : 'neutral',
      dataQuality: metric.dataQuality,
      helperText: unavailable ? metric.gap ?? null : null,
    };
  }
}
