import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Observable, forkJoin } from 'rxjs';
import { ComingSoonComponent } from '../shared/coming-soon.component';
import { ReportChartComponent, ChartDatum } from './report-chart.component';
import { DimensionMember, ReportsDataService } from './reports-data.service';
import {
  ProvenanceType,
  ReportCatalog,
  ReportColumn,
  ReportFilters,
  ReportQueryRequest,
  ReportQueryResult,
  ReportRow,
  SavedReport,
  PROVENANCE_LABEL,
  PROVENANCE_VAR,
  formatValue,
} from './reports.models';
import { downloadCsv, downloadXlsx, safeStem } from './excel-export.util';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** One configurable filter facet, mapped to a §C2 query filter + its discovery dimension. */
interface FilterFacet {
  /** Query filter key (brandId, regionId, archetype, tenureBand, status, territoryIds). */
  filterKey: string;
  /** Dimension key whose members populate this picker (territory_count-by-dimension). */
  dimKey: string;
  label: string;
  multi: boolean;
  members: () => DimensionMember[];
}

const RISK_BANDS = [
  { value: 'healthy', label: 'Healthy (≥70)' },
  { value: 'watch', label: 'Watch (50–69)' },
  { value: 'at_risk', label: 'At risk (<50)' },
];

// Preferred opening selection — intersected with whatever the live catalog ships.
const PREFERRED_METRICS = ['composite_score', 'gross_revenue', 'at_risk_count'];

