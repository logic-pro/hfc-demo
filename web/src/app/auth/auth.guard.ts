import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role, TenantService } from '../tenant.service';

// No cold-visit dead-ends: an unauthenticated visit to any guarded surface is
// redirected to /login (as a UrlTree so the navigation is cancelled cleanly).
export const authGuard: CanActivateFn = () => {
  const tenant = inject(TenantService);
  const router = inject(Router);
  return tenant.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

// Surface belongs to one role. Unauthenticated → /login; signed in as the wrong
// role → bounced to that role's home (a franchisee can't open the franchisor
// command center, and vice versa). The server enforces this too — this is the
// client-side mirror so the wrong surface never even paints.
export const roleGuard =
  (required: Role): CanActivateFn =>
  () => {
    const tenant = inject(TenantService);
    const router = inject(Router);
    if (!tenant.isAuthenticated()) return router.createUrlTree(['/login']);
    return tenant.role() === required ? true : router.createUrlTree([tenant.homeRoute()]);
  };
