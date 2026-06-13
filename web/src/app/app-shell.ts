import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// Thin root shell: a slim nav strip to switch between the two surfaces, then the
// routed view. Kept deliberately minimal so the booking demo (App) renders its
// own branded header below, completely unchanged.
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="nav">
      <span class="mark">HFC<span>platform</span></span>
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Scheduling</a>
      <a routerLink="/corporate" routerLinkActive="active">Executive Dashboard</a>
    </nav>
    <router-outlet />
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; background: #f6f8fb; }
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
      .nav a.active { color: #fff; border-bottom-color: #1f6feb; }
    `,
  ],
})
export class AppShell {}
