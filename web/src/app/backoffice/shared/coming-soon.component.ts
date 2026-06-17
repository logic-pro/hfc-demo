import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Reusable "this section is on the roadmap" placeholder for the back office.
 *
 * The back-office shell + routing land first (this lane); the feature lanes
 * (reports, territories) then overwrite their own stub components. Until they do,
 * every section renders a polished, honest placeholder — never a blank route.
 *
 * Honest by construction: it states plainly that the capability is *planned*,
 * lists what it will do, and never dresses up fixture data as live. Selector is
 * the frozen `bo-coming-soon` (C1) so feature lanes can drop it in verbatim.
 *
 * Inputs (all optional except title):
 *   eyebrow   small uppercase kicker, e.g. the section group ("Reports")
 *   title     the section name, e.g. "Report Builder"
 *   summary   one-line description of what the section will do
 *   features  bullet list of planned capabilities
 *   eta       a short cadence note, e.g. "Wave 1"
 * Project richer content via the default slot if a caller needs more.
 */
@Component({
  selector: 'bo-coming-soon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto flex max-w-2xl flex-col items-center rounded-[var(--r-xl)] border border-dashed
             border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12 text-center shadow-[var(--shadow-card)]
             sm:px-10 sm:py-16"
      role="status">
      <!-- Decorative compass/under-construction glyph; aria-hidden, the copy carries the meaning. -->
      <span
        class="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full
               bg-[var(--accent-soft)] text-2xl text-[var(--accent-text)]"
        aria-hidden="true">⚙</span>

      @if (eyebrow()) {
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">
          {{ eyebrow() }}
        </p>
      }
      <h2 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">{{ title() }}</h2>

      @if (summary()) {
        <p class="mt-3 max-w-prose text-sm leading-relaxed text-[var(--ink-muted)]">{{ summary() }}</p>
      }

      <span
        class="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--line)]
               bg-[var(--neutral-soft)] px-3 py-1 text-[11px] font-semibold tracking-[0.02em] text-[var(--ink-muted)]">
        <span class="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true"></span>
        Coming soon{{ eta() ? ' · ' + eta() : '' }}
      </span>

      @if (features().length) {
        <ul class="mt-8 grid w-full gap-2 text-left sm:grid-cols-2">
          @for (f of features(); track f) {
            <li
              class="flex items-start gap-2 rounded-[var(--r-md)] border border-[var(--line)]
                     bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink)]">
              <span class="mt-0.5 text-[var(--accent-text)]" aria-hidden="true">→</span>
              <span>{{ f }}</span>
            </li>
          }
        </ul>
      }

      <!-- Optional richer content from the caller (tables, links, etc.). -->
      <div class="mt-6 w-full empty:hidden">
        <ng-content />
      </div>
    </section>
  `,
})
export class ComingSoonComponent {
  readonly eyebrow = input<string>('');
  readonly title = input.required<string>();
  readonly summary = input<string>('');
  readonly features = input<string[]>([]);
  readonly eta = input<string>('');
}
