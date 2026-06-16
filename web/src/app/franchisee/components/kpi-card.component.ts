import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DataQualityBadgeComponent } from './data-quality-badge.component';
import { ActionStageFilter, KpiCardVm, MetricStatus } from '../dashboard.models';

/** Presentational KPI tile. Value/delta are pre-formatted by the page (no logic
 *  in the template). Clickable → emits its drill target. Status is shown with a
 *  left accent bar AND text, never colour alone. */
@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [DataQualityBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      (click)="drill.emit(kpi().drillTo)"
      class="group relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 text-left shadow-[var(--shadow-card)] transition hover:border-[var(--accent)] hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      [title]="kpi().tooltip"
    >
      <span class="absolute inset-y-3 left-0 w-1 rounded-full" [class]="accentClass()"></span>

      <div class="flex items-start justify-between gap-2 pl-2">
        <p class="text-sm font-medium text-[var(--ink-muted)]">{{ kpi().label }}</p>
        <app-data-quality-badge [quality]="kpi().dataQuality" />
      </div>

      <p
        class="mt-2 pl-2 text-3xl font-semibold tracking-tight tabular-nums"
        [class]="kpi().isEmpty ? 'text-[var(--ink-faint)]' : 'text-[var(--ink-strong)]'"
      >
        {{ kpi().isEmpty ? '—' : kpi().formattedValue }}
      </p>

      <div class="mt-2 flex items-center gap-2 pl-2 text-sm">
        @if (kpi().isEmpty) {
          <span class="text-[var(--ink-muted)]">{{ kpi().emptyLabel }}</span>
        } @else if (kpi().deltaLabel) {
          <span class="rounded-full px-2 py-0.5 font-medium" [class]="deltaClass()">
            <span aria-hidden="true">{{ directionGlyph() }}</span> {{ kpi().deltaLabel }}
          </span>
          <span class="text-[var(--ink-muted)]">vs last period</span>
        } @else {
          <span class="text-[var(--ink-faint)]">No comparison</span>
        }
      </div>

      <!-- inline sparkline (zero-dependency). Suppressed for empty tiles so a flat
           zero line never reads as a measured trend. -->
      @if (!kpi().isEmpty && sparkPoints()) {
        <svg class="mt-3 ml-2 h-8 w-full text-[var(--accent)]/60" [attr.viewBox]="'0 0 100 32'" preserveAspectRatio="none" aria-hidden="true">
          <polyline [attr.points]="sparkPoints()" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      } @else {
        <div class="mt-3 h-8" aria-hidden="true"></div>
      }
    </button>
  `,
})
export class KpiCardComponent {
  readonly kpi = input.required<KpiCardVm>();
  readonly drill = output<ActionStageFilter>();

  private statusToColour(s: MetricStatus): string {
    return s === 'good' ? 'bg-[var(--good)]'
      : s === 'warning' ? 'bg-[var(--warning)]'
      : s === 'bad' ? 'bg-[var(--critical)]'
      : 'bg-[var(--line-strong)]';
  }

  readonly accentClass = computed(() => this.statusToColour(this.kpi().status));

  readonly deltaClass = computed(() => {
    switch (this.kpi().deltaStatus) {
      case 'good': return 'bg-[var(--good-soft)] text-[var(--good)]';
      case 'bad': return 'bg-[var(--critical-soft)] text-[var(--critical)]';
      case 'warning': return 'bg-[var(--warning-soft)] text-[var(--warning)]';
      default: return 'bg-[var(--neutral-soft)] text-[var(--ink-muted)]';
    }
  });

  /** Glyph shows the DIRECTION of change (sign of the delta), never good/bad.
   *  Colour (deltaClass) carries good/bad, so e.g. "Expired +20%" is ▲ in red
   *  and "Fill −1.2%" is ▼ in red — the arrow always agrees with the sign. */
  readonly directionGlyph = computed(() => {
    switch (this.kpi().deltaDirection) {
      case 'up': return '▲';
      case 'down': return '▼';
      default: return '—';
    }
  });

  /** map the trend series into an SVG polyline in a 0..100 / 0..32 box */
  readonly sparkPoints = computed(() => {
    const t = this.kpi().trend;
    if (!t || t.length < 2) return '';
    const min = Math.min(...t), max = Math.max(...t);
    const span = max - min || 1;
    return t
      .map((v, i) => {
        const x = (i / (t.length - 1)) * 100;
        const y = 30 - ((v - min) / span) * 28; // pad 2px top/bottom, invert
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });
}
