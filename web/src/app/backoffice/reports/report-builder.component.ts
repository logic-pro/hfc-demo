import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ComingSoonComponent } from '../shared/coming-soon.component';
import { ReportChartComponent, ChartDatum } from './report-chart.component';
import { ReportsDataService } from './reports-data.service';
import {
  DimensionKey,
  FilterOption,
  MetricDef,
  ReportCatalog,
  ReportColumn,
  ReportQuery,
  ReportResult,
  SavedReport,
  PROVENANCE_LABEL,
  PROVENANCE_VAR,
  formatValue,
} from './reports.models';
import { downloadCsv, downloadXlsx, safeStem } from './excel-export.util';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Report Builder (C1 `ReportBuilderComponent`) — the back office's custom
 * reporting powerhouse. Compose a query (metrics × group-by dimension × period,
 * scoped by brand/region/territory), run it against the corporate read model,
 * and read the result as a table AND a chart. Export to CSV/XLSX client-side, or
 * save the definition to reload later.
 *
 * Honest by construction (D16): every metric carries its provenance — measured,
 * reported, or illustrative — surfaced on the picker, the column headers, the
 * chart, the run summary, and the export. A seeded placeholder never gets to look
 * like an operational fact. Design tokens only; full keyboard support; explicit
 * loading / empty / error states.
 *
 * Data flows through ReportsDataService, which mocks §C2 locally and flips to
 * alpha's live `/api/reports/*` with no shape change (the D17 seam pattern).
 */
