import {
  AfterViewInit, ChangeDetectionStrategy, Component, Input, computed, signal,
} from '@angular/core';
import { CountUpDirective } from './count-up.directive';
import { band, healthColor } from './health';

// Signature element: an animated radial health gauge. Hand-rolled SVG ring that
// sweeps from empty to the composite value (stroke-dashoffset transition), colored
// by health band, with the value counting up in the center. No charting lib.
@Component({
  selector: 'ec-radial-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountUpDirective],
  template: `
    <div class="gauge" [style.--size.px]="size">
      <svg [attr.viewBox]="'0 0 ' + box + ' ' + box" class="gauge-svg">
        <defs>
          <linearGradient [attr.id]="gid" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" [attr.stop-color]="color()" stop-opacity="0.65" />
            <stop offset="100%" [attr.stop-color]="color()" />
          </linearGradient>
        </defs>
        <!-- track -->
        <circle [attr.cx]="c" [attr.cy]="c" [attr.r]="r" fill="none"
          stroke="var(--surface-line)" [attr.stroke-width]="stroke" />
        <!-- value arc (rotated so it starts at 12 o'clock) -->
        <circle [attr.cx]="c" [attr.cy]="c" [attr.r]="r" fill="none"
          [attr.stroke]="'url(#' + gid + ')'" [attr.stroke-width]="stroke" stroke-linecap="round"
          [attr.stroke-dasharray]="circumference"
          [style.stroke-dashoffset]="offset()"
          class="gauge-arc"
          [attr.transform]="'rotate(-90 ' + c + ' ' + c + ')'" />
        <!-- tick at the value head -->
      </svg>
      <div class="gauge-center">
        @if (pending) {
          <div class="gauge-pending">—</div>
          <div class="gauge-sub">pending</div>
        } @else {
          <div class="gauge-num tnum" [ecCountUp]="value" unit="score" [durationMs]="950" [delayMs]="120"></div>
          <div class="gauge-sub">{{ sublabel }}</div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: inline-block; }
    .gauge { position: relative; width: var(--size); height: var(--size); }
    .gauge-svg { width: 100%; height: 100%; display: block; overflow: visible; }
    .gauge-arc {
      transition: stroke-dashoffset 1000ms cubic-bezier(.22,.61,.36,1);
      filter: drop-shadow(0 0 6px color-mix(in srgb, currentColor 0%, transparent));
    }
    .gauge-center {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 2px;
    }
    .gauge-num { font-family: var(--font-display); font-weight: 600; font-size: calc(var(--size) * 0.30); line-height: 1; color: var(--ink-0); letter-spacing: -0.02em; }
    .gauge-pending { font-family: var(--font-display); font-weight: 600; font-size: calc(var(--size) * 0.30); color: var(--ink-3); line-height: 1; }
    .gauge-sub { font-size: calc(var(--size) * 0.075); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
    @media (prefers-reduced-motion: reduce) { .gauge-arc { transition: none; } }
  `],
})
export class RadialGaugeComponent implements AfterViewInit {
  @Input() value = 0;
  @Input() size = 168;
  @Input() stroke = 12;
  @Input() sublabel = 'Composite';
  @Input() pending = false;

  private static _seq = 0;
  readonly gid = `gg${RadialGaugeComponent._seq++}`;

  readonly box = 100;
  readonly c = 50;
  get r(): number { return 50 - this.stroke / 2 - 1; }
  get circumference(): number { return 2 * Math.PI * this.r; }

  readonly color = computed(() => (this.pending ? '#5A6B8C' : healthColor(this._val())));
  private readonly _val = signal(0);

  // Start empty, then sweep to the value on the next frame so the CSS transition runs.
  readonly offset = signal(this.circumference);

  ngAfterViewInit(): void {
    this._val.set(this.value);
    const frac = this.pending ? 0 : Math.max(0, Math.min(1, this.value / 100));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => this.offset.set(this.circumference * (1 - frac))),
    );
  }

  band(): string { return band(this.value); }
}
