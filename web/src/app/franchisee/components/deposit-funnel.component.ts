import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ActionStageFilter, FunnelStageDto } from '../dashboard.models';
import { formatCount, formatPercent } from '../utils/number-format.util';

/**
 * Deposit funnel mirroring the Durable booking workflow:
 *   Booked → Reminded → DepositPaid → Finalized   (Expired = leak, shown apart)
 * Each stage is clickable → drills the action table to that stage. The biggest
 * conversion drop is the operator's leak; Expired is called out in red+text.
 */
@Component({
  selector: 'app-deposit-funnel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-2">
      @for (s of flowStages(); track s.stage) {
        <button type="button" (click)="drill.emit(s.drillTo)"
          class="group relative w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-left shadow-sm transition hover:border-[var(--accent)] hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          <!-- soft HFC fill = this stage's share of the top stage, so the funnel
               narrowing reads at a glance instead of a flat grey box -->
          <span class="pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
                [style.width.%]="widthPct(s.count)" [style.background]="fill()"></span>

          <div class="relative flex items-center justify-between">
            <span class="text-sm font-medium text-[var(--ink)]">{{ s.stage }}</span>
            <span class="tabular-nums text-lg font-semibold text-[var(--ink-strong)]">{{ count(s.count) }}</span>
          </div>
          @if (s.conversionFromPrev !== null) {
            <p class="relative mt-1 text-xs" [class]="s.conversionFromPrev < 0.7 ? 'text-[var(--critical)] font-medium' : 'text-[var(--ink-muted)]'">
              {{ pct(s.conversionFromPrev) }} retained from previous
              @if (s.conversionFromPrev < 0.7) { · biggest leak }
            </p>
          }

          <!-- crisp meter at the base: amber→orange normally, maroon on the leak stage -->
          <span class="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-[var(--surface-3)]"></span>
          <span class="pointer-events-none absolute bottom-0 left-0 h-1 rounded-r-full transition-[width] duration-500 ease-out"
                [style.width.%]="widthPct(s.count)"
                [style.background]="s.conversionFromPrev !== null && s.conversionFromPrev < 0.7 ? 'var(--critical)' : 'linear-gradient(90deg, var(--accent), var(--accent-2))'"></span>
        </button>
      }

      <!-- leak branch -->
      @if (leak(); as lk) {
        <div class="mt-3 flex items-center justify-between rounded-lg border border-[var(--critical)]/40 bg-[var(--critical-soft)] p-2.5">
          <div>
            <p class="text-sm font-semibold text-[var(--critical)]">⚠ {{ lk.stage }} (leak)</p>
            <p class="text-xs text-[var(--ink-muted)]">Booked but expired without a deposit.</p>
          </div>
          <button type="button" (click)="drill.emit(lk.drillTo)"
            class="rounded-md bg-[var(--accent-deep)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90">
            {{ count(lk.count) }} to recover →
          </button>
        </div>
      }
    </div>
  `,
})
export class DepositFunnelComponent {
  readonly stages = input.required<FunnelStageDto[]>();
  readonly drill = output<ActionStageFilter>();

  flowStages(): FunnelStageDto[] {
    return this.stages().filter((s) => !s.isLeak);
  }
  leak(): FunnelStageDto | null {
    return this.stages().find((s) => s.isLeak) ?? null;
  }
  private top(): number {
    return Math.max(1, ...this.flowStages().map((s) => s.count));
  }
  widthPct(count: number): number {
    return (count / this.top()) * 100;
  }
  /** Soft left-anchored HFC gradient behind a stage row (amber → orange), kept
   *  translucent so the label/count stay legible over it on either theme. */
  fill(): string {
    return 'linear-gradient(90deg, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent-2) 14%, transparent))';
  }
  count(n: number): string {
    return formatCount(n);
  }
  pct(r: number): string {
    return formatPercent(r);
  }
}
