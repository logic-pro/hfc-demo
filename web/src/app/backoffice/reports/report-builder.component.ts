import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComingSoonComponent } from '../shared/coming-soon.component';

/**
 * STUB — owned by the reports feature lane, which overwrites this file.
 *
 * Path and export name are frozen by C1 so the shell can route to it now and the
 * feature lane can drop in the real builder without touching routing. Until then
 * it renders the shared ComingSoon so /back-office/reports resolves to a polished
 * page rather than a blank or broken route.
 */
@Component({
  selector: 'bo-report-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComingSoonComponent],
  template: `
    <bo-coming-soon
      eyebrow="Reports"
      title="Report Builder"
      summary="Compose cross-territory reports from the corporate read model — pick metrics, group by brand or
               region, scope the period, and export."
      eta="Wave 1"
      [features]="[
        'Choose metrics and dimensions',
        'Group by brand, region, or territory',
        'Scope to a period with measured-vs-illustrative provenance',
        'Export to CSV / share a saved view',
      ]" />
  `,
})
export class ReportBuilderComponent {}
