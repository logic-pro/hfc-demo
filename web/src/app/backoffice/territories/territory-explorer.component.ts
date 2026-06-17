import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TenantService } from '../../tenant.service';
import { DashboardDataService } from '../../dashboard/dashboard-data.service';
import { ScoreStatus, TerritoryListItem, WatchlistFlag } from '../../dashboard/dashboard.models';
import { BAND_LABEL, HealthBand, band, bandVar } from '../../dashboard/ui/health';

type SortKey = 'name' | 'brand' | 'region' | 'score' | 'status' | 'flags';
type SortDir = 'asc' | 'desc';

interface FlagRollup {
  readonly count: number; // open + acknowledged (unresolved) flags
  readonly maxSeverity: 'high' | 'medium' | 'low' | null;
}

interface Row extends TerritoryListItem {
  readonly healthBand: HealthBand;
  readonly flags: FlagRollup;
}

interface Column {
  readonly key: SortKey;
  readonly label: string;
  readonly align?: 'right';
}

const SEVERITY_RANK: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };

// Status copy mirrors the scorecard so the two surfaces speak one language about
// data completeness — never dressing a partial score up as complete.
const STATUS_LABEL: Record<ScoreStatus, string> = {
  complete: 'Complete',
  partial: 'Partial',
  pending_financial_reporting: 'Financials pending',
};

/**
 * Territory Explorer (Back-Office Wave 1) — "exactly where every territory is at."
 *
 * A sortable, filterable list of EVERY territory in the caller's scope: brand,
 * region, composite health, data-completeness status, and the count of open
 * watchlist flags. Built for intervention — it defaults to worst-score-first so
 * the at-risk tail is the first thing a corporate admin sees, and an "At risk"
 * quick filter narrows to the territories that actually need a look. Each row
 * drills into the single-territory scorecard (/back-office/territories/:id).
 *
 * Scope is enforced server-side (RBAC read-down on /api/territories + the JWT):
 * a brand/region persona only ever receives — and only ever renders — their own
 * territories. The brand/region filter options are derived from the rows we
 * actually got back, so a scoped persona never even sees a sibling brand listed.
 *
 * Honest by construction: color only ever means health, the status chip states
 * data completeness plainly, and we never fabricate a metric the read model
 * doesn't provide. Design tokens only — re-skins with the light/dark theme.
 */
