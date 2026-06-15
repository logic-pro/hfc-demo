import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ActionRowDto, ActionStageFilter, MetricStatus } from '../dashboard.models';
import { formatCurrencyCents, formatDateTimeShort } from '../utils/number-format.util';

const FILTER_LABEL: Record<ActionStageFilter, string> = {
  all: 'All follow-ups',
  open_slots: 'Open slots',
  deposit_unpaid: 'Deposit unpaid',
  deposit_paid: 'Deposit paid',
  expired: 'Expired / abandoned',
};

/** The "what needs follow-up" list. Rows are pre-ranked by the read model;
 *  clicking a row opens the detail drawer. Severity shown as a text-labelled
 *  pill (never colour-only). Horizontal scroll on mobile, identity column first. */
@Component({
  selector: 'app-action-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 class="text-base font-semibold text-slate-900">Needs follow-up</h2>
          <p class="text-sm text-slate-500">Filtered: {{ filterLabel() }} · {{ rows().length }} item(s)</p>
        </div>
        @if (activeFilter() !== 'all') {
          <button type="button" (click)="clearFilter.emit()"
            class="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Clear filter
          </button>
        }
      </header>

      @if (rows().length === 0) {
        <div class="px-5 py-10 text-center text-sm text-slate-500">
          Nothing in “{{ filterLabel() }}” for this period — nothing leaking here. 🎉
        </div>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead class="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th class="sticky left-0 bg-white px-5 py-2 font-medium">Customer</th>
                <th class="px-3 py-2 font-medium">Territory</th>
                <th class="px-3 py-2 font-medium">When</th>
                <th class="px-3 py-2 font-medium">Stage</th>
                <th class="px-3 py-2 font-medium">Deposit</th>
                <th class="px-3 py-2 font-medium">Recommended action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (row of rows(); track row.appointmentId) {
                <tr (click)="selectRow.emit(row)"
                    class="cursor-pointer hover:bg-slate-50 focus-within:bg-slate-50">
                  <td class="sticky left-0 bg-white px-5 py-3 font-medium text-slate-900">
                    {{ row.customerName }}
                  </td>
                  <td class="px-3 py-3 text-slate-600">{{ row.territoryName }}</td>
                  <td class="px-3 py-3 text-slate-600">{{ when(row.startUtc) }}</td>
                  <td class="px-3 py-3">
                    <span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="pill(row.severity)">
                      {{ row.stage }}
                    </span>
                  </td>
                  <td class="px-3 py-3 tabular-nums text-slate-600">
                    {{ row.depositPaid ? deposit(row.depositCents) : '—' }}
                  </td>
                  <td class="px-3 py-3 text-slate-700">{{ row.recommendedAction }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  // Re-assert slate heading colour over the global dark-dashboard \`h1..h4\` rule
  // (near-white --ink-0) that would otherwise ghost this title on the light card.
  styles: [`h2 { color: #0f172a; }`], // slate-900
})
export class ActionTableComponent {
  readonly rows = input.required<ActionRowDto[]>();
  readonly activeFilter = input.required<ActionStageFilter>();
  readonly selectRow = output<ActionRowDto>();
  readonly clearFilter = output<void>();

  readonly filterLabel = computed(() => FILTER_LABEL[this.activeFilter()]);

  when(iso: string): string { return formatDateTimeShort(iso); }
  deposit(cents: number): string { return formatCurrencyCents(cents); }

  pill(s: MetricStatus): string {
    return s === 'good' ? 'bg-emerald-50 text-emerald-700'
      : s === 'warning' ? 'bg-amber-50 text-amber-700'
      : s === 'bad' ? 'bg-red-50 text-red-700'
      : 'bg-slate-100 text-slate-600';
  }
}
