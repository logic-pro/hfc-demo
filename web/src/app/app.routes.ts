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
  // Back office — corporate-scope administration (network / brand / region). The
  // shell owns a persistent sidebar; sections render in its outlet. This subtree
  // is the C1 contract: paths, component files, and export names are frozen so the
  // reports/territories feature lanes can overwrite their stub components without
  // touching routing. Guarded once at the parent; children inherit the gate.
  {
    path: 'back-office',
    title: 'HFC · Back office',
    canActivate: [corporateGuard],
    loadComponent: () =>
      import('./backoffice/shell/backoffice-shell.component').then((m) => m.BackOfficeShellComponent),
    children: [
      {
        path: '',
        title: 'HFC · Back office',
        loadComponent: () =>
          import('./backoffice/home/back-office-home.component').then((m) => m.BackOfficeHomeComponent),
      },
      {
        path: 'reports',
        title: 'HFC · Reports',
        loadComponent: () =>
          import('./backoffice/reports/report-builder.component').then((m) => m.ReportBuilderComponent),
      },
      {
        path: 'territories',
        title: 'HFC · Territories',
        loadComponent: () =>
          import('./backoffice/territories/territory-explorer.component').then(
            (m) => m.TerritoryExplorerComponent,
          ),
      },
      {
        path: 'territories/:id',
        title: 'HFC · Territory scorecard',
        loadComponent: () =>
          import('./backoffice/territories/territory-scorecard.component').then(
            (m) => m.TerritoryScorecardComponent,
          ),
      },
      {
        path: 'admin/users',
        title: 'HFC · Users & Roles',
        loadComponent: () =>
          import('./backoffice/admin/users-roles.component').then((m) => m.UsersRolesComponent),
      },
      {
        path: 'admin/catalog',
        title: 'HFC · Org Catalog',
        loadComponent: () =>
          import('./backoffice/admin/org-catalog.component').then((m) => m.OrgCatalogComponent),
      },
    ],
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' },
];
