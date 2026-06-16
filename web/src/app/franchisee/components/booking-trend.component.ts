import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TrendPointDto } from '../dashboard.models';
import { formatDayShort } from '../utils/number-format.util';

/**
 * Zero-dependency SVG trend: bars = bookings, line = filled slots. Lives behind
 * ChartPanelComponent, so it can be replaced by a charting lib without touching
 * the page. Pure presentational: takes points, renders.
 */
@Component({
  selector: 'app-booking-trend',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 320 140" class="h-44 w-full" role="img"
         [attr.aria-label]="ariaLabel()">
      <!-- bars: bookings -->
      @for (b of bars(); track b.date) {
        <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h"
              rx="2" class="fill-[var(--line-strong)]" />
        <text [attr.x]="b.cx" y="135" text-anchor="middle" class="fill-[var(--ink-faint)] text-[9px]">{{ b.label }}</text>
      }
      <!-- line: filled slots -->
      <polyline [attr.points]="linePoints()" fill="none" class="stroke-[var(--accent)]" stroke-width="2" />
      @for (p of linePointArr(); track p.date) {
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2.5" class="fill-[var(--accent)]" />
      }
    </svg>
    <div class="mt-2 flex gap-4 text-xs text-[var(--ink-muted)]">
      <span class="inline-flex items-center gap-1"><span class="h-2 w-3 rounded-sm bg-[var(--line-strong)]"></span> Bookings</span>
      <span class="inline-flex items-center gap-1"><span class="h-0.5 w-3 bg-[var(--accent)]"></span> Filled slots</span>
    </div>
  `,
})
export class BookingTrendComponent {
  readonly points = input.required<TrendPointDto[]>();

  private readonly W = 320;
  private readonly H = 120; // plot area height (leave room for labels)
  private readonly maxVal = computed(() =>
    Math.max(1, ...this.points().flatMap((p) => [p.bookings, p.filledSlots])),
  );

  readonly bars = computed(() => {
    const pts = this.points();
    const slot = this.W / Math.max(1, pts.length);
    const bw = slot * 0.55;
    return pts.map((p, i) => {
      const h = (p.bookings / this.maxVal()) * this.H;
      const x = i * slot + (slot - bw) / 2;
      return { date: p.date, x, w: bw, h, y: this.H - h, cx: x + bw / 2, label: formatDayShort(p.date) };
    });
  });

  readonly linePointArr = computed(() => {
    const pts = this.points();
    const slot = this.W / Math.max(1, pts.length);
    return pts.map((p, i) => ({
      date: p.date,
      x: i * slot + slot / 2,
      y: this.H - (p.filledSlots / this.maxVal()) * this.H,
    }));
  });

  readonly linePoints = computed(() =>
    this.linePointArr().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
  );

  readonly ariaLabel = computed(() => {
    const pts = this.points();
    const total = pts.reduce((s, p) => s + p.bookings, 0);
    return `Booking trend: ${total} bookings across ${pts.length} days, with filled-slot overlay.`;
  });
}