@Component({
  selector: 'bo-report-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComingSoonComponent, ReportChartComponent],
  template: `
    <header class="border-b border-[var(--line)] pb-6">
      <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">Reports</p>
      <h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">Report Builder</h1>
      <p class="mt-1.5 max-w-prose text-sm text-[var(--ink-muted)]">
        Compose a report from the corporate read model — pick metrics, group by brand, region, or territory,
        scope the period, then run, visualise, and export. Every figure is labelled measured vs. illustrative.
      </p>
    </header>

    @if (catalogStatus() === 'loading') {
      <div class="mt-8 grid gap-6 lg:grid-cols-[20rem_1fr]" role="status" aria-live="polite">
        <div class="h-96 animate-pulse rounded-[var(--r-lg)] bg-[var(--surface-2)]"></div>
        <div class="h-96 animate-pulse rounded-[var(--r-lg)] bg-[var(--surface-2)]"></div>
        <span class="sr-only">Loading report builder…</span>
      </div>
    } @else if (catalogStatus() === 'error') {
      <div
        class="mt-8 rounded-[var(--r-lg)] border border-[var(--critical)] bg-[var(--critical-soft)] p-6"
        role="alert">
        <h2 class="text-base font-semibold text-[var(--ink-strong)]">Couldn't load the report catalog</h2>
        <p class="mt-1 text-sm text-[var(--ink-muted)]">{{ catalogError() }}</p>
        <button type="button" class="mt-3 {{ btnPrimary }}" (click)="loadCatalog()">Retry</button>
      </div>
    } @else if (catalog(); as cat) {
      <div class="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
        <!-- ───────────────────────── Config panel ───────────────────────── -->
        <form
          class="flex flex-col gap-5 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)]
                 p-5 shadow-[var(--shadow-card)] lg:sticky lg:top-4"
          (submit)="run($event)">
          <!-- Metrics -->
          <fieldset class="border-0 p-0">
            <legend class="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase
                           tracking-[0.1em] text-[var(--ink-muted)]">
              <span>Metrics</span>
              <span class="tabular-nums text-[var(--accent-text)]">{{ selectedMetrics().length }} selected</span>
            </legend>
            <ul class="flex flex-col gap-1.5">
              @for (m of cat.metrics; track m.key) {
                <li>
                  <label
                    class="flex cursor-pointer items-start gap-2.5 rounded-[var(--r-md)] border px-3 py-2
                           transition-colors hover:border-[var(--accent)]"
                    [class]="metricLabelClass(m.key)">
                    <input
                      type="checkbox"
                      class="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      [checked]="isMetricOn(m.key)"
                      (change)="toggleMetric(m.key)" />
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-1.5">
                        <span class="text-sm font-medium text-[var(--ink-strong)]">{{ m.label }}</span>
                        <span
                          class="inline-flex items-center gap-1 rounded-full border border-[var(--line)]
                                 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em]
                                 text-[var(--ink-muted)]"
                          [title]="provLabel(m.provenance) + ' metric'">
                          <span
                            class="h-1.5 w-1.5 rounded-full"
                            [style.background]="provVar(m.provenance)"
                            aria-hidden="true"></span>
                          {{ provLabel(m.provenance) }}
                        </span>
                      </span>
                      <span class="mt-0.5 block text-[11px] leading-snug text-[var(--ink-muted)]">
                        {{ m.description }}
                      </span>
                    </span>
                  </label>
                </li>
              }
            </ul>
          </fieldset>

          <!-- Group by -->
          <fieldset class="border-0 p-0">
            <legend class="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              Group by
            </legend>
            <div class="flex gap-1 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)] p-1"
                 role="radiogroup" aria-label="Group by dimension">
              @for (d of cat.dimensions; track d.key) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="dimension() === d.key"
                  [title]="d.description"
                  class="flex-1 rounded-[var(--r-sm)] px-2 py-1.5 text-xs font-semibold transition-colors
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1
                         focus-visible:outline-[var(--accent)]"
                  [class]="dimBtnClass(dimension() === d.key)"
                  (click)="setDimension(d.key)">
                  {{ d.label }}
                </button>
              }
            </div>
          </fieldset>

          <!-- Period -->
          <div>
            <label
              for="bo-period"
              class="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              Period
            </label>
            <select
              id="bo-period"
              class="w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2
                     text-sm text-[var(--ink-strong)] focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
              [value]="periodId()"
              (change)="setPeriod($event)">
              @for (p of cat.periods; track p.periodId) {
                <option [value]="p.periodId">{{ p.label }}</option>
              }
            </select>
          </div>

          <!-- Filters -->
          <details class="group rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)]">
            <summary
              class="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold
                     uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              <span>Filters{{ filterCount() ? ' · ' + filterCount() : '' }}</span>
              <span class="transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
            </summary>
            <div class="flex flex-col gap-3 px-3 pb-3">
              <!-- Brands -->
              <div>
                <p class="mb-1 text-[11px] font-semibold text-[var(--ink-muted)]">Brand</p>
                <div class="flex flex-wrap gap-1.5">
                  @for (b of cat.filters.brands; track b.id) {
                    <button type="button" [class]="chipClass(brandIds().includes(b.id))"
                            [attr.aria-pressed]="brandIds().includes(b.id)"
                            (click)="toggleFilter('brand', b.id)">{{ b.label }}</button>
                  }
                </div>
              </div>
              <!-- Regions (chained to brand) -->
              @if (availableRegions().length) {
                <div>
                  <p class="mb-1 text-[11px] font-semibold text-[var(--ink-muted)]">Region</p>
                  <div class="flex flex-wrap gap-1.5">
                    @for (r of availableRegions(); track r.id) {
                      <button type="button" [class]="chipClass(regionIds().includes(r.id))"
                              [attr.aria-pressed]="regionIds().includes(r.id)"
                              (click)="toggleFilter('region', r.id)">{{ r.label }}</button>
                    }
                  </div>
                </div>
              }
              <!-- Territories (chained to brand/region) -->
              @if (availableTerritories().length) {
                <div>
                  <p class="mb-1 text-[11px] font-semibold text-[var(--ink-muted)]">Territory</p>
                  <div class="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                    @for (t of availableTerritories(); track t.id) {
                      <button type="button" [class]="chipClass(territoryIds().includes(t.id))"
                              [attr.aria-pressed]="territoryIds().includes(t.id)"
                              (click)="toggleFilter('territory', t.id)">{{ t.label }}</button>
                    }
                  </div>
                </div>
              }
              @if (filterCount()) {
                <button type="button" class="self-start text-[11px] font-semibold text-[var(--accent-text)]
                        underline-offset-2 hover:underline" (click)="clearFilters()">Clear filters</button>
              }
            </div>
          </details>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button type="submit" class="{{ btnPrimary }} flex-1" [disabled]="!canRun() || runStatus() === 'loading'">
              {{ runStatus() === 'loading' ? 'Running…' : 'Run report' }}
            </button>
            <button type="button" class="{{ btnGhost }}" (click)="reset()" [disabled]="runStatus() === 'loading'">
              Reset
            </button>
          </div>
          @if (!canRun()) {
            <p class="-mt-2 text-[11px] text-[var(--ink-muted)]">Select at least one metric to run a report.</p>
          }

          <!-- Saved reports -->
          <div class="border-t border-[var(--line)] pt-4">
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              Saved reports
            </p>
            <div class="flex items-center gap-2">
              <label class="sr-only" for="bo-save-name">Report name</label>
              <input
                id="bo-save-name"
                type="text"
                placeholder="Name this report…"
                class="min-w-0 flex-1 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)]
                       px-3 py-1.5 text-sm text-[var(--ink-strong)] placeholder:text-[var(--ink-muted)]
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1
                       focus-visible:outline-[var(--accent)]"
                [value]="saveName()"
                (input)="saveName.set($any($event.target).value)" />
              <button
                type="button"
                class="{{ btnGhost }}"
                [disabled]="!canSave()"
                (click)="saveCurrent()">
                {{ saving() ? 'Saving…' : 'Save' }}
              </button>
            </div>
            @if (saved().length) {
              <ul class="mt-3 flex flex-col gap-1.5">
                @for (s of saved(); track s.id) {
                  <li
                    class="flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--line)]
                           bg-[var(--surface-2)] px-2.5 py-1.5">
                    <button
                      type="button"
                      class="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--ink-strong)]
                             hover:text-[var(--accent-text)]"
                      [title]="'Load: ' + s.name"
                      (click)="loadSaved(s)">
                      {{ s.name }}
                    </button>
                    <span class="shrink-0 text-[10px] text-[var(--ink-muted)]">{{ s.query.metrics.length }}m</span>
                    <button
                      type="button"
                      class="shrink-0 rounded-[var(--r-sm)] px-1.5 py-0.5 text-[var(--ink-muted)]
                             hover:bg-[var(--critical-soft)] hover:text-[var(--critical)]
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--critical)]"
                      [attr.aria-label]="'Delete saved report ' + s.name"
                      (click)="deleteSaved(s)">✕</button>
                  </li>
                }
              </ul>
            } @else {
              <p class="mt-2 text-[11px] text-[var(--ink-muted)]">No saved reports yet.</p>
            }
          </div>
        </form>

        <!-- ───────────────────────── Results ───────────────────────── -->
        <section aria-live="polite" class="min-w-0">
          @if (runStatus() === 'idle') {
            <div
              class="flex min-h-80 flex-col items-center justify-center rounded-[var(--r-lg)] border
                     border-dashed border-[var(--line-strong)] bg-[var(--surface)] p-10 text-center">
              <span
                class="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full
                       bg-[var(--accent-soft)] text-xl text-[var(--accent-text)]" aria-hidden="true">▦</span>
              <h2 class="text-base font-semibold text-[var(--ink-strong)]">Build your first report</h2>
              <p class="mt-1 max-w-sm text-sm text-[var(--ink-muted)]">
                Choose metrics and a grouping on the left, then run. Results render as a table and a chart you
                can export or save.
              </p>
            </div>
          } @else if (runStatus() === 'loading') {
            <div class="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-6"
                 role="status">
              <div class="h-5 w-40 animate-pulse rounded bg-[var(--surface-2)]"></div>
              <div class="mt-4 h-48 animate-pulse rounded bg-[var(--surface-2)]"></div>
              <div class="mt-4 h-32 animate-pulse rounded bg-[var(--surface-2)]"></div>
              <span class="sr-only">Running report…</span>
            </div>
          } @else if (runStatus() === 'error') {
            <div
              class="rounded-[var(--r-lg)] border border-[var(--critical)] bg-[var(--critical-soft)] p-6"
              role="alert">
              <h2 class="text-base font-semibold text-[var(--ink-strong)]">The report didn't run</h2>
              <p class="mt-1 text-sm text-[var(--ink-muted)]">{{ runError() }}</p>
              <button type="button" class="mt-3 {{ btnPrimary }}" (click)="run()">Try again</button>
            </div>
          } @else if (result(); as res) {
            @if (!res.rows.length) {
              <div
                class="flex min-h-72 flex-col items-center justify-center rounded-[var(--r-lg)] border
                       border-[var(--line)] bg-[var(--surface)] p-10 text-center">
                <h2 class="text-base font-semibold text-[var(--ink-strong)]">No rows match this scope</h2>
                <p class="mt-1 max-w-sm text-sm text-[var(--ink-muted)]">
                  The filters excluded every {{ res.meta.dimensionLabel.toLowerCase() }}. Loosen the filters and
                  run again.
                </p>
                <button type="button" class="mt-3 {{ btnGhost }}" (click)="clearFilters()">Clear filters</button>
              </div>
            } @else {
              <!-- Provenance summary -->
              <div
                class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--r-lg)] border
                       border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-card)]">
                <span class="text-sm font-semibold text-[var(--ink-strong)]">
                  {{ res.meta.rowCount }} {{ res.meta.dimensionLabel.toLowerCase() }}{{ res.meta.rowCount === 1 ? '' : 's' }}
                  · {{ res.meta.periodLabel }}
                </span>
                <span class="h-4 w-px bg-[var(--line)]" aria-hidden="true"></span>
                <span class="flex flex-wrap items-center gap-2 text-[11px]">
                  @if (res.meta.measuredMetrics.length) {
                    <span class="inline-flex items-center gap-1 text-[var(--ink-muted)]">
                      <span class="h-2 w-2 rounded-full" [style.background]="provVar('measured')" aria-hidden="true"></span>
                      {{ res.meta.measuredMetrics.length }} measured
                    </span>
                  }
                  @if (res.meta.reportedMetrics.length) {
                    <span class="inline-flex items-center gap-1 text-[var(--ink-muted)]">
                      <span class="h-2 w-2 rounded-full" [style.background]="provVar('reported')" aria-hidden="true"></span>
                      {{ res.meta.reportedMetrics.length }} reported
                    </span>
                  }
                  @if (res.meta.illustrativeMetrics.length) {
                    <span class="inline-flex items-center gap-1 font-medium text-[var(--ink)]">
                      <span class="h-2 w-2 rounded-full" [style.background]="provVar('seeded')" aria-hidden="true"></span>
                      {{ res.meta.illustrativeMetrics.length }} illustrative
                    </span>
                  }
                </span>
                @if (dirty()) {
                  <span class="ml-auto rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px]
                               font-semibold text-[var(--warning)]">Config changed — re-run</span>
                }
              </div>

              <!-- Toolbar -->
              <div class="mt-4 flex flex-wrap items-center gap-3">
                <div class="flex items-center gap-2">
                  <label for="bo-chart-metric" class="text-xs font-semibold text-[var(--ink-muted)]">Chart</label>
                  <select
                    id="bo-chart-metric"
                    class="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5
                           text-xs text-[var(--ink-strong)] focus-visible:outline focus-visible:outline-2
                           focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                    [value]="chartMetric()"
                    (change)="chartMetric.set($any($event.target).value)">
                    @for (c of metricColumns(); track c.key) {
                      <option [value]="c.key">{{ c.label }}</option>
                    }
                  </select>
                </div>
                <div class="ml-auto flex items-center gap-2">
                  <button type="button" class="{{ btnGhost }}" (click)="exportCsv()">Export CSV</button>
                  <button type="button" class="{{ btnPrimary }}" [disabled]="exporting()" (click)="exportXlsx()">
                    {{ exporting() ? 'Exporting…' : 'Export XLSX' }}
                  </button>
                </div>
              </div>

              <!-- Chart -->
              <div class="mt-4 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-4
                          shadow-[var(--shadow-card)]">
                <bo-report-chart
                  [data]="chartData()"
                  [metricLabel]="chartColumn()?.label ?? ''"
                  [dimensionLabel]="res.meta.dimensionLabel"
                  [unit]="chartColumn()?.unit"
                  [provenance]="chartColumn()?.provenance" />
              </div>

              <!-- Table -->
              <div class="mt-4 overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)]
                          bg-[var(--surface)] shadow-[var(--shadow-card)]">
                <table class="w-full border-collapse text-sm">
                  <caption class="sr-only">
                    {{ chartColumn()?.label }} and related metrics by {{ res.meta.dimensionLabel }} for
                    {{ res.meta.periodLabel }}
                  </caption>
                  <thead>
                    <tr class="border-b border-[var(--line)]">
                      @for (c of res.columns; track c.key) {
                        <th
                          scope="col"
                          class="px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em]
                                 text-[var(--ink-muted)]"
                          [class.text-left]="c.kind === 'dimension'"
                          [class.text-right]="c.kind === 'metric'">
                          <span class="inline-flex items-center gap-1.5"
                                [class.flex-row-reverse]="c.kind === 'metric'">
                            @if (c.provenance) {
                              <span class="h-1.5 w-1.5 rounded-full" [style.background]="provVar(c.provenance)"
                                    [title]="provLabel(c.provenance)" aria-hidden="true"></span>
                            }
                            {{ c.label }}
                          </span>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of res.rows; track row.key) {
                      <tr class="border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-2)]">
                        @for (c of res.columns; track c.key) {
                          @if (c.kind === 'dimension') {
                            <th scope="row" class="px-4 py-2.5 text-left font-medium text-[var(--ink-strong)]">
                              {{ row.cells[c.key] }}
                            </th>
                          } @else {
                            <td class="px-4 py-2.5 text-right tabular-nums text-[var(--ink)]">
                              {{ fmt(row.cells[c.key], c.unit) }}
                            </td>
                          }
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </section>
      </div>

      <!-- Schedule / Share — out of scope this wave, surfaced honestly. -->
      <div class="mt-8">
        <bo-coming-soon
          eyebrow="Reports"
          title="Schedule & Share"
          summary="Put this report on a cadence and route it to stakeholders — email a PDF every Monday, or share a
                   live link scoped to a brand or region."
          eta="Wave 2"
          [features]="[
            'Schedule recurring runs (daily / weekly / monthly)',
            'Email or Slack delivery with the export attached',
            'Share a read-only link scoped to the recipient',
            'Snapshot history so figures are reproducible',
          ]" />
      </div>
    }
  `,
})
export class ReportBuilderComponent implements OnInit {
  private readonly data = inject(ReportsDataService);

