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
      class="group relative flex h-full w-full flex-col rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-slate-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      [title]="kpi().tooltip"
    >
      <span class="absolute inset-y-3 left-0 w-1 rounded-full" [class]="accentClass()"></span>

      <div class="flex items-start justify-between gap-2 pl-2">
        <p class="text-sm font-medium text-slate-500">{{ kpi().label }}</p>
        <app-data-quality-badge [quality]="kpi().dataQuality" />
      </div>

      <p
        class="mt-2 pl-2 text-3xl font-semibold tracking-tight tabular-nums"
        [class]="kpi().isEmpty ? 'text-slate-400' : 'text-slate-900'"
      >
        {{ kpi().isEmpty ? '—' : kpi().formattedValue }}
      </p>

      <div class="mt-2 flex items-center gap-2 pl-2 text-sm">
        @if (kpi().isEmpty) {
          <span class="text-slate-500">{{ kpi().emptyLabel }}</span>
        } @else if (kpi().deltaLabel) {
          <span class="rounded-full px-2 py-0.5 font-medium" [class]="deltaClass()">
            <span aria-hidden="true">{{ directionGlyph() }}</span> {{ kpi().deltaLabel }}
          </span>
          <span class="text-slate-500">vs last period</span>
        } @else {
          <span class="text-slate-400">No comparison</span>
        }
      </div>

      <!-- inline sparkline (zero-dependency). Suppressed for empty tiles so a flat
           zero line never reads as a measured trend. -->
      @if (!kpi().isEmpty && sparkPoints()) {
        <svg class="mt-3 ml-2 h-8 w-full text-slate-400" [attr.viewBox]="'0 0 100 32'" preserveAspectRatio="none" aria-hidden="true">
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
    return s === 'good' ? 'bg-emerald-500'
      : s === 'warning' ? 'bg-amber-500'
      : s === 'bad' ? 'bg-red-500'
      : 'bg-slate-300';
  }

  readonly accentClass = computed(() => this.statusToColour(this.kpi().status));

  readonly deltaClass = computed(() => {
    switch (this.kpi().deltaStatus) {
      case 'good': return 'bg-emerald-50 text-emerald-700';
      case 'bad': return 'bg-red-50 text-red-700';
      case 'warning': return 'bg-amber-50 text-amber-700';
      default: return 'bg-slate-100 text-slate-600';
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
