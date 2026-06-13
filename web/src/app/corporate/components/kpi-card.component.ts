import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DataQuality } from '../../models';
import { DataQualityBadgeComponent } from './data-quality-badge.component';

// Presentational view model the card consumes. The smart page does the mapping
// + formatting (number-format.util); this component only displays.
export interface KpiCardVm {
  id: string;
  label: string;
  displayValue: string; // pre-formatted ('412', '$1.24M', 'Unavailable')
  deltaLabel?: string | null; // e.g. '+8 vs last quarter'
  status: 'good' | 'warning' | 'bad' | 'neutral' | 'unavailable';
  dataQuality: DataQuality;
  trend?: number[] | null; // sparkline points
  helperText?: string | null; // the gap note when unavailable
  tooltip?: string;
}

@Component({
  selector: 'app-kpi-card',
  imports: [DataQualityBadgeComponent],
  template: `
    <article class="kpi" [class.unavailable]="kpi.status === 'unavailable'" [title]="kpi.tooltip ?? ''">
      <div class="top">
        <span class="label">{{ kpi.label }}</span>
        <app-data-quality-badge [dataQuality]="kpi.dataQuality" />
      </div>

      <div class="value">{{ kpi.displayValue }}</div>

      @if (kpi.trend && kpi.trend.length > 1) {
        <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          <polyline [attr.points]="sparkPoints" fill="none" stroke-width="2" />
        </svg>
      }

      @if (kpi.deltaLabel) {
        <div class="delta" [class]="kpi.status">{{ kpi.deltaLabel }}</div>
      }

      @if (kpi.helperText) {
        <p class="helper">{{ kpi.helperText }}</p>
      }
    </article>
  `,
  styles: [
    `
      .kpi {
        background: #fff;
        border: 1px solid #e3e8ef;
        border-radius: 12px;
        padding: 1rem 1.1rem;
        box-shadow: 0 1px 2px rgba(20, 32, 46, 0.04);
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
        min-height: 132px;
      }
      .kpi.unavailable {
        border-style: dashed;
        background: #fbfcfe;
      }
      .top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .label {
        font-size: 0.8rem;
        font-weight: 600;
        color: #6b7a8d;
      }
      .value {
        font-size: 1.9rem;
        font-weight: 700;
        letter-spacing: -0.5px;
        color: #14202e;
        line-height: 1.1;
      }
      .kpi.unavailable .value {
        font-size: 1.1rem;
        font-weight: 600;
        color: #97a4b4;
      }
      .spark {
        width: 100%;
        height: 26px;
        color: #1f6feb;
      }
      .spark polyline {
        stroke: currentColor;
      }
      .delta {
        font-size: 0.82rem;
        font-weight: 600;
      }
      .delta.good { color: #1a7f4b; }
      .delta.warning { color: #9a6700; }
      .delta.bad { color: #b3261e; }
      .delta.neutral { color: #6b7a8d; }
      .helper {
        margin: 0;
        font-size: 0.78rem;
        color: #97a4b4;
        line-height: 1.35;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiCardComponent {
  @Input({ required: true }) kpi!: KpiCardVm;

  // Map trend values to an SVG polyline in a 0..100 x 0..28 box (y inverted).
  get sparkPoints(): string {
    const t = this.kpi.trend ?? [];
    if (t.length < 2) return '';
    const min = Math.min(...t);
    const max = Math.max(...t);
    const range = max - min || 1;
    const stepX = 100 / (t.length - 1);
    return t
      .map((v, i) => {
        const x = i * stepX;
        const y = 26 - ((v - min) / range) * 24 - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
}
