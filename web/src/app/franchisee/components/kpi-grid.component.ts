import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { KpiCardComponent } from './kpi-card.component';
import { ActionStageFilter, KpiCardVm } from '../dashboard.models';

/** Responsive KPI row: 4 across on desktop → 2 on tablet → stacked on mobile. */
@Component({
  selector: 'app-kpi-grid',
  standalone: true,
  imports: [KpiCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
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
