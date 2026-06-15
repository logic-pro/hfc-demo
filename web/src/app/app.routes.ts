import { Routes } from '@angular/router';
import { App } from './app';
import { corporateGuard, franchiseeGuard } from './auth/auth.guard';

// One shell, four surfaces, a 4-tier scope hierarchy — gated by scope:
//   /login      public: pick a persona, mint a scoped token, route by scope
//   /corporate  executive command center — network / brand / region scopes
//   /dashboard  franchisee operator dashboard — franchisee scope
//   /booking    franchisee scheduling demo    — franchisee scope
// The data-heavy surfaces are lazy standalone components — each its own chunk so
// the dashboard viz never weighs down the booking SPA. A bare '/' or any unknown
// path falls to /login, where an existing session is bounced to its scope's home.
export const routes: Routes = [
  {
    path: 'login',
    title: 'HFC · Sign in',
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'corporate',
    title: 'HFC · Network Operations Command Center',
    canActivate: [corporateGuard],
    loadComponent: () => import('./dashboard/dashboard').then((m) => m.DashboardComponent),
  },
  {
    path: 'dashboard',
    title: 'HFC · Franchisee Operations',
    canActivate: [franchiseeGuard],
    loadComponent: () =>
      import('./franchisee/dashboard-page.component').then((m) => m.DashboardPageComponent),
  },
  {
    path: 'booking',
    title: 'HFC · Scheduling',
    canActivate: [franchiseeGuard],
    component: App,
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' },
];
