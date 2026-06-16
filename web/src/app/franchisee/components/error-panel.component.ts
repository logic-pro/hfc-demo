import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Recoverable error: plain-language message + Retry, scoped to one section. */
@Component({
  selector: 'app-error-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-xl border border-[var(--critical)]/40 bg-[var(--critical-soft)] p-4" role="alert">
      <h3 class="text-sm font-semibold text-[var(--critical)]">{{ title() }}</h3>
      <p class="mt-1 text-sm text-[var(--ink)]">{{ message() }}</p>
      <button type="button" (click)="retry.emit()"
        class="mt-3 rounded-lg bg-[var(--accent-deep)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90">
        Retry
      </button>
    </div>
  `,
})
export class ErrorPanelComponent {
  readonly title = input<string>('Unable to load the dashboard');
  readonly message = input<string>('Something went wrong fetching this view. Check the API and try again.');
  readonly retry = output<void>();
}