  // Shared button recipes — token-only, focus-visible, no raw hex.
  readonly btnPrimary =
    'rounded-[var(--r-md)] bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-[var(--accent-ink)] ' +
    'transition-colors hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-50 ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
  readonly btnGhost =
    'rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-sm font-semibold ' +
    'text-[var(--ink-strong)] transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed ' +
    'disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-[var(--accent)]';

  // ── Catalog ──
  readonly catalog = signal<ReportCatalog | null>(null);
  readonly catalogStatus = signal<Status>('loading');
  readonly catalogError = signal('');

  // ── Query state ──
  readonly selectedMetrics = signal<string[]>(['revenue', 'bookings', 'avgTicket']);
  readonly dimension = signal<DimensionKey>('brand');
  readonly periodId = signal<number>(202606);
  readonly brandIds = signal<number[]>([]);
  readonly regionIds = signal<number[]>([]);
  readonly territoryIds = signal<number[]>([]);

  // ── Run state ──
  readonly result = signal<ReportResult | null>(null);
  readonly runStatus = signal<Status>('idle');
  readonly runError = signal('');
  readonly chartMetric = signal<string | null>(null);
  /** True when the config changed since the last successful run. */
  readonly dirty = signal(false);

  // ── Saved + export ──
  readonly saved = signal<SavedReport[]>([]);
  readonly saveName = signal('');
  readonly saving = signal(false);
  readonly exporting = signal(false);

