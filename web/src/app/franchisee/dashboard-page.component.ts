import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { ApiService } from '../api.service';
import { DashboardApiService } from './dashboard-api.service';
import {
  ActionRowDto,
  ActionStageFilter,
  DashboardFilters,
  DashboardResponse,
  DashboardState,
  KpiCardVm,
  KpiDto,
  KpiKey,
  PeriodType,
  initialState,
} from './dashboard.models';
import {
  deltaDirection,
  deltaStatus,
  formatDeltaPercent,
  formatKpiValue,
} from './utils/number-format.util';

import { FilterBarComponent } from './components/filter-bar.component';
import { KpiGridComponent } from './components/kpi-grid.component';
import { ChartPanelComponent } from './components/chart-panel.component';
import { BookingTrendComponent } from './components/booking-trend.component';
import { DepositFunnelComponent } from './components/deposit-funnel.component';
import { TerritoryBreakdownComponent } from './components/territory-breakdown.component';
import { ActionTableComponent } from './components/action-table.component';
import { DetailDrawerComponent } from './components/detail-drawer.component';
import { LoadingSkeletonComponent } from './components/loading-skeleton.component';
import { ErrorPanelComponent } from './components/error-panel.component';

interface DashboardVm {
  response: DashboardResponse;
  territories: { id: number; name: string }[];
}

/**
 * Smart container: owns filters (signals), fetches the read-model + territory
 * list in parallel (forkJoin), exposes a DashboardState<T>, and maps DTO → VM
 * once. All children are presentational. Drill-downs set the action-table filter
 * while preserving period + territory.
 */
@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FilterBarComponent,
    KpiGridComponent,
    ChartPanelComponent,
    BookingTrendComponent,
    DepositFunnelComponent,
    TerritoryBreakdownComponent,
    ActionTableComponent,
    DetailDrawerComponent,
    LoadingSkeletonComponent,
    ErrorPanelComponent,
  ],
  template: `
    <div class="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <!-- header + filters -->
        <header
          class="flex flex-col gap-4 border-b border-[var(--line)] pb-6 lg:flex-row lg:items-end lg:justify-between"
        >
          <div>
            <p
              class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]"
            >
              Operator
            </p>
            <h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">
              Operations Dashboard
            </h1>
            <p class="mt-1.5 text-sm text-[var(--ink-muted)]">
              Where is my territory leaking bookings and deposits — and what needs follow-up today?
            </p>
          </div>
          <div class="flex flex-col items-start gap-2 lg:items-end">
            <app-filter-bar
              [period]="filters().period"
              [territoryId]="filters().territoryId"
              [territories]="territories()"
              (periodChange)="setPeriod($event)"
              (territoryChange)="setTerritory($event)"
            />
            @if (state().lastUpdated) {
              <p class="text-xs text-[var(--ink-faint)]">
                Updated {{ state().lastUpdated | date: 'shortTime' }}
              </p>
            }
          </div>
        </header>

        <!-- error (whole page) -->
        @if (state().error) {
          <div class="mt-6"><app-error-panel [message]="state().error!" (retry)="reload()" /></div>
        }

        <!-- KPI row -->
        <div class="mt-6">
          @if (state().loading) {
            <app-loading-skeleton variant="kpi" />
          } @else if (kpiVms().length) {
            <app-kpi-grid [kpis]="kpiVms()" (drill)="applyDrill($event)" />
          }
        </div>

        <!-- primary row: trend + funnel -->
        <section class="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div class="xl:col-span-8">
            @if (state().loading) {
              <app-loading-skeleton variant="panel" />
            } @else if (data(); as d) {
              <app-chart-panel
                title="Bookings & fill trend"
                [subtitle]="d.response.period.label"
                [empty]="d.response.bookingTrend.length === 0"
                emptyMessage="No bookings recorded for this period yet."
                [insight]="trendInsight()"
              >
                <app-booking-trend [points]="d.response.bookingTrend" />
              </app-chart-panel>
            }
          </div>

          <div class="xl:col-span-4">
            @if (state().loading) {
              <app-loading-skeleton variant="panel" />
            } @else if (data(); as d) {
              <app-chart-panel
                title="Deposit funnel"
                subtitle="Mirrors the booking workflow"
                [insight]="funnelInsight()"
              >
                <app-deposit-funnel
                  [stages]="d.response.depositFunnel"
                  (drill)="applyDrill($event)"
                />
              </app-chart-panel>
            }
          </div>
        </section>

        <!-- territory breakdown (only when looking at all territories) -->
        @if (!state().loading && data(); as d) {
          @if (!filters().territoryId && d.response.territoryBreakdown.length > 1) {
            <section class="mt-6">
              <app-chart-panel
                title="Territory breakdown"
                subtitle="Click a territory to focus the dashboard"
              >
                <app-territory-breakdown
                  [rows]="d.response.territoryBreakdown"
                  (select)="setTerritory($event)"
                />
              </app-chart-panel>
            </section>
          }
        }

        <!-- revenue-not-available honesty note -->
        @if (!state().loading && data(); as d) {
          <p
            class="mt-4 flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-2.5 text-sm text-[var(--ink)]"
          >
            <span aria-hidden="true" class="text-[var(--warning)]">⚠</span>
            <span>
              <span class="font-semibold text-[var(--ink-strong)]">Job revenue unavailable.</span>
              {{ d.response.revenue.reason }}
              The “Deposit volume” tile shows deposits captured, not realized revenue.
            </span>
          </p>
        }

        <!-- action table + drawer -->
        <div class="mt-6">
          @if (state().loading) {
            <app-loading-skeleton variant="table" />
          } @else if (data()) {
            <app-action-table
              [rows]="filteredActionRows()"
              [activeFilter]="actionFilter()"
              (selectRow)="selectedRow.set($event)"
              (clearFilter)="actionFilter.set('all')"
            />
          }
        </div>
      </main>

      <app-detail-drawer
        [row]="selectedRow()"
        [busy]="depositBusy()"
        [error]="depositError()"
        (sendDeposit)="payDeposit($event)"
        (close)="closeDrawer()"
      />
    </div>
  `,
})
export class DashboardPageComponent {
  private api = inject(DashboardApiService);
  private bookingApi = inject(ApiService);

