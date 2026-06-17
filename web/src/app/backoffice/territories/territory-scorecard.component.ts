import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { DashboardDataService } from '../../dashboard/dashboard-data.service';
import {
  Driver,
  ScoreStatus,
  SubScoreKey,
  TerritoryHealthScore,
  WatchlistFlag,
} from '../../dashboard/dashboard.models';
import { RadialGaugeComponent } from '../../dashboard/ui/radial-gauge';
import { PROVENANCE_BLURB, PROVENANCE_LABEL, band, bandVar } from '../../dashboard/ui/health';

interface SubBar {
  readonly key: SubScoreKey;
  readonly label: string;
  readonly value: number | null;
}

const STATUS_LABEL: Record<ScoreStatus, string> = {
  complete: 'Score complete',
  partial: 'Partial — some inputs pending',
  pending_financial_reporting: 'Financial reporting pending',
};

const SUBSCORE_LABEL: Record<SubScoreKey, string> = {
  financial: 'Financial',
  customer: 'Customer',
  growth: 'Growth',
  compliance: 'Compliance',
};

/**
 * Territory Scorecard (Back-Office Wave 1) — one territory's full health picture,
 * the drill-down target of the explorer (route /back-office/territories/:id).
 *
 * It answers "exactly where is THIS territory at, and why": the composite health
 * score as an animated gauge, the four sub-scores (financial may be honestly
 * pending — never fabricated), the ranked ± drivers behind the score with a
 * provenance badge on each (Measured / Reported / Illustrative — so NPS, bookings
 * and deposits never read as harder data than they are), the open at-risk flags
 * from the watchlist, and any score notes the read model attached.
 *
 * Reuses the corporate dashboard's read model verbatim (GET
 * /api/territories/:id/health-score + /api/dashboard/watchlist) and its radial
 * gauge / health language, so the back office reads as the same product. Scope is
 * enforced server-side: a caller can only open a territory inside their scope.
 *
 * On a deliberate omission: the contract carries no per-territory time series, so
 * there is no historical trend line here — fabricating one would betray the
 * product's measured-vs-illustrative honesty. Drivers are shown against their
 * benchmark instead, which is a real, sourced comparison. (A trend would need an
 * additive read-model endpoint — routed to the API lane, not invented here.)
 */
