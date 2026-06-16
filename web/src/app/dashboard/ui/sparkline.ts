import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';

// Hand-rolled SVG sparkline — no chart lib. Draws itself in on mount via a
// stroke-dashoffset animation (DESIGN IDENTITY: "sparklines draw in"). A soft
// area gradient under the line gives the tiles depth without drop-shadow soup.
@Component({
  selector: 'ec-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + w + ' ' + h"
      [attr.width]="w"
      [attr.height]="h"
      preserveAspectRatio="none"
      class="spark"
      aria-hidden="true"
    >
      <defs>
        <linearGradient [attr.id]="gradId()" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="color" stop-opacity="0.28" />
          <stop offset="100%" [attr.stop-color]="color" stop-opacity="0" />
        </linearGradient>
      </defs>
      @if (area()) {
        <path [attr.d]="area()" [attr.fill]="'url(#' + gradId() + ')'" />
      }
      <path
        [attr.d]="line()"
        fill="none"
        [attr.stroke]="color"
        [attr.stroke-width]="strokeWidth"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="spark-line"
      />
      @if (last()) {
        <circle [attr.cx]="last()!.x" [attr.cy]="last()!.y" r="2.6" [attr.fill]="color" class="spark-dot" />
      }
    </svg>
  `,
  styles: [`
    .spark { display: block; overflow: visible; }
    .spark-line {
      stroke-dasharray: var(--len, 240);
      stroke-dashoffset: var(--len, 240);
      animation: spark-draw 900ms cubic-bezier(.22,.61,.36,1) forwards;
      animation-delay: var(--delay, 0ms);
    }
    .spark-dot { opacity: 0; animation: spark-dot 300ms ease forwards; animation-delay: calc(var(--delay, 0ms) + 850ms); }
    @keyframes spark-draw { to { stroke-dashoffset: 0; } }
    @keyframes spark-dot { to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .spark-line { animation: none; stroke-dashoffset: 0; }
      .spark-dot { animation: none; opacity: 1; }
    }
  `],
})
export class SparklineComponent {
  @Input() set data(v: number[]) { this._data.set(v ?? []); }
  @Input() color = '#f99c1c'; // HFC amber accent
  @Input() w = 120;
  @Input() h = 34;
  @Input() strokeWidth = 1.75;

  private static _seq = 0;
  private readonly _gid = `sg${SparklineComponent._seq++}`;
  readonly gradId = signal(this._gid);
  private readonly _data = signal<number[]>([]);

  private readonly pts = computed(() => {
    const d = this._data();
    if (d.length < 2) return [] as { x: number; y: number }[];
    const min = Math.min(...d);
    const max = Math.max(...d);
    const span = max - min || 1;
    const pad = 3;
    return d.map((v, i) => ({
      x: pad + (i / (d.length - 1)) * (this.w - pad * 2),
      y: pad + (1 - (v - min) / span) * (this.h - pad * 2),
    }));
  });

  readonly line = computed(() => {
    const p = this.pts();
    if (!p.length) return '';
    return p.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
  });

  readonly area = computed(() => {
    const p = this.pts();
    if (!p.length) return '';
    const line = p.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    return `${line} L${p[p.length - 1].x.toFixed(1)},${this.h} L${p[0].x.toFixed(1)},${this.h} Z`;
  });

  readonly last = computed(() => {
    const p = this.pts();
    return p.length ? p[p.length - 1] : null;
  });
}