/**
 * Report Builder (C1 `ReportBuilderComponent`) — the back office's custom
 * reporting powerhouse. Compose a query (metrics × group-by dimension × period,
 * scoped by brand/region/territory + archetype/tenure/status/risk), run it against
 * the corporate read model (§C2), and read the result as a table AND a chart.
 * Export to CSV/XLSX client-side, or save the definition to reload later.
 *
 * Honest by construction (D16): every metric carries its provenance — measured,
 * derived, mixed, or illustrative — surfaced on the picker, the column headers, the
 * chart, the run summary, and the export. A seeded placeholder never gets to look
 * like an operational fact. Design tokens only; full keyboard support; explicit
 * loading / empty / error states.
 *
 * Entirely catalog-driven: metrics, dimensions, periods and the filter set all come
 * from `/api/reports/catalog`, so the UI tracks the contract without code edits.
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
      <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">
        Reports
      </p>
      <h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">
        Report Builder
      </h1>
      <p class="mt-1.5 max-w-prose text-sm text-[var(--ink-muted)]">
        Compose a report from the corporate read model — pick metrics, group by any dimension, scope
        the period and filters, then run, visualise, and export. Every figure is labelled measured
        vs. illustrative.
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
        role="alert"
      >
        <h2 class="text-base font-semibold text-[var(--ink-strong)]">
          Couldn't load the report catalog
        </h2>
        <p class="mt-1 text-sm text-[var(--ink-muted)]">{{ catalogError() }}</p>
        <button type="button" class="mt-3 {{ btnPrimary }}" (click)="loadCatalog()">Retry</button>
      </div>
    } @else if (catalog(); as cat) {
      <div class="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
        <!-- ───────────────────────── Config panel ───────────────────────── -->
        <form
          class="flex flex-col gap-5 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)]
                 p-5 shadow-[var(--shadow-card)] lg:sticky lg:top-4"
          (submit)="run($event)"
        >
          <!-- Metrics -->
          <fieldset class="border-0 p-0">
            <legend
              class="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase
                           tracking-[0.1em] text-[var(--ink-muted)]"
            >
              <span>Metrics</span>
              <span class="tabular-nums text-[var(--accent-text)]"
                >{{ selectedMetrics().length }} selected</span
              >
            </legend>
            <ul class="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
              @for (m of cat.metrics; track m.key) {
                <li>
                  <label
                    class="flex cursor-pointer items-start gap-2.5 rounded-[var(--r-md)] border px-3 py-2
                           transition-colors hover:border-[var(--accent)]"
                    [class]="metricLabelClass(m.key)"
                  >
                    <input
                      type="checkbox"
                      class="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      [checked]="isMetricOn(m.key)"
                      (change)="toggleMetric(m.key)"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-1.5">
                        <span class="text-sm font-medium text-[var(--ink-strong)]">{{
                          m.label
                        }}</span>
                        <span
                          class="inline-flex items-center gap-1 rounded-full border border-[var(--line)]
                                 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em]
                                 text-[var(--ink-muted)]"
                          [title]="provLabel(m.provenanceType) + ' metric'"
                        >
                          <span
                            class="h-1.5 w-1.5 rounded-full"
                            [style.background]="provVar(m.provenanceType)"
                            aria-hidden="true"
                          ></span>
                          {{ m.illustrative ? 'Illustrative' : provLabel(m.provenanceType) }}
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
            <legend
              class="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]"
            >
              Group by
            </legend>
            <div
              class="grid grid-cols-2 gap-1 rounded-[var(--r-md)] border border-[var(--line)]
                        bg-[var(--surface-2)] p-1"
              role="radiogroup"
              aria-label="Group by dimension"
            >
              @for (d of cat.dimensions; track d.key) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="dimension() === d.key"
                  class="rounded-[var(--r-sm)] px-2 py-1.5 text-xs font-semibold transition-colors
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1
                         focus-visible:outline-[var(--accent)]"
                  [class]="dimBtnClass(dimension() === d.key)"
                  (click)="setDimension(d.key)"
                >
                  {{ d.label }}
                </button>
              }
            </div>
          </fieldset>

          <!-- Period -->
          <div>
            <label
              for="bo-period"
              class="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]"
            >
              Period
            </label>
            <select
              id="bo-period"
              class="{{ inputCls }}"
              [value]="periodId()"
              (change)="setPeriod($event)"
            >
              @for (p of cat.periods; track p.periodId) {
                <option [value]="p.periodId">
                  {{ p.label }}{{ p.isLatest ? ' · latest' : '' }}
                </option>
              }
            </select>
          </div>

          <!-- Filters -->
          <details
            class="group rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)]"
          >
            <summary
              class="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold
                     uppercase tracking-[0.1em] text-[var(--ink-muted)]"
            >
              <span>Filters{{ filterCount() ? ' · ' + filterCount() : '' }}</span>
              <span class="transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
            </summary>
            <div class="flex flex-col gap-3 px-3 pb-3">
              @for (f of facets(); track f.filterKey) {
                @if (f.members().length) {
                  <div>
                    <p class="mb-1 text-[11px] font-semibold text-[var(--ink-muted)]">
                      {{ f.label }}
                    </p>
                    @if (f.multi) {
                      <div class="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                        @for (mem of f.members(); track mem.id ?? mem.label) {
                          <button
                            type="button"
                            [class]="chipClass(isTerritoryOn(mem.id))"
                            [attr.aria-pressed]="isTerritoryOn(mem.id)"
                            (click)="toggleTerritory(mem.id)"
                          >
                            {{ mem.label }}
                          </button>
                        }
                      </div>
                    } @else {
                      <select
                        class="{{ inputCls }}"
                        [value]="facetValue(f.filterKey)"
                        (change)="setFacet(f, $event)"
                      >
                        <option value="">All</option>
                        @for (mem of f.members(); track mem.id ?? mem.label) {
                          <option
                            [value]="
                              f.dimKey === 'brand' || f.dimKey === 'region' ? mem.id : mem.label
                            "
                          >
                            {{ mem.label }}
                          </option>
                        }
                      </select>
                    }
                  </div>
                }
              }
              <!-- Risk band (fixed domain from the contract) -->
              <div>
                <p class="mb-1 text-[11px] font-semibold text-[var(--ink-muted)]">Risk band</p>
                <select
                  class="{{ inputCls }}"
                  [value]="riskBand() ?? ''"
                  (change)="setRiskBand($event)"
                >
                  <option value="">All</option>
                  @for (b of riskBands; track b.value) {
                    <option [value]="b.value">{{ b.label }}</option>
                  }
                </select>
              </div>
              @if (filterCount()) {
                <button
                  type="button"
                  class="self-start text-[11px] font-semibold text-[var(--accent-text)]
                        underline-offset-2 hover:underline"
                  (click)="clearFilters()"
                >
                  Clear filters
                </button>
              }
            </div>
          </details>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button
              type="submit"
              class="{{ btnPrimary }} flex-1"
              [disabled]="!canRun() || runStatus() === 'loading'"
            >
              {{ runStatus() === 'loading' ? 'Running…' : 'Run report' }}
            </button>
            <button
              type="button"
              class="{{ btnGhost }}"
              (click)="reset()"
              [disabled]="runStatus() === 'loading'"
            >
              Reset
            </button>
          </div>
          @if (!canRun()) {
            <p class="-mt-2 text-[11px] text-[var(--ink-muted)]">
              Select at least one metric to run a report.
            </p>
          }

          <!-- Saved reports -->
          <div class="border-t border-[var(--line)] pt-4">
            <p
              class="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]"
            >
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
                (input)="saveName.set($any($event.target).value)"
              />
              <button
                type="button"
                class="{{ btnGhost }}"
                [disabled]="!canSave()"
                (click)="saveCurrent()"
              >
                {{ saving() ? 'Saving…' : 'Save' }}
              </button>
            </div>
            @if (saved().length) {
              <ul class="mt-3 flex flex-col gap-1.5">
                @for (s of saved(); track s.id) {
                  <li
                    class="flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--line)]
                           bg-[var(--surface-2)] px-2.5 py-1.5"
                  >
                    <button
                      type="button"
                      class="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--ink-strong)]
                             hover:text-[var(--accent-text)]"
                      [title]="(s.description || 'Load') + ' — ' + s.name"
                      (click)="loadSaved(s)"
                    >
                      {{ s.name }}
                    </button>
                    <span class="shrink-0 text-[10px] text-[var(--ink-muted)]"
                      >{{ s.definition.metrics.length }}m</span
                    >
                    <button
                      type="button"
                      class="shrink-0 rounded-[var(--r-sm)] px-1.5 py-0.5 text-[var(--ink-muted)]
                             hover:bg-[var(--critical-soft)] hover:text-[var(--critical)]
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--critical)]"
                      [attr.aria-label]="'Delete saved report ' + s.name"
                      (click)="deleteSaved(s)"
                    >
                      ✕
                    </button>
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
                     border-dashed border-[var(--line-strong)] bg-[var(--surface)] p-10 text-center"
            >
              <span
                class="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full
                       bg-[var(--accent-soft)] text-xl text-[var(--accent-text)]"
                aria-hidden="true"
                >▦</span
              >
              <h2 class="text-base font-semibold text-[var(--ink-strong)]">
                Build your first report
              </h2>
              <p class="mt-1 max-w-sm text-sm text-[var(--ink-muted)]">
                Choose metrics and a grouping on the left, then run. Results render as a table and a
                chart you can export or save.
              </p>
            </div>
          } @else if (runStatus() === 'loading') {
            <div
              class="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-6"
              role="status"
            >
              <div class="h-5 w-40 animate-pulse rounded bg-[var(--surface-2)]"></div>
              <div class="mt-4 h-48 animate-pulse rounded bg-[var(--surface-2)]"></div>
              <div class="mt-4 h-32 animate-pulse rounded bg-[var(--surface-2)]"></div>
              <span class="sr-only">Running report…</span>
            </div>
          } @else if (runStatus() === 'error') {
            <div
              class="rounded-[var(--r-lg)] border border-[var(--critical)] bg-[var(--critical-soft)] p-6"
              role="alert"
            >
              <h2 class="text-base font-semibold text-[var(--ink-strong)]">
                The report didn't run
              </h2>
              <p class="mt-1 text-sm text-[var(--ink-muted)]">{{ runError() }}</p>
              <button type="button" class="mt-3 {{ btnPrimary }}" (click)="run()">Try again</button>
            </div>
          } @else if (result(); as res) {
            @if (!res.rows.length) {
              <div
                class="flex min-h-72 flex-col items-center justify-center rounded-[var(--r-lg)] border
                       border-[var(--line)] bg-[var(--surface)] p-10 text-center"
              >
                <h2 class="text-base font-semibold text-[var(--ink-strong)]">
                  No rows match this scope
                </h2>
                <p class="mt-1 max-w-sm text-sm text-[var(--ink-muted)]">
                  The filters excluded every {{ dimensionLabel().toLowerCase() }}. Loosen the
                  filters and run again.
                </p>
                <button type="button" class="mt-3 {{ btnGhost }}" (click)="clearFilters()">
                  Clear filters
                </button>
              </div>
            } @else {
              <!-- Provenance summary -->
              <div
                class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--r-lg)] border
                       border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-card)]"
              >
                <span class="text-sm font-semibold text-[var(--ink-strong)]">
                  {{ res.meta.rowCount }} {{ dimensionLabel().toLowerCase()
                  }}{{ res.meta.rowCount === 1 ? '' : 's' }} · {{ res.meta.period.label }}
                  <span class="font-normal text-[var(--ink-muted)]"
                    >· {{ res.meta.territoryCount }} territories</span
                  >
                </span>
                <span class="h-4 w-px bg-[var(--line)]" aria-hidden="true"></span>
                <span class="flex flex-wrap items-center gap-2 text-[11px]">
                  @if (measuredCount()) {
                    <span class="inline-flex items-center gap-1 text-[var(--ink-muted)]">
                      <span
                        class="h-2 w-2 rounded-full"
                        [style.background]="provVar('measured')"
                        aria-hidden="true"
                      ></span>
                      {{ measuredCount() }} measured
                    </span>
                  }
                  @if (derivedCount()) {
                    <span class="inline-flex items-center gap-1 text-[var(--ink-muted)]">
                      <span
                        class="h-2 w-2 rounded-full"
                        [style.background]="provVar('derived')"
                        aria-hidden="true"
                      ></span>
                      {{ derivedCount() }} derived
                    </span>
                  }
                  @if (illustrativeCount()) {
                    <span class="inline-flex items-center gap-1 font-medium text-[var(--ink)]">
                      <span
                        class="h-2 w-2 rounded-full"
                        [style.background]="provVar('seeded')"
                        aria-hidden="true"
                      ></span>
                      {{ illustrativeCount() }} illustrative
                    </span>
                  }
                </span>
                @if (dirty()) {
                  <span
                    class="ml-auto rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px]
                               font-semibold text-[var(--warning)]"
                    >Config changed — re-run</span
                  >
                }
              </div>

              <!-- Honest notes from the API meta -->
              @for (n of res.meta.notes; track n.message) {
                <p
                  class="mt-2 flex items-start gap-2 rounded-[var(--r-md)] border px-3 py-2 text-[11px]"
                  [class]="noteClass(n.severity)"
                >
                  <span aria-hidden="true">{{ n.severity === 'warning' ? '⚠' : 'ℹ' }}</span>
                  <span>{{ n.message }}</span>
                </p>
              }

              <!-- Toolbar -->
              <div class="mt-4 flex flex-wrap items-center gap-3">
                <div class="flex items-center gap-2">
                  <label for="bo-chart-metric" class="text-xs font-semibold text-[var(--ink-muted)]"
                    >Chart</label
                  >
                  <select
                    id="bo-chart-metric"
                    class="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5
                           text-xs text-[var(--ink-strong)] focus-visible:outline focus-visible:outline-2
                           focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                    [value]="chartMetric()"
                    (change)="chartMetric.set($any($event.target).value)"
                  >
                    @for (c of metricColumns(); track c.key) {
                      <option [value]="c.key">{{ c.label }}</option>
                    }
                  </select>
                </div>
                <div class="ml-auto flex items-center gap-2">
                  <button type="button" class="{{ btnGhost }}" (click)="exportCsv()">
                    Export CSV
                  </button>
                  <button
                    type="button"
                    class="{{ btnPrimary }}"
                    [disabled]="exporting()"
                    (click)="exportXlsx()"
                  >
                    {{ exporting() ? 'Exporting…' : 'Export XLSX' }}
                  </button>
                </div>
              </div>

              <!-- Chart -->
              <div
                class="mt-4 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-4
                          shadow-[var(--shadow-card)]"
              >
                <bo-report-chart
                  [data]="chartData()"
                  [metricLabel]="chartColumn()?.label ?? ''"
                  [dimensionLabel]="dimensionLabel()"
                  [unit]="chartColumn()?.unit"
                  [provenance]="chartColumn()?.provenanceType"
                  [illustrativeFlag]="chartColumn()?.illustrative ?? false"
                />
              </div>

              <!-- Table -->
              <div
                class="mt-4 overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)]
                          bg-[var(--surface)] shadow-[var(--shadow-card)]"
              >
                <table class="w-full border-collapse text-sm">
                  <caption class="sr-only">
                    {{
                      chartColumn()?.label
                    }}
                    and related metrics by
                    {{
                      dimensionLabel()
                    }}
                    for
                    {{
                      res.meta.period.label
                    }}
                  </caption>
                  <thead>
                    <tr class="border-b border-[var(--line)]">
                      @for (c of res.columns; track c.key) {
                        <th
                          scope="col"
                          class="px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em]
                                 text-[var(--ink-muted)]"
                          [class.text-left]="c.kind === 'dimension'"
                          [class.text-right]="c.kind === 'metric'"
                        >
                          <span
                            class="inline-flex items-center gap-1.5"
                            [class.flex-row-reverse]="c.kind === 'metric'"
                          >
                            @if (c.kind === 'metric' && c.provenanceType) {
                              <span
                                class="h-1.5 w-1.5 rounded-full"
                                [style.background]="provVar(c.provenanceType)"
                                [title]="
                                  c.illustrative ? 'Illustrative' : provLabel(c.provenanceType)
                                "
                                aria-hidden="true"
                              ></span>
                            }
                            {{ c.label }}
                          </span>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of res.rows; track rowKey(row)) {
                      <tr
                        class="border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-2)]"
                      >
                        @for (c of res.columns; track c.key) {
                          @if (c.kind === 'dimension') {
                            <th
                              scope="row"
                              class="px-4 py-2.5 text-left font-medium text-[var(--ink-strong)]"
                            >
                              {{ cellOf(row, c.key) }}
                            </th>
                          } @else {
                            <td class="px-4 py-2.5 text-right tabular-nums text-[var(--ink)]">
                              {{ fmt(cellOf(row, c.key), c.unit) }}
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
          ]"
        />
      </div>
    }
  `,
})
export class ReportBuilderComponent implements OnInit {
  private readonly data = inject(ReportsDataService);

  readonly riskBands = RISK_BANDS;

  // Shared recipes — token-only, focus-visible, no raw hex.
  readonly btnPrimary =
    'rounded-[var(--r-md)] bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-[var(--accent-ink)] ' +
    'transition-colors hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-50 ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
  readonly btnGhost =
    'rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-sm font-semibold ' +
    'text-[var(--ink-strong)] transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed ' +
    'disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-[var(--accent)]';
  readonly inputCls =
    'w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm ' +
    'text-[var(--ink-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ' +
    'focus-visible:outline-[var(--accent)]';

  // ── Catalog ──
  readonly catalog = signal<ReportCatalog | null>(null);
  readonly catalogStatus = signal<Status>('loading');
  readonly catalogError = signal('');

  // ── Query state ──
  readonly selectedMetrics = signal<string[]>([]);
  readonly dimension = signal<string>('brand');
  readonly periodId = signal<number>(0);
  // filters
  readonly brandId = signal<number | null>(null);
  readonly regionId = signal<number | null>(null);
  readonly territoryIds = signal<number[]>([]);
  readonly archetype = signal<string | null>(null);
  readonly tenureBand = signal<string | null>(null);
  readonly statusFilter = signal<string | null>(null);
  readonly riskBand = signal<string | null>(null);

  // ── Discovered filter members ──
  readonly brandMembers = signal<DimensionMember[]>([]);
  readonly regionMembers = signal<DimensionMember[]>([]);
  readonly territoryMembers = signal<DimensionMember[]>([]);
  readonly archetypeMembers = signal<DimensionMember[]>([]);
  readonly tenureMembers = signal<DimensionMember[]>([]);
  readonly statusMembers = signal<DimensionMember[]>([]);

  // ── Run state ──
  readonly result = signal<ReportQueryResult | null>(null);
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

  // Only the filters the live catalog actually advertises get a picker.
  readonly facets = computed<FilterFacet[]>(() => {
    const keys = this.catalog()?.filters ?? [];
    const all: FilterFacet[] = [
      {
        filterKey: 'brandId',
        dimKey: 'brand',
        label: 'Brand',
        multi: false,
        members: () => this.brandMembers(),
      },
      {
        filterKey: 'regionId',
        dimKey: 'region',
        label: 'Region',
        multi: false,
        members: () => this.regionMembers(),
      },
      {
        filterKey: 'archetype',
        dimKey: 'archetype',
        label: 'Archetype',
        multi: false,
        members: () => this.archetypeMembers(),
      },
      {
        filterKey: 'tenureBand',
        dimKey: 'tenure_band',
        label: 'Tenure band',
        multi: false,
        members: () => this.tenureMembers(),
      },
      {
        filterKey: 'status',
        dimKey: 'status',
        label: 'Status',
        multi: false,
        members: () => this.statusMembers(),
      },
      {
        filterKey: 'territoryIds',
        dimKey: 'territory',
        label: 'Territory',
        multi: true,
        members: () => this.territoryMembers(),
      },
    ];
    return all.filter((f) => keys.includes(f.filterKey));
  });

  readonly filterCount = computed(() => {
    let n = 0;
    if (this.brandId() != null) n++;
    if (this.regionId() != null) n++;
    if (this.territoryIds().length) n++;
    if (this.archetype()) n++;
    if (this.tenureBand()) n++;
    if (this.statusFilter()) n++;
    if (this.riskBand()) n++;
    return n;
  });

  readonly metricColumns = computed<ReportColumn[]>(
    () => this.result()?.columns.filter((c) => c.kind === 'metric') ?? [],
  );
  readonly dimensionColumn = computed<ReportColumn | undefined>(() =>
    this.result()?.columns.find((c) => c.kind === 'dimension'),
  );
  readonly dimensionLabel = computed(() => {
    const col = this.dimensionColumn();
    if (col) return col.label;
    const d = this.catalog()?.dimensions.find((x) => x.key === this.dimension());
    return d?.label ?? 'Group';
  });
  readonly chartColumn = computed<ReportColumn | undefined>(() => {
    const key = this.chartMetric();
    return this.metricColumns().find((c) => c.key === key) ?? this.metricColumns()[0];
  });
  readonly chartData = computed<ChartDatum[]>(() => {
    const res = this.result();
    const dimCol = this.dimensionColumn();
    const col = this.chartColumn();
    if (!res || !col || !dimCol) return [];
    return res.rows.map((r) => ({
      label: String(this.cellOf(r, dimCol.key) ?? ''),
      value: Number(this.cellOf(r, col.key)) || 0,
    }));
  });

  // Provenance roll-up for the run summary (honesty story).
  readonly measuredCount = computed(
    () =>
      this.result()?.meta.provenance.filter(
        (p) => p.provenanceType === 'measured' && !p.illustrative,
      ).length ?? 0,
  );
  readonly derivedCount = computed(
    () =>
      this.result()?.meta.provenance.filter(
        (p) => (p.provenanceType === 'derived' || p.provenanceType === 'mixed') && !p.illustrative,
      ).length ?? 0,
  );
  readonly illustrativeCount = computed(
    () => this.result()?.meta.provenance.filter((p) => p.illustrative).length ?? 0,
  );

  ngOnInit(): void {
    this.loadCatalog();
    this.loadSavedList();
  }

  loadCatalog(): void {
    this.catalogStatus.set('loading');
    this.data.catalog().subscribe({
      next: (cat) => {
        this.catalog.set(cat);
        this.applyDefaults(cat);
        this.discoverFilters(cat);
        this.catalogStatus.set('ready');
      },
      error: (e) => {
        this.catalogError.set(this.message(e));
        this.catalogStatus.set('error');
      },
    });
  }

  private applyDefaults(cat: ReportCatalog): void {
    const metricKeys = cat.metrics.map((m) => m.key);
    const preferred = PREFERRED_METRICS.filter((k) => metricKeys.includes(k));
    this.selectedMetrics.set(preferred.length ? preferred : metricKeys.slice(0, 3));
    this.dimension.set(
      cat.dimensions.some((d) => d.key === 'brand') ? 'brand' : (cat.dimensions[0]?.key ?? 'brand'),
    );
    const latest = cat.periods.find((p) => p.isLatest) ?? cat.periods[0];
    this.periodId.set(latest?.periodId ?? 0);
  }

  // Discover the members of each id-bearing / categorical filter dimension the
  // catalog advertises (a territory_count-by-dimension probe per facet).
  private discoverFilters(cat: ReportCatalog): void {
    const targets: { dimKey: string; sink: (m: DimensionMember[]) => void }[] = [
      { dimKey: 'brand', sink: (m) => this.brandMembers.set(m) },
      { dimKey: 'region', sink: (m) => this.regionMembers.set(m) },
      { dimKey: 'territory', sink: (m) => this.territoryMembers.set(m) },
      { dimKey: 'archetype', sink: (m) => this.archetypeMembers.set(m) },
      { dimKey: 'tenure_band', sink: (m) => this.tenureMembers.set(m) },
      { dimKey: 'status', sink: (m) => this.statusMembers.set(m) },
    ];
    const present = targets.filter((t) => cat.dimensions.some((d) => d.key === t.dimKey));
    if (!present.length) return;
    const probes: Record<string, Observable<DimensionMember[]>> = {};
    for (const t of present) probes[t.dimKey] = this.data.dimensionMembers(t.dimKey);
    forkJoin(probes).subscribe({
      next: (res) => {
        for (const t of present) if (res[t.dimKey]) t.sink(res[t.dimKey]);
      },
      error: () => {
        /* filters degrade to none; the builder still runs queries */
      },
    });
  }

  private loadSavedList(): void {
    this.data
      .savedList()
      .subscribe({ next: (list) => this.saved.set(list), error: () => this.saved.set([]) });
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
  setDimension(d: string): void {
    this.dimension.set(d);
    this.markDirty();
  }
  setPeriod(ev: Event): void {
    this.periodId.set(Number((ev.target as HTMLSelectElement).value));
    this.markDirty();
  }

  isTerritoryOn(id?: number): boolean {
    return id != null && this.territoryIds().includes(id);
  }
  toggleTerritory(id?: number): void {
    if (id == null) return;
    const cur = this.territoryIds();
    this.territoryIds.set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    this.markDirty();
  }

  facetValue(filterKey: string): string {
    switch (filterKey) {
      case 'brandId':
        return this.brandId() == null ? '' : String(this.brandId());
      case 'regionId':
        return this.regionId() == null ? '' : String(this.regionId());
      case 'archetype':
        return this.archetype() ?? '';
      case 'tenureBand':
        return this.tenureBand() ?? '';
      case 'status':
        return this.statusFilter() ?? '';
      default:
        return '';
    }
  }
  setFacet(f: FilterFacet, ev: Event): void {
    const raw = (ev.target as HTMLSelectElement).value;
    switch (f.filterKey) {
      case 'brandId':
        this.brandId.set(raw === '' ? null : Number(raw));
        break;
      case 'regionId':
        this.regionId.set(raw === '' ? null : Number(raw));
        break;
      case 'archetype':
        this.archetype.set(raw || null);
        break;
      case 'tenureBand':
        this.tenureBand.set(raw || null);
        break;
      case 'status':
        this.statusFilter.set(raw || null);
        break;
    }
    this.markDirty();
  }
  setRiskBand(ev: Event): void {
    const raw = (ev.target as HTMLSelectElement).value;
    this.riskBand.set(raw || null);
    this.markDirty();
  }

  clearFilters(): void {
    this.brandId.set(null);
    this.regionId.set(null);
    this.territoryIds.set([]);
    this.archetype.set(null);
    this.tenureBand.set(null);
    this.statusFilter.set(null);
    this.riskBand.set(null);
    this.markDirty();
  }

  private markDirty(): void {
    if (this.result()) this.dirty.set(true);
  }

  private buildFilters(): ReportFilters {
    const f: ReportFilters = {};
    if (this.brandId() != null) f.brandId = this.brandId();
    if (this.regionId() != null) f.regionId = this.regionId();
    if (this.territoryIds().length) f.territoryIds = [...this.territoryIds()];
    if (this.archetype()) f.archetype = this.archetype();
    if (this.tenureBand()) f.tenureBand = this.tenureBand();
    if (this.statusFilter()) f.status = this.statusFilter();
    if (this.riskBand()) f.riskBand = this.riskBand();
    return f;
  }

  private buildQuery(): ReportQueryRequest {
    return {
      metrics: [...this.selectedMetrics()],
      dimensions: [this.dimension()],
      period: this.periodId(),
      filters: this.buildFilters(),
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
    const cat = this.catalog();
    if (cat) this.applyDefaults(cat);
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
    this.data
      .save({
        name: this.saveName().trim(),
        description: this.describe(),
        definition: this.buildQuery(),
      })
      .subscribe({
        next: (s) => {
          this.saved.set([s, ...this.saved().filter((x) => x.id !== s.id)]);
          this.saveName.set('');
          this.saving.set(false);
        },
        error: () => this.saving.set(false),
      });
  }
  private describe(): string {
    const cat = this.catalog();
    const names = this.selectedMetrics()
      .map((k) => cat?.metrics.find((m) => m.key === k)?.label ?? k)
      .slice(0, 3)
      .join(', ');
    return `${names} by ${this.dimensionLabel().toLowerCase()}`;
  }
  loadSaved(s: SavedReport): void {
    const d = s.definition;
    this.selectedMetrics.set([...d.metrics]);
    this.dimension.set(d.dimensions[0] ?? this.dimension());
    if (d.period != null) this.periodId.set(d.period);
    const f = d.filters ?? {};
    this.brandId.set(f.brandId ?? null);
    this.regionId.set(f.regionId ?? null);
    this.territoryIds.set([...(f.territoryIds ?? [])]);
    this.archetype.set(f.archetype ?? null);
    this.tenureBand.set(f.tenureBand ?? null);
    this.statusFilter.set(f.status ?? null);
    this.riskBand.set(f.riskBand ?? null);
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
    return this.saveName().trim() || `Report by ${this.dimensionLabel()}`;
  }

  // ── View helpers ──
  fmt = (v: number | string | null, unit?: string) => formatValue(v, unit);
  provLabel = (p?: ProvenanceType) => (p ? PROVENANCE_LABEL[p] : '');
  provVar = (p?: ProvenanceType) => (p ? PROVENANCE_VAR[p] : 'var(--ink-muted)');

  /** Read a flat row's cell as a scalar (dimensionKeys is not a column). */
  cellOf(row: ReportRow, key: string): number | string | null {
    const v = row[key];
    return typeof v === 'number' || typeof v === 'string' || v === null ? v : null;
  }
  /** Stable @for key: the dimension member id (or its label) of the row. */
  rowKey(row: ReportRow): string {
    const dimCol = this.dimensionColumn();
    if (!dimCol) return 'total';
    const ids = row.dimensionKeys;
    const idVal = ids && dimCol.hasId ? Object.values(ids)[0] : undefined;
    return String(idVal ?? this.cellOf(row, dimCol.key) ?? '');
  }

  // Conditional Tailwind arbitrary-value classes are built in TS (not via
  // [class.x] bindings) because the nested brackets in `bg-[var(--…)]` confuse the
  // template parser. Static base classes stay in the template; these add state.
  metricLabelClass(key: string): string {
    return this.isMetricOn(key)
      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
      : 'border-[var(--line)]';
  }
  dimBtnClass(active: boolean): string {
    return active ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--ink-muted)]';
  }
  noteClass(severity: string): string {
    return severity === 'warning'
      ? 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--ink)]'
      : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-muted)]';
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
    if (err?.status)
      return `Request failed (HTTP ${err.status}). The reporting service may be unavailable.`;
    return err?.message || 'Something went wrong. Please try again.';
  }
}
