import { Directive, ElementRef, Input, OnChanges, inject } from '@angular/core';
import { Unit } from '../dashboard.models';
import { formatPartial, formatValue } from './health';

// Hero numbers count up on load (DESIGN IDENTITY: motion is purposeful). ~900ms,
// easeOutExpo so the value decelerates into its final reading — feels like a gauge
// settling, not a slot machine. Respects prefers-reduced-motion.
@Directive({ selector: '[ecCountUp]' })
export class CountUpDirective implements OnChanges {
  @Input('ecCountUp') value = 0;
  @Input() unit: Unit = 'count';
  @Input() durationMs = 900;
  @Input() delayMs = 0;

  private host = inject(ElementRef<HTMLElement>).nativeElement;
  private raf = 0;

  ngOnChanges(): void {
    cancelAnimationFrame(this.raf);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.host.textContent = formatValue(this.value, this.unit);
      return;
    }

    const target = this.value;
    const start = performance.now() + this.delayMs;
    const ease = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

    const tick = (now: number) => {
      const t = Math.max(0, (now - start) / this.durationMs);
      const eased = ease(Math.min(1, t));
      const current = target * eased;
      this.host.textContent =
        t < 1 ? formatPartial(current, this.unit) : formatValue(target, this.unit);
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    // Paint a 0 immediately so there's no flash of the final value.
    this.host.textContent = formatPartial(0, this.unit);
    this.raf = requestAnimationFrame(tick);
  }
}
