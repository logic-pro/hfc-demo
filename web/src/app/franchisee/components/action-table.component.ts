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
    <div class="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
      <header class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-4">
        <div>
          <h2 class="text-base font-semibold text-[var(--ink-strong)]">Needs follow-up</h2>
          <p class="text-sm text-[var(--ink-muted)]">Filtered: {{ filterLabel() }} · {{ rows().length }} item(s)</p>
        </div>
        @if (activeFilter() !== 'all') {
          <button type="button" (click)="clearFilter.emit()"
            class="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]">
            Clear filter
          </button>
        }
      </header>

      @if (rows().length === 0) {
        <div class="px-5 py-10 text-center text-sm text-[var(--ink-muted)]">
          Nothing in “{{ filterLabel() }}” for this period — nothing leaking here. 🎉
        </div>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead class="text-xs uppercase tracking-wide text-[var(--ink-faint)]">
              <tr class="border-b border-[var(--line)]">
                <th class="sticky left-0 bg-[var(--surface)] px-5 py-2.5 font-medium">Customer</th>
                <th class="px-3 py-2.5 font-medium">Territory</th>
                <th class="px-3 py-2.5 font-medium">When</th>
                <th class="px-3 py-2.5 font-medium">Stage</th>
                <th class="px-3 py-2.5 font-medium">Deposit</th>
                <th class="px-3 py-2.5 font-medium">Recommended action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--line)]">
              @for (row of rows(); track row.appointmentId) {
                <tr (click)="selectRow.emit(row)"
                    class="cursor-pointer transition hover:bg-[var(--surface-2)] focus-within:bg-[var(--surface-2)]">
                  <td class="sticky left-0 bg-[var(--surface)] px-5 py-3 font-medium text-[var(--ink-strong)]">
                    {{ row.customerName }}
                  </td>
                  <td class="px-3 py-3 text-[var(--ink-muted)]">{{ row.territoryName }}</td>
                  <td class="px-3 py-3 text-[var(--ink-muted)]">{{ when(row.startUtc) }}</td>
                  <td class="px-3 py-3">
                    <span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="pill(row.severity)">
                      {{ row.stage }}
                    </span>
                  </td>
                  <td class="px-3 py-3 tabular-nums text-[var(--ink-muted)]">
                    {{ row.depositPaid ? deposit(row.depositCents) : '—' }}
                  </td>
                  <td class="px-3 py-3 text-[var(--ink)]">{{ row.recommendedAction }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
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
    return s === 'good' ? 'bg-[var(--good-soft)] text-[var(--good)]'
      : s === 'warning' ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
      : s === 'bad' ? 'bg-[var(--critical-soft)] text-[var(--critical)]'
      : 'bg-[var(--neutral-soft)] text-[var(--ink-muted)]';
  }
}
