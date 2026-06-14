import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { PeriodType } from '../dashboard.models';

/** Period + territory filters. Emits changes; the page owns the state and
 *  persists it into drill-downs. Keyboard-usable, wraps on mobile. */
@Component({
  selector: 'app-filter-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-3">
      <!-- period segmented control -->
      <div class="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Period">
        @for (p of periods; track p.value) {
          <button
            type="button"
            (click)="periodChange.emit(p.value)"
            [attr.aria-pressed]="period() === p.value"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition"
            [class]="period() === p.value
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'"
          >{{ p.label }}</button>
        }
      </div>

      <!-- territory select -->
      <label class="inline-flex items-center gap-2 text-sm text-slate-600">
        <span class="sr-only sm:not-sr-only">Territory</span>
        <select
          class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          [value]="territoryId() ?? ''"
          (change)="onTerritory($event)"
        >
          <option value="">All territories</option>
          @for (t of territories(); track t.id) {
            <option [value]="t.id">{{ t.name }}</option>
          }
        </select>
      </label>
    </div>
  `,
})
export class FilterBarComponent {
  readonly period = input.required<PeriodType>();
  readonly territoryId = input.required<number | null>();
  readonly territories = input.required<{ id: number; name: string }[]>();

  readonly periodChange = output<PeriodType>();
  readonly territoryChange = output<number | null>();

  readonly periods: { value: PeriodType; label: string }[] = [
    { value: 'WTD', label: 'Week' },
    { value: 'MTD', label: 'Month' },
    { value: 'QTD', label: 'Quarter' },
    { value: 'YTD', label: 'Year' },
  ];

  onTerritory(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.territoryChange.emit(v ? Number(v) : null);
  }
}
