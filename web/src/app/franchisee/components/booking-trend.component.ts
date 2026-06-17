import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TrendPointDto } from '../dashboard.models';
import { formatDayShort } from '../utils/number-format.util';

/**
 * Zero-dependency SVG trend: amber bars = bookings, orange line+area = filled
 * slots (realized capacity). Lives behind ChartPanelComponent so it can be
 * swapped for a charting lib without touching the page. Pure presentational.
 * The y-scale carries headroom so steady days don't peg the bars to the ceiling,
 * and the SVG fills its card (aspect-locked) instead of letterboxing.
 */
@Component({
  selector: 'app-booking-trend',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 680 170" preserveAspectRatio="none" class="w-full" style="aspect-ratio: 680 / 170"
         role="img" [attr.aria-label]="ariaLabel()">
      <defs>
        <linearGradient id="bt-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.95" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.45" />
        </linearGradient>
        <linearGradient id="bt-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent-2)" stop-opacity="0.22" />
          <stop offset="100%" stop-color="var(--accent-2)" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- faint reference gridlines -->
      @for (g of gridY(); track g) {
        <line x1="0" [attr.y1]="g" x2="680" [attr.y2]="g" class="stroke-[var(--line)]" stroke-width="1"
              vector-effect="non-scaling-stroke" opacity="0.5" />
      }

      <!-- bars: bookings -->
      @for (b of bars(); track b.date) {
        <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" rx="3" fill="url(#bt-bar)" />
        <text [attr.x]="b.cx" y="162" text-anchor="middle" class="fill-[var(--ink-faint)]"
              style="font-size: 10px" vector-effect="non-scaling-stroke">{{ b.label }}</text>
      }

      <!-- baseline axis -->
      <line x1="0" y1="130" x2="680" y2="130" class="stroke-[var(--line-strong)]" stroke-width="1"
            vector-effect="non-scaling-stroke" />

      <!-- filled-slots: soft area + line + markers (orange, contrasts the amber bars) -->
      @if (areaPath()) {
        <path [attr.d]="areaPath()" fill="url(#bt-area)" />
        <polyline [attr.points]="linePoints()" fill="none" class="stroke-[var(--accent-2)]" stroke-width="2.5"
                  stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        @for (p of linePointArr(); track p.date) {
          <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="fill-[var(--surface)] stroke-[var(--accent-2)]"
                  stroke-width="2" vector-effect="non-scaling-stroke" />
        }
      }
    </svg>

    <div class="mt-2 flex gap-4 text-xs text-[var(--ink-muted)]">
      <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-3 rounded-sm" style="background: var(--accent)"></span> Bookings</span>
      <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-4 rounded-full" style="background: var(--accent-2)"></span> Filled slots</span>
    </div>
  `,
})
export class BookingTrendComponent {
  readonly points = input.required<TrendPointDto[]>();

  private readonly W = 680;
  private readonly TOP = 14;       // top padding inside the plot
  private readonly BASE = 130;     // baseline y (bars sit on this)
  private get plotH(): number { return this.BASE - this.TOP; }

  // y-scale ceiling with ~20% headroom so steady days don't peg to the top.
  private readonly scaleMax = computed(() => {
    const m = Math.max(1, ...this.points().flatMap((p) => [p.bookings, p.filledSlots]));
    return m * 1.2;
  });

  private y(v: number): number { return this.BASE - (v / this.scaleMax()) * this.plotH; }

  readonly gridY = computed(() => [0.33, 0.66, 1].map((f) => this.TOP + (1 - f) * this.plotH));

  readonly bars = computed(() => {
    const pts = this.points();
    const slot = this.W / Math.max(1, pts.length);
    const bw = slot * 0.62;
    return pts.map((p, i) => {
      const y = this.y(p.bookings);
      const x = i * slot + (slot - bw) / 2;
      return { date: p.date, x, w: bw, h: this.BASE - y, y, cx: x + bw / 2, label: formatDayShort(p.date) };
    });
  });

  readonly linePointArr = computed(() => {
    const pts = this.points();
    const slot = this.W / Math.max(1, pts.length);
    return pts.map((p, i) => ({ date: p.date, x: i * slot + slot / 2, y: this.y(p.filledSlots) }));
  });

  readonly linePoints = computed(() =>
    this.linePointArr().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
  );

  readonly areaPath = computed(() => {
    const arr = this.linePointArr();
    if (arr.length < 2) return '';
    const mid = arr.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `M ${arr[0].x.toFixed(1)},${this.BASE} ${mid} L ${arr[arr.length - 1].x.toFixed(1)},${this.BASE} Z`;
  });

  readonly ariaLabel = computed(() => {
    const pts = this.points();
    const total = pts.reduce((s, p) => s + p.bookings, 0);
    return `Booking trend: ${total} bookings across ${pts.length} days, with filled-slot overlay.`;
  });
}