@Component({
  selector: 'bo-territory-explorer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <header class="border-b border-[var(--line)] pb-6">
      <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">Territories</p>
      <h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">Territory Explorer</h1>
      <p class="mt-1.5 max-w-prose text-sm text-[var(--ink-muted)]">
        Every territory in
        <span class="font-medium text-[var(--ink)]">{{ tenant.scopeName() || 'your scope' }}</span> —
        sorted worst-health-first so the territories that need attention surface on top. Select a row to open its
        scorecard.
      </p>
    </header>

    <!-- Summary chips: orient before the table. Counts reflect the in-scope set only. -->
    @if (!loading() && !error()) {
      <div class="mt-5 flex flex-wrap gap-2.5" role="group" aria-label="Portfolio summary">
        <span class="bo-chip">
          <span class="font-semibold text-[var(--ink-strong)] tnum">{{ counts().total }}</span> in scope
        </span>
        <button
          type="button"
          class="bo-chip bo-chip--btn"
          [class.bo-chip--on]="atRiskOnly()"
          [attr.aria-pressed]="atRiskOnly()"
          (click)="toggleAtRisk()">
          <span class="h-1.5 w-1.5 rounded-full" [style.background]="'var(--critical)'" aria-hidden="true"></span>
          <span class="font-semibold tnum">{{ counts().atRisk }}</span> at risk
        </button>
        @if (counts().pending) {
          <span class="bo-chip">
            <span class="font-semibold tnum">{{ counts().pending }}</span> financials pending
          </span>
        }
      </div>

      <!-- Filter toolbar -->
      <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label class="flex flex-1 min-w-[12rem] flex-col gap-1">
          <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">Search</span>
          <input
            type="search"
            class="bo-input"
            placeholder="Territory or franchisee…"
            [value]="search()"
            (input)="search.set($any($event.target).value)"
            aria-label="Search territories by name or franchisee" />
        </label>

        @if (brands().length > 1) {
          <label class="flex flex-col gap-1">
            <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">Brand</span>
            <select class="bo-input" [value]="brandFilter() ?? ''" (change)="setBrand($any($event.target).value)"
              aria-label="Filter by brand">
              <option value="">All brands</option>
              @for (b of brands(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
            </select>
          </label>
        }

        @if (regions().length > 1) {
          <label class="flex flex-col gap-1">
            <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">Region</span>
            <select class="bo-input" [value]="regionFilter() ?? ''" (change)="setRegion($any($event.target).value)"
              aria-label="Filter by region">
              <option value="">All regions</option>
              @for (r of regions(); track r.id) { <option [value]="r.id">{{ r.name }}</option> }
            </select>
          </label>
        }

        @if (hasActiveFilter()) {
          <button type="button" class="bo-input bo-input--btn self-end" (click)="clearFilters()">Clear filters</button>
        }
      </div>
    }

    <!-- Loading -->
    @if (loading()) {
      <div class="mt-6 overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)]" aria-hidden="true">
        @for (i of skeletonRows; track i) {
          <div class="flex items-center gap-4 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
            <div class="h-4 w-40 animate-pulse rounded bg-[var(--surface-2)]"></div>
            <div class="h-4 w-24 animate-pulse rounded bg-[var(--surface-2)]"></div>
            <div class="ml-auto h-4 w-16 animate-pulse rounded bg-[var(--surface-2)]"></div>
          </div>
        }
      </div>
      <p class="mt-3 text-sm text-[var(--ink-muted)]" role="status">Loading territories…</p>
    }

    <!-- Error -->
    @if (error()) {
      <div
        class="mt-6 flex flex-col items-start gap-3 rounded-[var(--r-lg)] border border-[var(--critical)]/40
               bg-[var(--critical-soft)] px-5 py-4"
        role="alert">
        <p class="text-sm font-medium text-[var(--ink-strong)]">Couldn't load territories</p>
        <p class="text-sm text-[var(--ink-muted)]">{{ error() }}</p>
        <button type="button" class="bo-input bo-input--btn" (click)="reload()">Try again</button>
      </div>
    }

    <!-- Loaded -->
    @if (!loading() && !error()) {
      @if (rows().length === 0) {
        <div
          class="mt-6 rounded-[var(--r-lg)] border border-dashed border-[var(--line-strong)] bg-[var(--surface)]
                 px-6 py-12 text-center"
          role="status">
          <p class="text-sm font-medium text-[var(--ink-strong)]">No territories match your filters</p>
          <p class="mt-1 text-sm text-[var(--ink-muted)]">
            {{ all().length ? 'Try clearing a filter to widen the list.' : 'There are no territories in your scope yet.' }}
          </p>
          @if (hasActiveFilter()) {
            <button type="button" class="bo-input bo-input--btn mx-auto mt-4" (click)="clearFilters()">Clear filters</button>
          }
        </div>
      } @else {
        <div class="mt-5 overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)] shadow-[var(--shadow-card)]">
          <table class="w-full min-w-[44rem] border-collapse text-sm">
            <caption class="sr-only">Territories in scope, sortable. {{ rows().length }} shown.</caption>
            <thead>
              <tr class="bg-[var(--surface-2)] text-left">
                @for (col of columns; track col.key) {
                  <th
                    scope="col"
                    class="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]"
                    [class.text-right]="col.align === 'right'"
                    [attr.aria-sort]="ariaSort(col.key)">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 hover:text-[var(--ink-strong)]
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                             focus-visible:outline-[var(--accent)]"
                      [class.text-[var(--ink-strong)]]="sortKey() === col.key"
                      (click)="sortBy(col.key)">
                      <span>{{ col.label }}</span>
                      <span class="text-[var(--accent-text)]" aria-hidden="true">{{ sortGlyph(col.key) }}</span>
                    </button>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.territoryId) {
                <tr
                  class="cursor-pointer border-t border-[var(--line)] transition-colors hover:bg-[var(--surface-2)]
                         focus-within:bg-[var(--surface-2)]">
                  <!-- Territory: the whole-row link lives here for keyboard + pointer reach. -->
                  <th scope="row" class="px-4 py-3 text-left font-normal">
                    <a
                      [routerLink]="[r.territoryId]"
                      class="flex flex-col focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                             focus-visible:outline-[var(--accent)]"
                      [attr.aria-label]="'Open scorecard for ' + r.territoryName">
                      <span class="font-medium text-[var(--ink-strong)]">{{ r.territoryName }}</span>
                      <span class="text-[12px] text-[var(--ink-faint)]">{{ r.franchiseeName }}</span>
                    </a>
                  </th>
                  <td class="px-4 py-3 text-[var(--ink-muted)]">{{ r.brandName }}</td>
                  <td class="px-4 py-3 text-[var(--ink-muted)]">{{ r.regionName }}</td>
                  <!-- Composite: score + health-banded bar. Color === health, always. -->
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2.5">
                      <span class="w-7 text-right font-semibold text-[var(--ink-strong)] tnum">{{ r.compositeScore }}</span>
                      <span class="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-3)]" aria-hidden="true">
                        <span class="block h-full rounded-full"
                          [style.width.%]="r.compositeScore" [style.background]="bandVar(r.healthBand)"></span>
                      </span>
                      <span class="text-[12px] text-[var(--ink-faint)]">{{ bandLabel(r.healthBand) }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <span class="bo-status" [attr.data-status]="r.scoreStatus">{{ statusLabel(r.scoreStatus) }}</span>
                  </td>
                  <!-- Open flags: the intervention signal. 0 reads calm; >0 carries severity color. -->
                  <td class="px-4 py-3 text-right">
                    @if (r.flags.count > 0) {
                      <span
                        class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold"
                        [style.color]="severityVar(r.flags.maxSeverity)"
                        [style.background]="'color-mix(in srgb, ' + severityVar(r.flags.maxSeverity) + ' 12%, transparent)'">
                        <span class="h-1.5 w-1.5 rounded-full" [style.background]="severityVar(r.flags.maxSeverity)"
                          aria-hidden="true"></span>
                        {{ r.flags.count }}
                      </span>
                    } @else {
                      <span class="text-[12px] text-[var(--ink-faint)]">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-3 text-[12px] text-[var(--ink-faint)]">
          Scoped to your access · {{ rows().length }} of {{ all().length }} territories shown
        </p>
      }
    }
  `,
  styles: [
    `
      :host { display: block; }
      .bo-chip {
        display: inline-flex; align-items: center; gap: 0.4rem;
        border-radius: 9999px; border: 1px solid var(--line);
        background: var(--surface); padding: 0.3rem 0.75rem;
        font-size: 12px; color: var(--ink-muted);
      }
      .bo-chip--btn { cursor: pointer; transition: border-color var(--t-fast), background var(--t-fast); }
      .bo-chip--btn:hover { border-color: var(--accent); }
      .bo-chip--on { border-color: var(--critical); background: var(--critical-soft); color: var(--ink-strong); }
      .bo-chip--btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

      .bo-input {
        border-radius: var(--r-md); border: 1px solid var(--line);
        background: var(--surface); padding: 0.5rem 0.7rem;
        font-size: 14px; color: var(--ink); min-height: 2.4rem;
      }
      .bo-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
      .bo-input--btn { cursor: pointer; font-weight: 600; color: var(--ink-muted); }
      .bo-input--btn:hover { border-color: var(--accent); color: var(--ink-strong); }

      /* Data-completeness chip. Calm by default; only 'pending' borrows a warning tint. */
      .bo-status {
        display: inline-block; border-radius: 9999px; padding: 0.15rem 0.55rem;
        font-size: 11px; font-weight: 600; border: 1px solid var(--line);
        background: var(--neutral-soft); color: var(--ink-muted);
      }
      .bo-status[data-status='complete'] {
        color: var(--good); background: var(--good-soft);
        border-color: color-mix(in srgb, var(--good) 30%, transparent);
      }
      .bo-status[data-status='pending_financial_reporting'] {
        color: var(--health-warning); background: color-mix(in srgb, var(--health-warning) 12%, transparent);
        border-color: color-mix(in srgb, var(--health-warning) 30%, transparent);
      }
    `,
  ],
})
export class TerritoryExplorerComponent {
  readonly tenant = inject(TenantService);
  private readonly data = inject(DashboardDataService);

  readonly skeletonRows = Array.from({ length: 6 }, (_, i) => i);

  readonly columns: readonly Column[] = [
    { key: 'name', label: 'Territory' },
    { key: 'brand', label: 'Brand' },
    { key: 'region', label: 'Region' },
    { key: 'score', label: 'Composite' },
    { key: 'status', label: 'Status' },
    { key: 'flags', label: 'Flags', align: 'right' },
  ];

  // ── Raw state ────────────────────────────────────────────────────────────
  readonly all = signal<Row[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // ── Filter + sort state ──────────────────────────────────────────────────
  readonly search = signal('');
  readonly brandFilter = signal<number | null>(null);
  readonly regionFilter = signal<number | null>(null);
  readonly atRiskOnly = signal(false);
  readonly sortKey = signal<SortKey>('score'); // worst-first by default (intervention)
  readonly sortDir = signal<SortDir>('asc');

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    // Two reads, one render: the territory list (scope-filtered server-side) plus
    // the watchlist so each row can show its open-flag count. The list is the
    // source of truth for which territories exist; the watchlist only annotates.
    forkJoin({ territories: this.data.territories(), watchlist: this.data.watchlist() }).subscribe({
      next: ({ territories, watchlist }) => {
        const rollup = this.rollupFlags(watchlist.items);
        const rows: Row[] = territories.items.map((t) => ({
          ...t,
          healthBand: band(t.compositeScore),
          flags: rollup.get(t.territoryId) ?? { count: 0, maxSeverity: null },
        }));
        this.all.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('The territory service did not respond. Check your connection and try again.');
        this.loading.set(false);
      },
    });
  }

  // Count only unresolved flags (open + acknowledged) and track the worst severity.
  private rollupFlags(flags: readonly WatchlistFlag[]): Map<number, FlagRollup> {
    const out = new Map<number, FlagRollup>();
    for (const f of flags) {
      if (f.status === 'resolved') continue;
      const prev = out.get(f.territoryId) ?? { count: 0, maxSeverity: null as FlagRollup['maxSeverity'] };
      const worse =
        prev.maxSeverity === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[prev.maxSeverity]
          ? f.severity
          : prev.maxSeverity;
      out.set(f.territoryId, { count: prev.count + 1, maxSeverity: worse });
    }
    return out;
  }

  // ── Derived option lists (scope-correct: only brands/regions actually present) ─
  readonly brands = computed(() => this.distinct((r) => [r.brandId, r.brandName]));
  readonly regions = computed(() => this.distinct((r) => [r.regionId, r.regionName]));

  private distinct(pick: (r: Row) => [number, string]): { id: number; name: string }[] {
    const map = new Map<number, string>();
    for (const r of this.all()) {
      const [id, name] = pick(r);
      map.set(id, name);
    }
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  readonly counts = computed(() => {
    const rows = this.all();
    return {
      total: rows.length,
      atRisk: rows.filter((r) => this.isAtRisk(r)).length,
      pending: rows.filter((r) => r.scoreStatus === 'pending_financial_reporting').length,
    };
  });

  // "At risk" = an open flag OR a composite in the critical/warning bands. This is
  // the same signal the executive watchlist acts on, applied per-row here.
  private isAtRisk(r: Row): boolean {
    return r.flags.count > 0 || r.healthBand === 'critical' || r.healthBand === 'warning';
  }

  readonly hasActiveFilter = computed(
    () => !!this.search().trim() || this.brandFilter() !== null || this.regionFilter() !== null || this.atRiskOnly(),
  );

  readonly rows = computed<Row[]>(() => {
    const q = this.search().trim().toLowerCase();
    const brand = this.brandFilter();
    const region = this.regionFilter();
    const atRisk = this.atRiskOnly();

    const filtered = this.all().filter((r) => {
      if (brand !== null && r.brandId !== brand) return false;
      if (region !== null && r.regionId !== region) return false;
      if (atRisk && !this.isAtRisk(r)) return false;
      if (q && !`${r.territoryName} ${r.franchiseeName}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const key = this.sortKey();
    return [...filtered].sort((a, b) => dir * this.compare(a, b, key));
  });

  private compare(a: Row, b: Row, key: SortKey): number {
    switch (key) {
      case 'name':
        return a.territoryName.localeCompare(b.territoryName);
      case 'brand':
        return a.brandName.localeCompare(b.brandName) || a.territoryName.localeCompare(b.territoryName);
      case 'region':
        return a.regionName.localeCompare(b.regionName) || a.territoryName.localeCompare(b.territoryName);
      case 'score':
        return a.compositeScore - b.compositeScore;
      case 'status':
        return a.scoreStatus.localeCompare(b.scoreStatus);
      case 'flags':
        return (
          a.flags.count - b.flags.count ||
          SEVERITY_RANK[b.flags.maxSeverity ?? 'low'] - SEVERITY_RANK[a.flags.maxSeverity ?? 'low']
        );
      default:
        return 0;
    }
  }

  // ── Interactions ───────────────────────────────────────────────────────────
  sortBy(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      // Score defaults worst-first (asc); text columns A→Z; flags worst-first (desc).
      this.sortDir.set(key === 'flags' ? 'desc' : 'asc');
    }
  }

  setBrand(v: string): void {
    this.brandFilter.set(v === '' ? null : Number(v));
  }
  setRegion(v: string): void {
    this.regionFilter.set(v === '' ? null : Number(v));
  }
  toggleAtRisk(): void {
    this.atRiskOnly.update((v) => !v);
  }
  clearFilters(): void {
    this.search.set('');
    this.brandFilter.set(null);
    this.regionFilter.set(null);
    this.atRiskOnly.set(false);
  }

  // ── Presentation helpers ─────────────────────────────────────────────────
  bandVar(b: HealthBand): string {
    return bandVar(b);
  }
  bandLabel(b: HealthBand): string {
    return BAND_LABEL[b];
  }
  statusLabel(s: ScoreStatus): string {
    return STATUS_LABEL[s];
  }

  severityVar(sev: FlagRollup['maxSeverity']): string {
    return sev === 'high' ? 'var(--critical)' : sev === 'medium' ? 'var(--health-warning)' : 'var(--health-fair)';
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }
  sortGlyph(key: SortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 'asc' ? '↑' : '↓';
  }
}
