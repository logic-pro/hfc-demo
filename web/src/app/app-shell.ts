import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// Thin root shell: a slim nav strip to switch between the three surfaces, then
// the routed view. Deliberately minimal and background-transparent so each
// surface owns its own canvas — the booking demo (App) paints its light theme,
// the executive dashboard paints the dark Operations Command Center theme, and
// neither bleeds into the other.
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="nav">
      <span class="mark">HFC<span>platform</span></span>
      <a routerLink="/corporate" routerLinkActive="active">Executive</a>
      <a routerLink="/dashboard" routerLinkActive="active">Operator</a>
      <a routerLink="/booking" routerLinkActive="active">Scheduling</a>
    </nav>
    <router-outlet />
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; }
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
    `,
  ],
})
export class AppShell {}
