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
      <div class="inline-flex rounded-lg border border-[var(--line)] bg-[var(--surface)] p-0.5" role="group" aria-label="Period">
        @for (p of periods; track p.value) {
          <button
            type="button"
            (click)="periodChange.emit(p.value)"
            [attr.aria-pressed]="period() === p.value"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition"
            [class]="period() === p.value
              ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
              : 'text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'"
          >{{ p.label }}</button>
        }
      </div>

      <!-- territory select -->
      <label class="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
        <span class="sr-only sm:not-sr-only">Territory</span>
        <select
          class="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
