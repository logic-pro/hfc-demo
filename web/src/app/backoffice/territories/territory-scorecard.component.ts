import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComingSoonComponent } from '../shared/coming-soon.component';

/**
 * STUB — owned by the territories feature lane, which overwrites this file.
 *
 * Path and export name are frozen by C1. Routed at
 * /back-office/territories/:id as the single-territory drill-down from the
 * explorer. Renders the shared ComingSoon until the real scorecard lands.
 */
@Component({
  selector: 'bo-territory-scorecard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComingSoonComponent],
  template: `
    <bo-coming-soon
      eyebrow="Territories"
      title="Territory Scorecard"
      summary="A single territory's full health picture — bookings, deposits, NPS, and the actions that need
               follow-up — with measured-vs-illustrative provenance on every metric."
      eta="Wave 1"
      [features]="[
        'Headline health and trend for one territory',
        'Bookings, deposits, and NPS with provenance',
        'Open actions and follow-ups',
        'Back to the explorer or across to a neighbour',
      ]" />
  `,
})
export class TerritoryScorecardComponent {}
