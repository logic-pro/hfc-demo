import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TenantService } from './tenant.service';
import { ThemeService } from './theme.service';

// Thin root shell: a slim nav strip that adapts to the signed-in scope, then the
// routed view. The nav only renders once authenticated (the /login picker owns
// its own full canvas), and shows only the surfaces the scope can use — the three
// corporate scopes see the Executive command center; a franchisee sees Operator +
// Scheduling. Deliberately minimal and background-transparent so each surface
// owns its own canvas and neither theme bleeds into the other.
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <!-- First focusable element: lets keyboard users jump past the nav to the
         routed surface. Visually hidden until focused (see .skip-nav). -->
    <a class="skip-nav" href="#main-content">Skip to main content</a>
    @if (tenant.isAuthenticated()) {
      <nav class="nav">
        <span class="mark">HFC<span>platform</span></span>
        @if (tenant.isCorporate()) {
          <a routerLink="/corporate" routerLinkActive="active">Executive</a>
          <a routerLink="/back-office" routerLinkActive="active">Back office</a>
        }
        @if (tenant.scope() === 'franchisee') {
          <a routerLink="/dashboard" routerLinkActive="active">Operator</a>
          <a routerLink="/booking" routerLinkActive="active">Scheduling</a>
        }
        <span class="spacer"></span>
        <span class="who">Signed in as <strong>{{ tenant.displayName() }}</strong></span>
        <button
          type="button"
          class="theme-toggle"
          (click)="theme.toggle()"
          [attr.aria-pressed]="theme.theme() === 'dark'"
          [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          [title]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
          <span aria-hidden="true">{{ theme.theme() === 'dark' ? '☀' : '☾' }}</span>
        </button>
        <button type="button" class="signout" (click)="signOut()">Sign out</button>
      </nav>
    } @else {
      <!-- Login owns its own full canvas, but still needs a way to switch themes. -->
      <button
        type="button"
        class="theme-toggle floating"
        (click)="theme.toggle()"
        [attr.aria-pressed]="theme.theme() === 'dark'"
        [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
        [title]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
        <span aria-hidden="true">{{ theme.theme() === 'dark' ? '☀' : '☾' }}</span>
      </button>
    }
    <div id="main-content" tabindex="-1">
      <router-outlet />
    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; }
      #main-content { display: block; }
      #main-content:focus { outline: none; }
      /* Skip link: off-screen until it receives focus, then pinned top-left. */
      .skip-nav {
        position: absolute;
        left: -9999px;
        top: 0;
        z-index: 100;
        background: var(--accent);
        color: var(--accent-ink);
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        font-size: 0.85rem;
        font-weight: 600;
        padding: 0.5rem 0.9rem;
        border-radius: 0 0 6px 0;
        text-decoration: none;
      }
      .skip-nav:focus { left: 0; }
      .nav {
        display: flex;
        align-items: center;
        gap: 1.25rem;
        padding: 0.5rem 1.5rem;
        background: var(--surface);
        border-bottom: 1px solid var(--line);
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      .mark { font-weight: 800; color: var(--accent); letter-spacing: -0.5px; }
      .mark span { font-weight: 400; color: var(--ink-muted); margin-left: 0.2rem; }
      .nav a {
        color: var(--ink-muted);
        text-decoration: none;
        font-size: 0.9rem;
        padding: 0.25rem 0;
        border-bottom: 2px solid transparent;
        transition: color 0.15s ease, border-color 0.15s ease;
      }
      .nav a:hover { color: var(--ink); }
      .nav a.active { color: var(--ink-strong); border-bottom-color: var(--accent); }
      .spacer { flex: 1; }
      .who { color: var(--ink-muted); font-size: 0.82rem; }
      .who strong { color: var(--ink-strong); font-weight: 600; }
      .signout {
        background: transparent;
        border: 1px solid var(--line);
        color: var(--ink-muted);
        font-size: 0.82rem;
        padding: 0.3rem 0.75rem;
        border-radius: 6px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease;
      }
      .signout:hover { color: var(--ink-strong); border-color: var(--accent); }
      /* Theme toggle — accessible icon button; reachable on every surface. */
      .theme-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--surface-2);
        color: var(--ink);
        font-size: 0.95rem;
        line-height: 1;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
      }
      .theme-toggle:hover { color: var(--accent); border-color: var(--accent); }
      .theme-toggle:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      /* Floating variant for the login surface (no nav bar there). */
      .theme-toggle.floating {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 50;
        box-shadow: var(--shadow-card);
      }
    `,
  ],
})
export class AppShell {
  readonly tenant = inject(TenantService);
  readonly theme = inject(ThemeService);
  private router = inject(Router);

  signOut(): void {
    this.tenant.clear();
    this.router.navigateByUrl('/login');
  }
}
