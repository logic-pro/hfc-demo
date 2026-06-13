import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DataQuality } from '../../models';

// A small, always-visible provenance marker. Trust rule: never let a metric's
// source be ambiguous. 'unavailable' is styled as a muted/dashed "not wired"
// state — visually distinct from a red "bad value" and from an error.
@Component({
  selector: 'app-data-quality-badge',
  template: `<span class="badge" [class]="dataQuality" [title]="title">{{ label }}</span>`,
  styles: [
    `
      .badge {
        display: inline-block;
        border-radius: 999px;
        padding: 0.1rem 0.5rem;
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.3px;
        text-transform: uppercase;
        border: 1px solid transparent;
      }
      .actual { background: #e8f3ec; color: #1a7f4b; }
      .proxy { background: #e7eefc; color: #1f4fb0; }
      .partial,
      .estimated { background: #fff4e0; color: #9a6700; }
      .stale { background: #eef1f5; color: #6b7a8d; }
      .unavailable {
        background: transparent;
        color: #6b7a8d;
        border: 1px dashed #c2ccd8;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataQualityBadgeComponent {
  @Input({ required: true }) dataQuality!: DataQuality;

  get label(): string {
    return this.dataQuality;
  }
  get title(): string {
    const map: Record<DataQuality, string> = {
      actual: 'Measured — app-native, near real-time',
      proxy: 'Proxy measure — labelled stand-in, not the real metric',
      partial: 'Partial coverage for this period',
      estimated: 'Estimated value',
      stale: 'Last known value — past its refresh window',
      unavailable: 'Source not wired yet — shown honestly, not substituted',
    };
    return map[this.dataQuality];
  }
}
