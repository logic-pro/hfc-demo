import { Routes } from '@angular/router';
import { App } from './app';

export const routes: Routes = [
  { path: '', component: App }, // existing booking demo
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./dashboard/dashboard-page.component').then((m) => m.DashboardPageComponent),
  },
  { path: '**', redirectTo: '' },
];