@Component({
  selector: 'bo-territory-scorecard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RadialGaugeComponent],
  template: `
    <a
      routerLink=".."
      class="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink-muted)] transition-colors
             hover:text-[var(--accent-text)] focus-visible:outline focus-visible:outline-2
             focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
      <span aria-hidden="true">←</span> All territories
    </a>

    <!-- Loading -->
    @if (loading()) {
      <div class="mt-5 animate-pulse" aria-hidden="true">
        <div class="h-7 w-64 rounded bg-[var(--surface-2)]"></div>
        <div class="mt-3 h-4 w-40 rounded bg-[var(--surface-2)]"></div>
        <div class="mt-6 grid gap-4 lg:grid-cols-[auto_1fr]">
          <div class="h-44 w-44 rounded-full bg-[var(--surface-2)]"></div>
          <div class="flex flex-col gap-3">
            @for (i of [1, 2, 3, 4]; track i) { <div class="h-9 rounded bg-[var(--surface-2)]"></div> }
          </div>
        </div>
      </div>
      <p class="mt-3 text-sm text-[var(--ink-muted)]" role="status">Loading scorecard…</p>
    }

    <!-- Error / not found -->
    @if (error()) {
      <div
        class="mt-5 flex flex-col items-start gap-3 rounded-[var(--r-lg)] border border-[var(--critical)]/40
               bg-[var(--critical-soft)] px-5 py-4"
        role="alert">
        <p class="text-sm font-medium text-[var(--ink-strong)]">{{ error() }}</p>
        <div class="flex gap-2">
          <button type="button" class="bo-btn" (click)="reload()">Try again</button>
          <a routerLink=".." class="bo-btn">Back to explorer</a>
        </div>
      </div>
    }

    <!-- Loaded -->
    @if (score(); as s) {
      <header class="mt-4 border-b border-[var(--line)] pb-5">
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">Territory scorecard</p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">{{ s.territoryName }}</h1>
        <p class="mt-1 text-sm text-[var(--ink-muted)]">
          {{ s.brandName }} <span class="text-[var(--ink-faint)]">·</span> {{ s.regionName }}
        </p>
      </header>

      <div class="mt-6 grid gap-6 lg:grid-cols-[auto_1fr] lg:gap-8">
        <!-- Composite gauge + status -->
        <section class="flex flex-col items-center gap-3 rounded-[var(--r-lg)] border border-[var(--line)]
                        bg-[var(--surface)] px-6 py-6 shadow-[var(--shadow-card)]">
          <ec-radial-gauge [value]="s.scores.composite" [size]="168" sublabel="Composite" />
          <span class="bo-status" [attr.data-status]="s.scoreStatus">{{ statusLabel(s.scoreStatus) }}</span>
          <span class="text-[11px] text-[var(--ink-faint)]">{{ s.scoreVersion.scoreVersionId }} · {{ s.scoreVersion.ownerTeam }}</span>
        </section>

        <!-- Sub-scores -->
        <section aria-label="Score breakdown">
          <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">Score breakdown</h2>
          <ul class="mt-3 flex flex-col gap-3.5">
            @for (b of bars(); track b.key) {
              <li>
                <div class="flex items-baseline justify-between text-sm">
                  <span class="text-[var(--ink)]">{{ b.label }}</span>
                  @if (b.value === null) {
                    <span class="text-[12px] font-medium text-[var(--ink-faint)]">Pending</span>
                  } @else {
                    <span class="font-semibold text-[var(--ink-strong)] tnum">{{ b.value }}</span>
                  }
                </div>
                <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  @if (b.value !== null) {
                    <div class="h-full rounded-full" [style.width.%]="b.value" [style.background]="bandVar(b.value)"
                      role="progressbar" [attr.aria-valuenow]="b.value" aria-valuemin="0" aria-valuemax="100"
                      [attr.aria-label]="b.label + ' score'"></div>
                  } @else {
                    <div class="h-full w-full bg-[repeating-linear-gradient(45deg,var(--surface-3),var(--surface-3)_6px,transparent_6px,transparent_12px)]"></div>
                  }
                </div>
              </li>
            }
          </ul>

          @if (s.scoreNotes.length) {
            <ul class="mt-4 flex flex-col gap-1.5">
              @for (n of s.scoreNotes; track n.message) {
                <li class="flex items-start gap-2 text-[12px] text-[var(--ink-muted)]">
                  <span class="mt-0.5 text-[var(--ink-faint)]" aria-hidden="true">ⓘ</span>
                  <span>{{ n.message }}</span>
                </li>
              }
            </ul>
          }
        </section>
      </div>

      <!-- Drivers -->
      <section class="mt-8" aria-label="Score drivers">
        <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">What's moving the score</h2>
        <ul class="mt-3 grid gap-2.5 sm:grid-cols-2">
          @for (d of s.drivers; track d.metricKey) {
            <li class="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3
                       shadow-[var(--shadow-card)]">
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span
                    class="text-sm font-semibold"
                    [style.color]="d.impact === 'positive' ? 'var(--good)' : 'var(--critical)'"
                    aria-hidden="true">{{ d.impact === 'positive' ? '▲' : '▼' }}</span>
                  <span class="text-sm font-medium text-[var(--ink-strong)]">{{ d.label }}</span>
                </div>
                <span class="bo-sev" [attr.data-sev]="d.severity">{{ d.severity }}</span>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <span class="font-semibold text-[var(--ink)] tnum">{{ fmt(d, d.value) }}</span>
                <span class="text-[var(--ink-faint)] tnum">vs {{ fmt(d, d.benchmark) }} benchmark</span>
                <span class="bo-prov" [attr.data-prov]="d.provenanceType" [title]="provBlurb(d)">{{ provLabel(d) }}</span>
              </div>
            </li>
          }
        </ul>
      </section>

      <!-- At-risk flags -->
      <section class="mt-8" aria-label="At-risk flags">
        <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          Open flags{{ flags().length ? ' (' + flags().length + ')' : '' }}
        </h2>
        @if (flags().length === 0) {
          <p class="mt-2 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--good-soft)] px-4 py-3 text-sm
                    text-[var(--ink-muted)]">
            No open flags — this territory has nothing on the watchlist right now.
          </p>
        } @else {
          <ul class="mt-3 flex flex-col gap-2.5">
            @for (f of flags(); track f.watchlistFlagId) {
              <li class="rounded-[var(--r-md)] border-l-[3px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3
                         shadow-[var(--shadow-card)]"
                [style.border-left-color]="severityVar(f.severity)">
                <div class="flex items-start justify-between gap-3">
                  <span class="text-sm font-medium text-[var(--ink-strong)]">{{ f.explanation }}</span>
                  <span class="bo-sev shrink-0" [attr.data-sev]="f.severity">{{ f.severity }}</span>
                </div>
                <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ink-faint)]">
                  <span class="capitalize">{{ f.category }}</span>
                  <span class="tnum">current {{ round(f.currentValue) }} · threshold {{ round(f.thresholdValue) }}</span>
                  <span class="capitalize">{{ f.status }}</span>
                </div>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .bo-btn {
        display: inline-flex; align-items: center; cursor: pointer;
        border-radius: var(--r-md); border: 1px solid var(--line);
        background: var(--surface); padding: 0.45rem 0.8rem;
        font-size: 13px; font-weight: 600; color: var(--ink-muted);
      }
      .bo-btn:hover { border-color: var(--accent); color: var(--ink-strong); }
      .bo-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

      .bo-status {
        display: inline-block; border-radius: 9999px; padding: 0.2rem 0.7rem;
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

      /* Severity tag — high borrows the at-risk maroon/red, low stays calm. */
      .bo-sev {
        display: inline-block; border-radius: 9999px; padding: 0.1rem 0.5rem;
        font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
        border: 1px solid var(--line); background: var(--neutral-soft); color: var(--ink-muted);
      }
      .bo-sev[data-sev='high'] {
        color: var(--critical); background: var(--critical-soft);
        border-color: color-mix(in srgb, var(--critical) 30%, transparent);
      }
      .bo-sev[data-sev='medium'] {
        color: var(--health-warning); background: color-mix(in srgb, var(--health-warning) 12%, transparent);
        border-color: color-mix(in srgb, var(--health-warning) 30%, transparent);
      }

      /* Provenance badge — measured / reported / illustrative, colored by the
         product's provenance tokens so honesty reads at a glance. */
      .bo-prov {
        display: inline-flex; align-items: center; gap: 0.3rem;
        border-radius: 9999px; padding: 0.05rem 0.5rem;
        font-size: 11px; font-weight: 600;
        border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
      }
      .bo-prov[data-prov='measured'] { color: var(--prov-measured); background: color-mix(in srgb, var(--prov-measured) 12%, transparent); }
      .bo-prov[data-prov='reported'] { color: var(--prov-reported); background: color-mix(in srgb, var(--prov-reported) 12%, transparent); }
      .bo-prov[data-prov='seeded'] { color: var(--prov-seeded); background: color-mix(in srgb, var(--prov-seeded) 12%, transparent); }
    `,
  ],
})
export class TerritoryScorecardComponent {
  private readonly data = inject(DashboardDataService);
  private readonly route = inject(ActivatedRoute);

