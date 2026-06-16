import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ActionRowDto } from '../dashboard.models';
import { formatCurrencyCents, formatDateTimeShort } from '../utils/number-format.util';

/** Slide-over detail for a selected action row: the appointment, its workflow
 *  stage, and the recommended next action. Closes on backdrop / Esc / button.
 *  "Send deposit link" emits to the page, which calls ApiService.deposit(...);
 *  busy/error are driven back in so the drawer shows in-flight + failure state. */
@Component({
  selector: 'app-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (row(); as r) {
      <div class="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Appointment detail">
        <div class="absolute inset-0 bg-black/50" (click)="busy() || close.emit()"></div>

        <aside class="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-[var(--surface)] shadow-[var(--shadow-pop)]">
          <header class="flex items-start justify-between border-b border-[var(--line)] px-5 py-4">
            <div>
              <h2 class="text-lg font-semibold text-[var(--ink-strong)]">{{ r.customerName }}</h2>
              <p class="text-sm text-[var(--ink-muted)]">Appointment #{{ r.appointmentId }} · {{ r.territoryName }}</p>
            </div>
            <button type="button" (click)="close.emit()" aria-label="Close"
              class="rounded-lg p-1.5 text-[var(--ink-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">✕</button>
          </header>

          <div class="flex-1 space-y-5 overflow-y-auto px-5 py-5 text-sm">
            <dl class="grid grid-cols-2 gap-4">
              <div><dt class="text-[var(--ink-muted)]">Service</dt><dd class="mt-0.5 font-medium text-[var(--ink-strong)]">{{ r.service }}</dd></div>
              <div><dt class="text-[var(--ink-muted)]">When</dt><dd class="mt-0.5 font-medium text-[var(--ink-strong)]">{{ when(r.startUtc) }}</dd></div>
              <div><dt class="text-[var(--ink-muted)]">Workflow stage</dt><dd class="mt-0.5 font-medium text-[var(--ink-strong)]">{{ r.stage }}</dd></div>
              <div><dt class="text-[var(--ink-muted)]">Deposit</dt><dd class="mt-0.5 font-medium text-[var(--ink-strong)]">{{ r.depositPaid ? deposit(r.depositCents) : 'Unpaid' }}</dd></div>
            </dl>

            <div class="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p class="text-xs font-semibold uppercase tracking-wide text-[var(--accent-text)]">Recommended next action</p>
              <p class="mt-1 text-[var(--ink)]">{{ r.recommendedAction }}</p>
            </div>
          </div>

          <footer class="flex flex-col gap-2 border-t border-[var(--line)] px-5 py-4">
            @if (error()) {
              <p class="rounded-lg bg-[var(--critical-soft)] px-3 py-2 text-sm text-[var(--critical)]" role="alert">{{ error() }}</p>
            }
            <div class="flex gap-2">
              @if (!r.depositPaid) {
                <button type="button" (click)="sendDeposit.emit(r)" [disabled]="busy()"
                  class="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
                  {{ busy() ? 'Sending…' : 'Send deposit link' }}
                </button>
              }
              <button type="button" (click)="close.emit()" [disabled]="busy()"
                class="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:opacity-60">
                Close
              </button>
            </div>
          </footer>
        </aside>
      </div>
    }
  `,
  host: { '(document:keydown.escape)': 'onEsc()' },
})
export class DetailDrawerComponent {
  readonly row = input.required<ActionRowDto | null>();
  readonly busy = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly close = output<void>();
  readonly sendDeposit = output<ActionRowDto>();

  onEsc(): void {
    if (this.row() && !this.busy()) this.close.emit();
  }
  when(iso: string): string { return formatDateTimeShort(iso); }
  deposit(cents: number): string { return formatCurrencyCents(cents); }
}