  readonly canRun = computed(() => this.selectedMetrics().length > 0);
  readonly canSave = computed(
    () => !!this.result() && this.selectedMetrics().length > 0 && this.saveName().trim().length > 0,
  );
  readonly filterCount = computed(
    () => this.brandIds().length + this.regionIds().length + this.territoryIds().length,
  );

  // Filter chaining: regions narrow to the picked brands; territories to the
  // picked regions (or brands when no region is chosen).
  readonly availableRegions = computed<FilterOption[]>(() => {
    const all = this.catalog()?.filters.regions ?? [];
    const bs = this.brandIds();
    return bs.length ? all.filter((r) => r.brandId !== undefined && bs.includes(r.brandId)) : all;
  });
  readonly availableTerritories = computed<FilterOption[]>(() => {
    const all = this.catalog()?.filters.territories ?? [];
    const bs = this.brandIds();
    const rs = this.regionIds();
    return all.filter(
      (t) =>
        (!bs.length || (t.brandId !== undefined && bs.includes(t.brandId))) &&
        (!rs.length || (t.regionId !== undefined && rs.includes(t.regionId))),
    );
  });

  readonly metricColumns = computed<ReportColumn[]>(
    () => this.result()?.columns.filter((c) => c.kind === 'metric') ?? [],
  );
  readonly chartColumn = computed<ReportColumn | undefined>(() => {
    const key = this.chartMetric();
    return this.metricColumns().find((c) => c.key === key) ?? this.metricColumns()[0];
  });
  readonly chartData = computed<ChartDatum[]>(() => {
    const res = this.result();
    const col = this.chartColumn();
    if (!res || !col) return [];
    return res.rows.map((r) => ({
      label: String(r.cells['__dim'] ?? ''),
      value: Number(r.cells[col.key]) || 0,
    }));
  });

