import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TenantService } from './tenant.service';

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
        }
        @if (tenant.scope() === 'franchisee') {
          <a routerLink="/dashboard" routerLinkActive="active">Operator</a>
          <a routerLink="/booking" routerLinkActive="active">Scheduling</a>
        }
        <span class="spacer"></span>
        <span class="who">Signed in as <strong>{{ tenant.displayName() }}</strong></span>
        <button type="button" class="signout" (click)="signOut()">Sign out</button>
      </nav>
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
        background: #5fe3c0;
        color: #042;
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
        background: #0d1722;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      .mark { font-weight: 800; color: #fff; letter-spacing: -0.5px; }
      .mark span { font-weight: 400; opacity: 0.6; margin-left: 0.2rem; }
      .nav a {
        color: #9fb3c8;
        text-decoration: none;
        font-size: 0.9rem;
        padding: 0.25rem 0;
        border-bottom: 2px solid transparent;
      }
      .nav a:hover { color: #fff; }
      .nav a.active { color: #fff; border-bottom-color: #5fe3c0; }
      .spacer { flex: 1; }
      .who { color: #9fb3c8; font-size: 0.82rem; }
      .who strong { color: #fff; font-weight: 600; }
      .signout {
        background: transparent;
        border: 1px solid #2a3a4d;
        color: #9fb3c8;
        font-size: 0.82rem;
        padding: 0.3rem 0.75rem;
        border-radius: 6px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease;
      }
      .signout:hover { color: #fff; border-color: #5fe3c0; }
    `,
  ],
})
export class AppShell {
  readonly tenant = inject(TenantService);
  private router = inject(Router);

  signOut(): void {
    this.tenant.clear();
    this.router.navigateByUrl('/login');
  }
}
