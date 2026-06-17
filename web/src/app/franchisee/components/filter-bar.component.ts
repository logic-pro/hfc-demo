import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { PeriodType } from '../dashboard.models';

/** Period + territory filters. Emits changes; the page owns the state and
 *  persists it into drill-downs. Keyboard-usable, wraps on mobile.
 *  The territory picker is a CUSTOM dropdown (not a native <select>) so the open
 *  menu is themeable — the native option list can't match the dark redesign. */
@Component({
  selector: 'app-filter-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-3">
      <!-- period segmented control -->
      <div class="inline-flex rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm" role="group" aria-label="Period">
        @for (p of periods; track p.value) {
          <button
            type="button"
            (click)="periodChange.emit(p.value)"
            [attr.aria-pressed]="period() === p.value"
            class="rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            [class]="period() === p.value
              ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
              : 'text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'"
          >{{ p.label }}</button>
        }
      </div>

      <!-- territory picker (custom, themeable dropdown) -->
      <div class="relative" (keydown.escape)="close()">
        <button
          type="button"
          (click)="toggle()"
          [attr.aria-expanded]="open()"
          aria-haspopup="listbox"
          class="inline-flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] shadow-sm transition hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          [style.borderColor]="open() ? 'var(--accent)' : 'var(--line)'"
        >
          <span class="text-[var(--ink-muted)]">Territory</span>
          <span class="font-medium">{{ selectedLabel() }}</span>
          <svg class="h-4 w-4 text-[var(--ink-muted)] transition-transform duration-200" [class.rotate-180]="open()"
               viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
          </svg>
        </button>

        @if (open()) {
          <!-- click-away backdrop (invisible — just catches outside clicks) -->
          <button type="button" class="fixed inset-0 z-10 cursor-default border-0 bg-transparent p-0" tabindex="-1" aria-hidden="true" (click)="close()"></button>

          <ul role="listbox" aria-label="Territory"
              class="absolute left-0 z-20 mt-1.5 max-h-72 w-60 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg">
            <li>
              <button type="button" role="option" [attr.aria-selected]="territoryId() === null" (click)="select(null)"
                class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition"
                [class]="territoryId() === null
                  ? 'bg-[var(--accent-soft)] font-medium text-[var(--ink-strong)]'
                  : 'text-[var(--ink)] hover:bg-[var(--surface-2)]'">
                All territories
                @if (territoryId() === null) { <span class="text-[var(--accent)]" aria-hidden="true">✓</span> }
              </button>
            </li>
            @for (t of territories(); track t.id) {
              <li>
                <button type="button" role="option" [attr.aria-selected]="territoryId() === t.id" (click)="select(t.id)"
                  class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition"
                  [class]="territoryId() === t.id
                    ? 'bg-[var(--accent-soft)] font-medium text-[var(--ink-strong)]'
                    : 'text-[var(--ink)] hover:bg-[var(--surface-2)]'">
                  {{ t.name }}
                  @if (territoryId() === t.id) { <span class="text-[var(--accent)]" aria-hidden="true">✓</span> }
                </button>
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
})
export class FilterBarComponent {
  readonly period = input.required<PeriodType>();
  readonly territoryId = input.required<number | null>();
  readonly territories = input.required<{ id: number; name: string }[]>();

  readonly periodChange = output<PeriodType>();
  readonly territoryChange = output<number | null>();

  readonly open = signal(false);

  readonly periods: { value: PeriodType; label: string }[] = [
    { value: 'WTD', label: 'Week' },
    { value: 'MTD', label: 'Month' },
    { value: 'QTD', label: 'Quarter' },
    { value: 'YTD', label: 'Year' },
  ];

  readonly selectedLabel = computed(() => {
    const id = this.territoryId();
    if (id === null) return 'All territories';
    return this.territories().find((t) => t.id === id)?.name ?? 'All territories';
  });

  toggle(): void { this.open.update((v) => !v); }
  close(): void { this.open.set(false); }
  select(id: number | null): void {
    this.territoryChange.emit(id);
    this.close();
  }
}
