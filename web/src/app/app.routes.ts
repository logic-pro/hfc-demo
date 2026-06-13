import { Routes } from '@angular/router';
import { App } from './app';

// One shell, three surfaces, two auth scopes:
//   /booking    franchisee-scoped booking demo (App, untouched — Slice A/B)
//   /corporate  read-down franchisor executive dashboard (lazy; corporate scope)
//   /dashboard  franchisee operator dashboard (Slice D — placeholder until merged)
// The data-heavy surfaces are lazy standalone components — each its own chunk so
// the dashboard viz never weighs down the booking SPA.
export const routes: Routes = [
  { path: '', redirectTo: 'corporate', pathMatch: 'full' },
  { path: 'booking', component: App, title: 'HFC · Scheduling' },
  {
    path: 'corporate',
    title: 'HFC · Network Operations Command Center',
    loadComponent: () => import('./dashboard/dashboard').then((m) => m.DashboardComponent),
  },
  {
    path: 'dashboard',
    title: 'HFC · Franchisee Operations',
    loadComponent: () =>
      import('./dashboard-placeholder').then((m) => m.DashboardPlaceholderComponent),
  },
  { path: '**', redirectTo: '' },
];
