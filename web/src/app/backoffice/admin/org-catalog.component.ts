import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComingSoonComponent } from '../shared/coming-soon.component';

/**
 * Org Catalog admin section: the source-of-truth listing of brands, regions, and
 * territories that scope every other surface. Editing the catalog is on the
 * roadmap; for now the section renders the ComingSoon placeholder describing what
 * it will manage. (No fixture brand list is shown — the real catalog comes from
 * the API the feature lane will wire up.)
 */
@Component({
  selector: 'bo-org-catalog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComingSoonComponent],
  template: `
    <bo-coming-soon
      eyebrow="Administration"
      title="Org Catalog"
      summary="The catalog of brands, regions, and territories that scopes the entire platform — the structure
               every report, dashboard, and access grant is filtered through."
      eta="Wave 1"
      [features]="[
        'Browse the brand → region → territory tree',
        'View territory ownership and operating status',
        'Add and reorganize regions and territories',
        'Keep the read-model roll-up aligned to the catalog',
      ]" />
  `,
})
export class OrgCatalogComponent {}
