import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TenantService } from '../../tenant.service';

interface SectionCard {
  readonly title: string;
  readonly path: string;
  readonly icon: string;
  readonly blurb: string;
  readonly status: 'live' | 'soon';
}

/**
 * Back-office landing page: a launcher that orients a corporate admin and routes
 * them into each section. It is honest about what is live vs. on the roadmap —
 * the status chip on each card distinguishes the two, so nothing reads as ready
 * before its lane has shipped.
 *
 * Cards link relative to /back-office (this component renders inside the shell's
 * outlet, so `reports`, `territories`, etc. resolve under the parent).
 */
@Component({
  selector: 'bo-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <header class="border-b border-[var(--line)] pb-6">
      <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">Back office</p>
      <h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">
        Welcome, {{ firstName() }}
      </h1>
      <p class="mt-1.5 max-w-prose text-sm text-[var(--ink-muted)]">
        Corporate administration for {{ tenant.scopeName() || 'the network' }} — build reports, drill into
        territory health, and manage who can see what. Everything here is scoped to your access.
      </p>
    </header>

    <ul class="mt-6 grid gap-4 sm:grid-cols-2">
      @for (card of cards; track card.path) {
        <li>
          <a
            [routerLink]="card.path"
            class="group flex h-full flex-col rounded-[var(--r-lg)] border border-[var(--line)]
                   bg-[var(--surface)] p-5 shadow-[var(--shadow-card)] transition-colors
                   hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
            <div class="flex items-start justify-between gap-3">
              <span
                class="inline-flex h-10 w-10 items-center justify-center rounded-[var(--r-md)]
                       bg-[var(--accent-soft)] text-lg text-[var(--accent-text)]"
                aria-hidden="true">{{ card.icon }}</span>
              @if (card.status === 'soon') {
                <span
                  class="rounded-full border border-[var(--line)] bg-[var(--neutral-soft)] px-2 py-0.5
                         text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-muted)]">
                  Coming soon
                </span>
              } @else {
                <span
                  class="rounded-full border border-[var(--good)]/40 bg-[var(--good-soft)] px-2 py-0.5
                         text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--good)]">
                  Available
                </span>
              }
            </div>
            <h2 class="mt-4 text-base font-semibold text-[var(--ink-strong)] group-hover:text-[var(--accent-text)]">
              {{ card.title }}
            </h2>
            <p class="mt-1.5 text-sm leading-relaxed text-[var(--ink-muted)]">{{ card.blurb }}</p>
          </a>
        </li>
      }
    </ul>
  `,
})
export class BackOfficeHomeComponent {
  readonly tenant = inject(TenantService);

  // "Sandra Chen — HFC CEO" → "Sandra"; falls back gracefully to a generic greeting.
  firstName(): string {
    const name = this.tenant.displayName().trim();
    if (!name) return 'there';
    return name.split(/[\s—-]/)[0] || 'there';
  }

  readonly cards: readonly SectionCard[] = [
    {
      title: 'Reports',
      path: 'reports',
      icon: '▤',
      blurb: 'Build and export cross-territory reports from the corporate read model.',
      status: 'soon',
    },
    {
      title: 'Territories',
      path: 'territories',
      icon: '◷',
      blurb: 'Explore every territory in scope and drill into a single scorecard.',
      status: 'soon',
    },
    {
      title: 'Users & Roles',
      path: 'admin/users',
      icon: '⚇',
      blurb: 'Review the brand → region → territory access model and who holds each role.',
      status: 'soon',
    },
    {
      title: 'Org Catalog',
      path: 'admin/catalog',
      icon: '☷',
      blurb: 'The catalog of brands, regions, and territories that scope the whole platform.',
      status: 'soon',
    },
  ];
}
