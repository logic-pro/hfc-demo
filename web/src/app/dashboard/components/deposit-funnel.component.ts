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
          class="w-full rounded-lg border border-slate-200 p-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
          <div class="flex items-center justify-between text-sm">
            <span class="font-medium text-slate-700">{{ s.stage }}</span>
            <span class="tabular-nums text-slate-900">{{ count(s.count) }}</span>
          </div>
          <div class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-slate-700" [style.width.%]="widthPct(s.count)"></div>
          </div>
          @if (s.conversionFromPrev !== null) {
            <p class="mt-1 text-xs" [class]="(s.conversionFromPrev ?? 1) < 0.7 ? 'text-red-600 font-medium' : 'text-slate-500'">
              {{ pct(s.conversionFromPrev) }} retained from previous
              @if ((s.conversionFromPrev ?? 1) < 0.7) { · biggest leak }
            </p>
          }
        </button>
      }

      <!-- leak branch -->
      @if (leak(); as lk) {
        <div class="mt-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-2.5">
          <div>
            <p class="text-sm font-semibold text-red-900">⚠ {{ lk.stage }} (leak)</p>
            <p class="text-xs text-red-700">Booked but expired without a deposit.</p>
          </div>
          <button type="button" (click)="drill.emit(lk.drillTo)"
            class="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800">
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
  count(n: number): string {
    return formatCount(n);
  }
  pct(r: number): string {
    return formatPercent(r);
  }
}
