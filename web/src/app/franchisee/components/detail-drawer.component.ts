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
        <div class="absolute inset-0 bg-slate-900/30" (click)="busy() || close.emit()"></div>

        <aside class="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl">
          <header class="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">{{ r.customerName }}</h2>
              <p class="text-sm text-slate-500">Appointment #{{ r.appointmentId }} · {{ r.territoryName }}</p>
            </div>
            <button type="button" (click)="close.emit()" aria-label="Close"
              class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
          </header>

          <div class="flex-1 space-y-5 overflow-y-auto px-5 py-5 text-sm">
            <dl class="grid grid-cols-2 gap-4">
              <div><dt class="text-slate-500">Service</dt><dd class="mt-0.5 font-medium text-slate-900">{{ r.service }}</dd></div>
              <div><dt class="text-slate-500">When</dt><dd class="mt-0.5 font-medium text-slate-900">{{ when(r.startUtc) }}</dd></div>
              <div><dt class="text-slate-500">Workflow stage</dt><dd class="mt-0.5 font-medium text-slate-900">{{ r.stage }}</dd></div>
              <div><dt class="text-slate-500">Deposit</dt><dd class="mt-0.5 font-medium text-slate-900">{{ r.depositPaid ? deposit(r.depositCents) : 'Unpaid' }}</dd></div>
            </dl>

            <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Recommended next action</p>
              <p class="mt-1 text-slate-800">{{ r.recommendedAction }}</p>
            </div>
          </div>

          <footer class="flex flex-col gap-2 border-t border-slate-100 px-5 py-4">
            @if (error()) {
              <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{{ error() }}</p>
            }
            <div class="flex gap-2">
              @if (!r.depositPaid) {
                <button type="button" (click)="sendDeposit.emit(r)" [disabled]="busy()"
                  class="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                  {{ busy() ? 'Sending…' : 'Send deposit link' }}
                </button>
              }
              <button type="button" (click)="close.emit()" [disabled]="busy()"
                class="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                Close
              </button>
            </div>
          </footer>
        </aside>
      </div>
    }
  `,
  // Re-assert slate heading colour over the global dark-dashboard \`h1..h4\` rule
  // (near-white --ink-0) that would otherwise ghost this title on the light panel.
  styles: [`h2 { color: #0f172a; }`], // slate-900
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
