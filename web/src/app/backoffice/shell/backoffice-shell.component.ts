import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TenantService } from '../../tenant.service';

interface NavLink {
  readonly label: string;
  readonly path: string;
  readonly icon: string; // decorative glyph (aria-hidden)
  readonly exact?: boolean; // exact match for the overview root
}

interface NavGroup {
  readonly heading: string;
  readonly links: readonly NavLink[];
}

/**
 * Back-office layout: a persistent left sidebar + a routed content area. Mounted
 * at /back-office behind corporateGuard (the three corporate scopes only — see
 * app.routes.ts C1). This lane owns the shell + nav; feature lanes own the
 * sections that render inside the <router-outlet>.
 *
 * The sidebar groups the sections the way a franchisor admin reasons about them:
 * the operational sections (reports, territories) up top, the configuration
 * sections (users/roles, org catalog) below. Everything reads design tokens — no
 * raw hex — so it re-skins with the light/dark theme like the rest of the app.
 */
@Component({
  selector: 'bo-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-[calc(100vh-3rem)] bg-[var(--bg)] text-[var(--ink)]">
      <div class="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:px-8 lg:py-8">

        <!-- Sidebar -->
        <aside class="lg:w-60 lg:shrink-0">
          <div class="lg:sticky lg:top-6">
            <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">
              Back office
            </p>
            <p class="mt-1 text-sm text-[var(--ink-muted)]">{{ tenant.scopeName() || 'Corporate' }}</p>

            <nav class="mt-5 flex flex-col gap-5" aria-label="Back office sections">
              @for (group of groups; track group.heading) {
                <div>
                  <p class="px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                    {{ group.heading }}
                  </p>
                  <ul class="mt-1.5 flex flex-col gap-0.5">
                    @for (link of group.links; track link.path) {
                      <li>
                        <a
                          [routerLink]="link.path"
                          routerLinkActive="bo-nav--active"
                          [routerLinkActiveOptions]="{ exact: !!link.exact }"
                          class="bo-nav flex items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-sm
                                 text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-2)]
                                 hover:text-[var(--ink-strong)]">
                          <span class="text-base leading-none" aria-hidden="true">{{ link.icon }}</span>
                          <span>{{ link.label }}</span>
                        </a>
                      </li>
                    }
                  </ul>
                </div>
              }
            </nav>
          </div>
        </aside>

        <!-- Routed section -->
        <main class="min-w-0 flex-1">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      /* Active nav item: accent text + soft accent surface + a left rail, so the
         current section is unambiguous even with color vision differences. */
      .bo-nav--active {
        color: var(--ink-strong);
        background: var(--accent-soft);
        box-shadow: inset 2px 0 0 var(--accent);
        font-weight: 600;
      }
    `,
  ],
})
export class BackOfficeShellComponent {
  readonly tenant = inject(TenantService);

  // Section nav. Paths are relative to /back-office (C1 route subtree). The
  // overview link matches exactly so it isn't highlighted on child routes.
  readonly groups: readonly NavGroup[] = [
    {
      heading: 'Operations',
      links: [
        { label: 'Overview', path: '.', icon: '◆', exact: true },
        { label: 'Reports', path: 'reports', icon: '▤' },
        { label: 'Territories', path: 'territories', icon: '◷' },
      ],
    },
    {
      heading: 'Administration',
      links: [
        { label: 'Users & Roles', path: 'admin/users', icon: '⚇' },
        { label: 'Org Catalog', path: 'admin/catalog', icon: '☷' },
      ],
    },
  ];
}
