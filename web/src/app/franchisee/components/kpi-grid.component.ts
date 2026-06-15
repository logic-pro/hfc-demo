import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { KpiCardComponent } from './kpi-card.component';
import { ActionStageFilter, KpiCardVm } from '../dashboard.models';

/** Responsive KPI row. Five tiles read as one intentional row on wide screens
 *  (xl:grid-cols-5) instead of a 4 + lone-orphan break; 3-up on lg, 2-up on
 *  tablet, stacked on mobile. */
@Component({
  selector: 'app-kpi-grid',
  standalone: true,
  imports: [KpiCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
             aria-label="Key performance indicators">
      @for (kpi of kpis(); track kpi.key) {
        <app-kpi-card [kpi]="kpi" (drill)="drill.emit($event)" />
      }
    </section>
  `,
})
export class KpiGridComponent {
  readonly kpis = input.required<KpiCardVm[]>();
  readonly drill = output<ActionStageFilter>();
}
