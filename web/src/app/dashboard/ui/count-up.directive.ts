import { Directive, ElementRef, Input, OnChanges, inject } from '@angular/core';
import { Unit } from '../dashboard.models';
import { formatPartial, formatValue } from './health';

// Hero numbers count up on load (DESIGN IDENTITY: motion is purposeful). ~900ms,
// easeOutExpo so the value decelerates into its final reading — feels like a gauge
// settling, not a slot machine. Respects prefers-reduced-motion.
@Directive({ selector: '[ecCountUp]' })
export class CountUpDirective implements OnChanges {
  @Input('ecCountUp') value: number | null | undefined = 0;
  @Input() unit: Unit = 'count';
  @Input() durationMs = 900;
  @Input() delayMs = 0;

  private host = inject(ElementRef<HTMLElement>).nativeElement;
  private raf = 0;
  // The value currently on screen — animate FROM here, never from 0. Restarting at
  // 0 on every change is what made the hero numbers flicker when data updated.
  private displayed = 0;
  // First paint plays the entrance count-up (with stagger); later updates tween
  // from the displayed value with no delay and no flash.
  private hasRun = false;

  ngOnChanges(): void {
    const target = this.value;
    // Null-safe (integration graft): a missing/unwired live metric must not tween
    // toward NaN — render 'Unavailable' once and stop. formatValue owns the copy.
    if (target === null || target === undefined || Number.isNaN(target)) {
      cancelAnimationFrame(this.raf);
      this.host.textContent = formatValue(target, this.unit);
      this.displayed = 0;
      this.hasRun = true;
      return;
    }
    // A re-emit of the same value (e.g. a parent re-render that didn't touch the
    // data) must not restart the count — that zero-flash is the flicker.
    if (this.hasRun && this.displayed === target) return;

    cancelAnimationFrame(this.raf);

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.displayed = target;
      this.hasRun = true;
      this.host.textContent = formatValue(target, this.unit);
      return;
    }

    const from = this.hasRun ? this.displayed : 0;
    // Entrance stagger applies to the first paint only; updates animate immediately.
    const start = performance.now() + (this.hasRun ? 0 : this.delayMs);
    const ease = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

    const tick = (now: number) => {
      const t = Math.max(0, (now - start) / this.durationMs);
      const eased = ease(Math.min(1, t));
      const current = from + (target - from) * eased;
      this.displayed = t < 1 ? current : target;
      this.host.textContent =
        t < 1 ? formatPartial(current, this.unit) : formatValue(target, this.unit);
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };

    // Paint the start value immediately only on first run, so there's no flash of
    // the final value before the entrance animation; on updates we resume mid-stream.
    if (!this.hasRun) this.host.textContent = formatPartial(0, this.unit);
    this.hasRun = true;
    this.raf = requestAnimationFrame(tick);
  }
}
