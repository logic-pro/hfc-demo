import { Routes } from '@angular/router';
import { App } from './app';
import { roleGuard } from './auth/auth.guard';

// One shell, three surfaces, two auth scopes — now gated by role:
//   /login      public: mint a corporate or franchisee token, then route by role
//   /corporate  franchisor HQ executive command center (role=corporate)
//   /dashboard  franchisee operator dashboard            (role=franchisee)
//   /booking    franchisee scheduling demo               (role=franchisee)
// The data-heavy surfaces are lazy standalone components — each its own chunk so
// the dashboard viz never weighs down the booking SPA. A bare '/' or any unknown
// path falls to /login, where an existing session is bounced to its role's home.
export const routes: Routes = [
  {
    path: 'login',
    title: 'HFC · Sign in',
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'corporate',
    title: 'HFC · Network Operations Command Center',
    canActivate: [roleGuard('corporate')],
    loadComponent: () => import('./dashboard/dashboard').then((m) => m.DashboardComponent),
  },
  {
    path: 'dashboard',
    title: 'HFC · Franchisee Operations',
    canActivate: [roleGuard('franchisee')],
    loadComponent: () =>
      import('./franchisee/dashboard-page.component').then((m) => m.DashboardPageComponent),
  },
  {
    path: 'booking',
    title: 'HFC · Scheduling',
    canActivate: [roleGuard('franchisee')],
    component: App,
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' },
];