  ngOnInit(): void {
    this.loadCatalog();
    this.loadSavedList();
  }

  loadCatalog(): void {
    this.catalogStatus.set('loading');
    this.data.catalog().subscribe({
      next: (cat) => {
        this.catalog.set(cat);
        this.catalogStatus.set('ready');
      },
      error: (e) => {
        this.catalogError.set(this.message(e));
        this.catalogStatus.set('error');
      },
    });
  }

  private loadSavedList(): void {
    this.data.savedList().subscribe({ next: (list) => this.saved.set(list), error: () => this.saved.set([]) });
  }

  // ── Picker handlers ──
  isMetricOn(key: string): boolean {
    return this.selectedMetrics().includes(key);
  }
  toggleMetric(key: string): void {
    const cur = this.selectedMetrics();
    this.selectedMetrics.set(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
    this.markDirty();
  }
  setDimension(d: DimensionKey): void {
    this.dimension.set(d);
    this.markDirty();
  }
  setPeriod(ev: Event): void {
    this.periodId.set(Number((ev.target as HTMLSelectElement).value));
    this.markDirty();
  }
  toggleFilter(kind: 'brand' | 'region' | 'territory', id: number): void {
    const sig = kind === 'brand' ? this.brandIds : kind === 'region' ? this.regionIds : this.territoryIds;
    const cur = sig();
    sig.set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    // Prune dependent selections that the new scope no longer offers.
    if (kind === 'brand') {
      const regions = new Set(this.availableRegions().map((r) => r.id));
      this.regionIds.set(this.regionIds().filter((r) => regions.has(r)));
    }
    if (kind === 'brand' || kind === 'region') {
      const terrs = new Set(this.availableTerritories().map((t) => t.id));
      this.territoryIds.set(this.territoryIds().filter((t) => terrs.has(t)));
    }
    this.markDirty();
  }
  clearFilters(): void {
    this.brandIds.set([]);
    this.regionIds.set([]);
    this.territoryIds.set([]);
    this.markDirty();
  }

  private markDirty(): void {
    if (this.result()) this.dirty.set(true);
  }

  private buildQuery(): ReportQuery {
    return {
      metrics: [...this.selectedMetrics()],
      dimension: this.dimension(),
      periodId: this.periodId(),
      filters: {
        brandIds: [...this.brandIds()],
        regionIds: [...this.regionIds()],
        territoryIds: [...this.territoryIds()],
      },
    };
  }

  // ── Run ──
  run(ev?: Event): void {
    ev?.preventDefault();
    if (!this.canRun()) return;
    this.runStatus.set('loading');
    this.data.run(this.buildQuery()).subscribe({
      next: (res) => {
        this.result.set(res);
        const firstMetric = res.columns.find((c) => c.kind === 'metric');
        this.chartMetric.set(firstMetric?.key ?? null);
        this.dirty.set(false);
        this.runStatus.set('ready');
      },
      error: (e) => {
        this.runError.set(this.message(e));
        this.runStatus.set('error');
      },
    });
  }

  reset(): void {
    this.selectedMetrics.set(['revenue', 'bookings', 'avgTicket']);
    this.dimension.set('brand');
    this.periodId.set(202606);
    this.clearFilters();
    this.result.set(null);
    this.runStatus.set('idle');
    this.chartMetric.set(null);
    this.dirty.set(false);
  }

  // ── Saved reports ──
  saveCurrent(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.data.save({ name: this.saveName().trim(), query: this.buildQuery() }).subscribe({
      next: (s) => {
        this.saved.set([s, ...this.saved().filter((x) => x.id !== s.id)]);
        this.saveName.set('');
        this.saving.set(false);
      },
      error: () => this.saving.set(false),
    });
  }
  loadSaved(s: SavedReport): void {
    const q = s.query;
    this.selectedMetrics.set([...q.metrics]);
    this.dimension.set(q.dimension);
    this.periodId.set(q.periodId);
    this.brandIds.set([...q.filters.brandIds]);
    this.regionIds.set([...q.filters.regionIds]);
    this.territoryIds.set([...q.filters.territoryIds]);
    this.saveName.set(s.name);
    this.run();
  }
  deleteSaved(s: SavedReport): void {
    this.data.remove(s.id).subscribe({
      next: () => this.saved.set(this.saved().filter((x) => x.id !== s.id)),
      error: () => {},
    });
  }

  // ── Export ──
  exportCsv(): void {
    const res = this.result();
    if (res) downloadCsv(res, `${this.exportStem()}.csv`);
  }
  async exportXlsx(): Promise<void> {
    const res = this.result();
    if (!res) return;
    this.exporting.set(true);
    try {
      await downloadXlsx(res, `${this.exportStem()}.xlsx`, this.exportTitle());
    } finally {
      this.exporting.set(false);
    }
  }
  private exportStem(): string {
    return safeStem(this.saveName() || `report-by-${this.dimension()}`);
  }
  private exportTitle(): string {
    return this.saveName().trim() || `Report by ${this.dimension()}`;
  }

  // ── View helpers ──
  fmt = (v: number | string | null, unit?: MetricDef['unit']) => formatValue(v, unit);
  provLabel = (p: ReportColumn['provenance']) => (p ? PROVENANCE_LABEL[p] : '');
  provVar = (p: ReportColumn['provenance']) => (p ? PROVENANCE_VAR[p] : 'var(--ink-muted)');

  // Conditional Tailwind arbitrary-value classes are built in TS (not via
  // [class.x] bindings) because the nested brackets in `bg-[var(--…)]` confuse the
  // template parser. Static base classes stay in the template; these add state.
  metricLabelClass(key: string): string {
    return this.isMetricOn(key)
      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
      : 'border-[var(--line)]';
  }
  dimBtnClass(active: boolean): string {
    return active
      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
      : 'text-[var(--ink-muted)]';
  }

  chipClass(on: boolean): string {
    const base =
      'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline ' +
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]';
    return on
      ? `${base} border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]`
      : `${base} border-[var(--line)] bg-[var(--surface)] text-[var(--ink-muted)] hover:border-[var(--accent)]`;
  }

  private message(e: unknown): string {
    const err = e as { message?: string; status?: number };
    if (err?.status) return `Request failed (HTTP ${err.status}). The reporting service may be unavailable.`;
    return err?.message || 'Something went wrong. Please try again.';
  }
}
