import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { KpiCardComponent, KpiCardVm } from './kpi-card.component';

// The hero row. Owns the responsive grid + the loading skeleton (reserves card
// height so there's no layout shift when data arrives — skill rule).
@Component({
  selector: 'app-kpi-grid',
  imports: [KpiCardComponent],
  template: `
    <section class="grid" role="list" aria-label="Portfolio key metrics">
      @if (loading) {
        @for (s of skeletons; track s) {
          <div class="skeleton" aria-hidden="true"></div>
        }
      } @else {
        @for (card of cards; track card.id) {
          <div role="listitem">
            <app-kpi-card [kpi]="card" />
          </div>
        }
      }
    </section>
  `,
  styles: [
    `
      .grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
      }
      @media (max-width: 1100px) {
        .grid { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 560px) {
        .grid { grid-template-columns: 1fr; }
      }
      .skeleton {
        min-height: 132px;
        border-radius: 12px;
        border: 1px solid #e3e8ef;
        background: linear-gradient(100deg, #f1f4f8 30%, #e7ecf2 50%, #f1f4f8 70%);
        background-size: 200% 100%;
        animation: shimmer 1.2s infinite linear;
      }
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiGridComponent {
  @Input() cards: KpiCardVm[] = [];
  @Input() loading = false;
  readonly skeletons = [0, 1, 2, 3, 4, 5, 6, 7];
}
