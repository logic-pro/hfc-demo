import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TerritoryRowDto } from '../dashboard.models';
import { formatCount, formatPercent } from '../utils/number-format.util';

/** Per-territory bars (fill rate + deposit conversion). Click a territory to set
 *  the page filter. Hidden/redundant when a single territory is already focused. */
@Component({
  selector: 'app-territory-breakdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="space-y-3">
      @for (t of rows(); track t.territoryId) {
        <li>
          <button type="button" (click)="select.emit(t.territoryId)"
            class="w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
            <div class="flex items-center justify-between text-sm">
              <span class="font-medium text-slate-800">{{ t.territoryName }}</span>
              <span class="text-slate-500">{{ count(t.bookings) }} bookings
                @if (t.needsActionCount > 0) {
                  · <span class="font-medium text-amber-700">{{ t.needsActionCount }} need action</span>
                }
              </span>
            </div>
            <div class="mt-1.5 grid grid-cols-2 gap-3">
              <div>
                <div class="flex justify-between text-xs text-slate-500"><span>Fill</span><span>{{ pct(t.fillRate) }}</span></div>
                <div class="mt-0.5 h-1.5 w-full rounded-full bg-slate-100"><div class="h-full rounded-full bg-slate-600" [style.width.%]="t.fillRate * 100"></div></div>
              </div>
              <div>
                <div class="flex justify-between text-xs text-slate-500"><span>Deposit conv.</span><span>{{ pct(t.depositConversion) }}</span></div>
                <div class="mt-0.5 h-1.5 w-full rounded-full bg-slate-100"><div class="h-full rounded-full" [class]="t.depositConversion < 0.6 ? 'bg-amber-500' : 'bg-emerald-500'" [style.width.%]="t.depositConversion * 100"></div></div>
              </div>
            </div>
          </button>
        </li>
      }
    </ul>
  `,
})
export class TerritoryBreakdownComponent {
  readonly rows = input.required<TerritoryRowDto[]>();
  readonly select = output<number>();

  count(n: number): string { return formatCount(n); }
  pct(r: number): string { return formatPercent(r); }
}
