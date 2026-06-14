import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Useful empty state: says what's missing and what to do next — never "No data". */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
      <p class="text-sm font-semibold text-slate-700">{{ title() }}</p>
      <p class="mt-1 max-w-sm text-sm text-slate-500">{{ message() }}</p>
    </div>
  `,
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
}
