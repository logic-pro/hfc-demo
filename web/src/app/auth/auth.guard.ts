import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantService } from '../tenant.service';

// No cold-visit dead-ends: an unauthenticated visit to any guarded surface is
// redirected to /login (as a UrlTree so the navigation is cancelled cleanly).
export const authGuard: CanActivateFn = () => {
  const tenant = inject(TenantService);
  const router = inject(Router);
  return tenant.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

// The executive command center: open to the three corporate scopes (network /
// brand / region). A franchisee operator is bounced to their operator dashboard.
export const corporateGuard: CanActivateFn = () => {
  const tenant = inject(TenantService);
  const router = inject(Router);
  if (!tenant.isAuthenticated()) return router.createUrlTree(['/login']);
  return tenant.isCorporate() ? true : router.createUrlTree([tenant.homeRoute()]);
};

// The operator surfaces (/dashboard, /booking): franchisee scope only. A
// corporate persona is bounced to the executive command center. The server
// enforces this too — this is the client-side mirror so the wrong surface never
// even paints.
export const franchiseeGuard: CanActivateFn = () => {
  const tenant = inject(TenantService);
  const router = inject(Router);
  if (!tenant.isAuthenticated()) return router.createUrlTree(['/login']);
  return tenant.scope() === 'franchisee' ? true : router.createUrlTree([tenant.homeRoute()]);
};
