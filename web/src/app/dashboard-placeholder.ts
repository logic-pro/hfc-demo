import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// Placeholder for the franchisee operator dashboard (Slice D). The route exists
// now so the shell's three surfaces are reachable; the real operator view lands
// when slice-d merges (per INTEGRATION-PLAN §1 Fork 2 / §2 merge step 6).
@Component({
  selector: 'app-dashboard-placeholder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main class="ph">
      <span class="eyebrow">Franchisee · Operator View</span>
      <h1>Operations dashboard</h1>
      <p>
        The franchisee operator dashboard ships with Slice D. The franchisor
        executive view is live now —
        <a routerLink="/corporate">open the Network Operations Command Center →</a>
      </p>
    </main>
  `,
  styles: [
    `
      :host { display: block; min-height: calc(100vh - 44px); }
      .ph {
        max-width: 680px;
        margin: 0 auto;
        padding: 120px 24px;
        text-align: center;
        font-family: var(--font-ui, system-ui, sans-serif);
        color: var(--ink-2, #8a99b8);
      }
      .eyebrow {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-3, #5a6b8c);
      }
      h1 {
        margin: 10px 0 14px;
        font-family: var(--font-display, system-ui, sans-serif);
        font-size: 2rem;
        color: var(--ink-0, #f4f7ff);
      }
      a { color: var(--accent, #5fe3c0); }
    `,
  ],
})
export class DashboardPlaceholderComponent {}