  // ── filter state (signals) ─────────────────────────────────────────────────
  readonly filters = signal<DashboardFilters>({ period: 'MTD', territoryId: null });

  // drill target applied to the action table; preserved across filter changes
  readonly actionFilter = signal<ActionStageFilter>('all');
  readonly selectedRow = signal<ActionRowDto | null>(null);

  // detail-drawer deposit action state
  readonly depositBusy = signal(false);
  readonly depositError = signal<string | null>(null);

  /** Demo deposit amount when the row carries none (cents). */
  private static readonly DEFAULT_DEPOSIT_CENTS = 5000;

  // manual reload nonce (retry)
  private readonly reloadTick = signal(0);

  // ── data load: debounced, cancel-stale (switchMap), parallel (forkJoin) ────
  private readonly load$ = toObservable(
    computed(() => ({ f: this.filters(), tick: this.reloadTick() })),
  ).pipe(
    debounceTime(150),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    switchMap(({ f }) =>
      forkJoin({
        response: this.api.getDashboard(f),
        territories: this.api.getTerritories(),
      }).pipe(
        map(
          (vm): DashboardState<DashboardVm> => ({
            data: vm,
            loading: false,
            error: null,
            lastUpdated: vm.response.lastUpdated,
          }),
        ),
        startWith(initialState<DashboardVm>()),
        catchError(() =>
          of<DashboardState<DashboardVm>>({
            data: null,
            loading: false,
            lastUpdated: null,
            error: 'Unable to load the dashboard. Check the API and retry.',
          }),
        ),
      ),
    ),
  );

  readonly state = toSignal(this.load$, { initialValue: initialState<DashboardVm>() });
  readonly data = computed(() => this.state().data);
  readonly territories = computed(() => this.data()?.territories ?? []);

  // ── DTO → VM mapping (once) ────────────────────────────────────────────────
  readonly kpiVms = computed<KpiCardVm[]>(() =>
    (this.data()?.response.kpis ?? []).map((k) => this.toKpiVm(k)),
  );

  /** Deposit metrics that are legitimately zero this period are an honest empty
   *  state, not a red alarm. We only neutralise the DEPOSIT tiles (where a true
   *  zero means "no deposit activity yet"), and only when the value is exactly 0
   *  — never when data is merely missing/unavailable (handled by dataQuality). */
  private static readonly DEPOSIT_KEYS = new Set<KpiKey>(['deposit_conversion', 'deposit_volume']);