  readonly score = signal<TerritoryHealthScore | null>(null);
  readonly flags = signal<WatchlistFlag[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private currentId = 0;

  constructor() {
    // React to :id changes so "open a neighbour" works without a full remount.
    this.route.paramMap
      .pipe(
        map((p) => Number(p.get('id'))),
        takeUntilDestroyed(),
      )
      .subscribe((id) => this.load(id));
  }

  reload(): void {
    this.load(this.currentId);
  }

  private load(id: number): void {
    this.currentId = id;
    this.loading.set(true);
    this.error.set(null);
    this.score.set(null);

    if (!Number.isFinite(id) || id <= 0) {
      this.loading.set(false);
      this.error.set('That territory id is not valid.');
      return;
    }

    // Health score is the spine; the watchlist annotates it. A watchlist hiccup
    // must not blank the scorecard, so it degrades to an empty flag list.
    forkJoin({
      score: this.data.healthScore(id),
      watchlist: this.data.watchlist().pipe(catchError(() => of({ items: [], totalCount: 0 }))),
    }).subscribe({
      next: ({ score, watchlist }) => {
        // The data seam can resolve a null score (no such territory in scope /
        // not yet wired). Treat that as not-found rather than rendering blank.
        if (!score) {
          this.loading.set(false);
          this.error.set('That territory was not found in your scope.');
          return;
        }
        this.score.set(score);
        this.flags.set(
          watchlist.items
            .filter((f) => f.territoryId === id && f.status !== 'resolved')
            .sort((a, b) => this.sevRank(b.severity) - this.sevRank(a.severity)),
        );
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          err?.status === 404
            ? 'That territory was not found in your scope.'
            : "Couldn't load this territory's scorecard. Please try again.",
        );
      },
    });
  }

  readonly bars = computed<SubBar[]>(() => {
    const s = this.score();
    if (!s) return [];
    return (['financial', 'customer', 'growth', 'compliance'] as SubScoreKey[]).map((key) => ({
      key,
      label: SUBSCORE_LABEL[key],
      value: s.scores[key],
    }));
  });

  // ── Presentation helpers ─────────────────────────────────────────────────
  bandVar(v: number): string {
    return bandVar(band(v));
  }
  statusLabel(s: ScoreStatus): string {
    return STATUS_LABEL[s];
  }
  provLabel(d: Driver): string {
    return PROVENANCE_LABEL[d.provenanceType];
  }
  provBlurb(d: Driver): string {
    return PROVENANCE_BLURB[d.provenanceType];
  }
  round(v: number): string {
    return Math.round(v).toString();
  }

  // Drivers carry heterogeneous units — format by metric shape (mirrors the
  // executive scorecard so the same metric reads the same in both surfaces).
  fmt(d: Driver, v: number): string {
    if (d.metricKey.includes('rate')) return `${(v * 100).toFixed(0)}%`;
    return Math.round(v).toString();
  }

  severityVar(sev: 'high' | 'medium' | 'low'): string {
    return sev === 'high' ? 'var(--critical)' : sev === 'medium' ? 'var(--health-warning)' : 'var(--health-fair)';
  }
  private sevRank(sev: 'high' | 'medium' | 'low'): number {
    return sev === 'high' ? 3 : sev === 'medium' ? 2 : 1;
  }
}
