import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComingSoonComponent } from '../shared/coming-soon.component';

interface RoleRow {
  readonly scope: string;
  readonly role: string;
  readonly sees: string;
}

/**
 * Users & Roles admin section. Full user management (invite, assign, revoke) is
 * on the roadmap, so the section leads with the ComingSoon placeholder.
 *
 * It also renders a *read-only* reference of the platform's RBAC scope hierarchy.
 * This isn't fixture data dressed up as live — it's the actual four-tier access
 * model the whole app authorizes by (see tenant.service.ts `Scope`), shown so an
 * admin understands the roles the management UI will operate on.
 */
@Component({
  selector: 'bo-users-roles',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComingSoonComponent],
  template: `
    <bo-coming-soon
      eyebrow="Administration"
      title="Users & Roles"
      summary="Invite teammates, assign them a scope, and manage access across the brand → region → territory
               hierarchy. The access model below is what this section will manage."
      eta="Wave 1"
      [features]="[
        'Invite users and assign a scope (network / brand / region / franchisee)',
        'Review and revoke access per person',
        'See effective territory visibility for any role',
        'Audit trail of access changes',
      ]">
      <div class="mt-2 overflow-hidden rounded-[var(--r-md)] border border-[var(--line)]">
        <table class="w-full border-collapse text-left text-sm">
          <caption class="sr-only">Platform RBAC scope hierarchy (read-only reference)</caption>
          <thead>
            <tr class="bg-[var(--surface-2)] text-[var(--ink-muted)]">
              <th scope="col" class="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em]">Scope</th>
              <th scope="col" class="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em]">Role</th>
              <th scope="col" class="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em]">Sees</th>
            </tr>
          </thead>
          <tbody>
            @for (row of roles; track row.scope) {
              <tr class="border-t border-[var(--line)]">
                <td class="px-3 py-2 font-mono text-[13px] text-[var(--accent-text)]">{{ row.scope }}</td>
                <td class="px-3 py-2 text-[var(--ink-strong)]">{{ row.role }}</td>
                <td class="px-3 py-2 text-[var(--ink-muted)]">{{ row.sees }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </bo-coming-soon>
  `,
})
export class UsersRolesComponent {
  // The four authorization scopes, mirroring tenant.service.ts `Scope`.
  readonly roles: readonly RoleRow[] = [
    { scope: 'network', role: 'HFC executive', sees: 'Every brand, region, and territory' },
    { scope: 'brand', role: 'Brand president', sees: "One brand's regions and territories" },
    { scope: 'region', role: 'Region manager', sees: "One region's territories" },
    { scope: 'franchisee', role: 'Operator', sees: 'Their own territory only' },
  ];
}