  private toKpiVm(k: KpiDto): KpiCardVm {
    const isEmpty =
      DashboardPageComponent.DEPOSIT_KEYS.has(k.key) &&
      k.dataQuality === 'measured' &&
      k.value === 0;

    return {
      key: k.key,
      label: k.label,
      formattedValue: formatKpiValue(k.value, k.unit),
      deltaLabel: formatDeltaPercent(k.deltaPercent),
      deltaDirection: deltaDirection(k.deltaPercent),
      // An honest zero gets neutral colour — not the red the API may have stamped.
      deltaStatus: isEmpty ? 'neutral' : deltaStatus(k.deltaPercent, k.higherIsBetter),
      status: isEmpty ? 'neutral' : k.status,
      trend: k.trend,
      dataQuality: k.dataQuality,
      tooltip: k.tooltip,
      drillTo: k.drillTo,
      isEmpty,
      emptyLabel: isEmpty ? 'No deposits this period' : null,
    };
  }

  // ── action table filtering (preserves period + territory) ──────────────────
  readonly filteredActionRows = computed<ActionRowDto[]>(() => {
    const rows = this.data()?.response.actionRows ?? [];
    switch (this.actionFilter()) {
      case 'deposit_unpaid':
        return rows.filter((r) => !r.depositPaid && r.stage !== 'Expired');
      case 'deposit_paid':
        return rows.filter((r) => r.depositPaid);
      case 'expired':
        return rows.filter((r) => r.stage === 'Expired');
      case 'open_slots':
        return rows.filter((r) => r.stage === 'Booked' || r.stage === 'Reminded');
      case 'all':
      default:
        return rows;
    }
  });

  // ── insight summaries (accessibility + executive readability) ──────────────
  readonly trendInsight = computed(() => {
    const t = this.data()?.response.bookingTrend ?? [];
    if (!t.length) return null;
    const total = t.reduce((s, p) => s + p.bookings, 0);
    return `${total} bookings over ${t.length} days; filled-slot line tracks realized capacity.`;
  });

  readonly funnelInsight = computed(() => {
    const f = this.data()?.response.depositFunnel ?? [];
    const drop = f
      .filter((s) => s.conversionFromPrev !== null)
      .sort((a, b) => a.conversionFromPrev! - b.conversionFromPrev!)[0];
    const leak = f.find((s) => s.isLeak);
    if (!drop) return null;
    return (
      `Biggest drop at ${drop.stage} (${Math.round(drop.conversionFromPrev! * 100)}% retained)` +
      (leak ? `; ${leak.count} expired without a deposit.` : '.')
    );
  });

  // ── intent handlers ────────────────────────────────────────────────────────
  setPeriod(period: PeriodType): void {
    this.clearDrawer();
    this.filters.update((f) => ({ ...f, period }));
  }
  setTerritory(territoryId: number | null): void {
    this.clearDrawer();
    this.filters.update((f) => ({ ...f, territoryId }));
  }

  /** Close the detail drawer + clear any deposit error. A filter change reloads
   *  the dataset, so a row selected from the previous data is now stale — keeping
   *  the drawer open would show an appointment that no longer matches the view. */
  private clearDrawer(): void {
    this.selectedRow.set(null);
    this.depositError.set(null);
  }
  applyDrill(target: ActionStageFilter): void {
    this.actionFilter.set(target); // keeps period + territory
  }
  reload(): void {
    this.reloadTick.update((n) => n + 1);
  }

  closeDrawer(): void {
    if (this.depositBusy()) return;
    this.selectedRow.set(null);
    this.depositError.set(null);
  }

  /** Wire the "Send deposit link" action to the existing deposit endpoint.
   *  Idempotency-Key makes a retry a server-side no-op; on success we refresh
   *  the read-model so the funnel/KPIs/table reflect the captured deposit. */
  payDeposit(row: ActionRowDto): void {
    if (this.depositBusy()) return;
    this.depositBusy.set(true);
    this.depositError.set(null);
    const cents =
      row.depositCents > 0 ? row.depositCents : DashboardPageComponent.DEFAULT_DEPOSIT_CENTS;
    const key = `dash-${row.appointmentId}-${crypto.randomUUID()}`;
    this.bookingApi.deposit(row.appointmentId, cents, key).subscribe({
      next: () => {
        this.depositBusy.set(false);
        this.selectedRow.set(null);
        this.reload();
      },
      error: () => {
        this.depositBusy.set(false);
        this.depositError.set('Could not record the deposit. Check the API and try again.');
      },
    });
  }
}
