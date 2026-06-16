import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Reserves layout height (no shift) while a panel loads. Variants match the
 *  three shapes on the page: KPI row, chart/insight panel, table. */
@Component({
  selector: 'app-loading-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (variant()) {
      @case ('kpi') {
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-hidden="true">
          @for (i of [1,2,3,4,5]; track i) {
            <div class="h-36 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
              <div class="h-3 w-20 rounded bg-[var(--surface-3)]"></div>
              <div class="mt-3 h-8 w-24 rounded bg-[var(--surface-3)]"></div>
              <div class="mt-4 h-2 w-full rounded bg-[var(--surface-2)]"></div>
            </div>
          }
        </div>
      }
      @case ('panel') {
        <div class="h-64 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5" aria-hidden="true">
          <div class="h-4 w-32 rounded bg-[var(--surface-3)]"></div>
          <div class="mt-6 h-40 w-full rounded bg-[var(--surface-2)]"></div>
        </div>
      }
      @case ('table') {
        <div class="animate-pulse rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5" aria-hidden="true">
          <div class="h-4 w-40 rounded bg-[var(--surface-3)]"></div>
          @for (i of [1,2,3,4,5]; track i) {
            <div class="mt-4 h-6 w-full rounded bg-[var(--surface-2)]"></div>
          }
        </div>
      }
    }
    <span class="sr-only">Loading…</span>
  `,
})
export class LoadingSkeletonComponent {
  readonly variant = input.required<'kpi' | 'panel' | 'table'>();
}
