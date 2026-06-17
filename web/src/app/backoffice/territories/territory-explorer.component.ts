import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComingSoonComponent } from '../shared/coming-soon.component';

/**
 * STUB — owned by the territories feature lane, which overwrites this file.
 *
 * Path and export name are frozen by C1. Renders the shared ComingSoon so
 * /back-office/territories resolves cleanly until the real explorer lands. The
 * explorer drills into a single territory via the sibling scorecard route
 * (/back-office/territories/:id → TerritoryScorecardComponent).
 */
@Component({
  selector: 'bo-territory-explorer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComingSoonComponent],
  template: `
    <bo-coming-soon
      eyebrow="Territories"
      title="Territory Explorer"
      summary="Every territory in your scope, sortable by health and bookings, with a drill-down into a single
               territory's scorecard."
      eta="Wave 1"
      [features]="[
        'List all territories in scope with health and key metrics',
        'Sort and filter by brand, region, or risk band',
        'Drill into a single territory scorecard',
        'Jump straight to at-risk territories',
      ]" />
  `,
})
export class TerritoryExplorerComponent {}
