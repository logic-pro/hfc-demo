import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DataQuality } from '../dashboard.models';

/** Tiny provenance chip. Text-backed (never colour-only) so the operator always
 *  knows whether a number is measured or simply not in the system. */
@Component({
  selector: 'app-data-quality-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (quality() === 'measured') {
      <span class="inline-flex items-center gap-1 rounded-full bg-[var(--neutral-soft)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]"
            title="Measured directly from operational data.">
        <span class="h-1.5 w-1.5 rounded-full bg-[var(--good)]"></span> Measured
      </span>
    } @else {
      <span class="inline-flex items-center gap-1 rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-xs font-medium text-[var(--warning)]"
            title="Not captured in this system.">
        <span class="h-1.5 w-1.5 rounded-full bg-[var(--warning)]"></span> Unavailable
      </span>
    }
  `,
})
export class DataQualityBadgeComponent {
  readonly quality = input.required<DataQuality>();
}
