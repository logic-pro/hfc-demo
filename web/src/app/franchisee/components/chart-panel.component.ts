import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Generic chart container — the ONE place a chart library would be swapped in.
 * It owns the card chrome, title, the textual insight summary (accessibility:
 * the key takeaway is always available as text next to the visual), and the
 * empty/loading hand-off. The actual chart is projected via <ng-content>, so the
 * page can drop in an SVG component today and ECharts/Chart.js later with no
 * layout change.
 */
@Component({
  selector: 'app-chart-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex h-full flex-col rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
      <header class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-[var(--ink-strong)]">{{ title() }}</h2>
          @if (subtitle()) {
            <p class="mt-0.5 text-sm text-[var(--ink-muted)]">{{ subtitle() }}</p>
          }
        </div>
        <ng-content select="[panel-actions]" />
      </header>

      <div class="relative mt-4 flex-1">
        @if (empty()) {
          <div class="flex h-full min-h-32 items-center justify-center rounded-lg bg-[var(--surface-2)] text-sm text-[var(--ink-muted)]">
            {{ emptyMessage() || 'No data for this period.' }}
          </div>
        } @else {
          <ng-content />
        }
      </div>

      @if (insight() && !empty()) {
        <p class="mt-3 border-t border-[var(--line)] pt-3 text-sm text-[var(--ink-muted)]">{{ insight() }}</p>
      }
    </section>
  `,
})
export class ChartPanelComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly insight = input<string | null>(null);
  readonly empty = input<boolean>(false);
  readonly emptyMessage = input<string | null>(null);
}
