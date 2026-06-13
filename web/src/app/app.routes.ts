import { Routes } from '@angular/router';
import { App } from './app';

// Two surfaces, two auth scopes:
//   ''          the franchisee-scoped booking demo (App, untouched)
//   'corporate' the read-down executive dashboard (lazy; corporate-scoped)
// The corporate route is lazily loaded so its (future) chart library never
// weighs down the booking SPA.
export const routes: Routes = [
  { path: '', component: App, title: 'HFC Scheduling' },
  {
    path: 'corporate',
    title: 'HFC Executive Dashboard',
    loadComponent: () =>
      import('./corporate/portfolio-page.component').then((m) => m.PortfolioPageComponent),
  },
  { path: '**', redirectTo: '' },
];
