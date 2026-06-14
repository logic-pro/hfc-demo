import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TenantService } from './tenant.service';

// Cross-cutting concern handled once, not in every service call: attach the
// bearer token to every outgoing request. The server resolves the tenant from
// the token's verified claim — this interceptor is the single client-side seam
// where auth is applied. (Functional interceptor — Angular's modern API.)
// Read-down boundary (ADR-19): the franchisor executive dashboard reads ACROSS
// franchisees, so the franchisee tenant token must never be attached to its
// requests — that would scope a cross-franchisee read to one tenant (or 403).
// These endpoints carry their own corporate/regional-scoped credential.
//
// This MUST be an exact corporate allow-list, not a `/api/dashboard/` prefix:
// the FRANCHISEE ops dashboard calls `/api/dashboard/territories` (its territory
// picker) which IS tenant-scoped and needs the token. A broad prefix stripped it,
// sending that call out unauthenticated. Every entry below is a corporate read in
// DashboardDataService; note `/api/dashboard/territories` does NOT contain the
// substring `/api/territories`, so the franchisee call correctly keeps its token.
const READ_DOWN_PATHS = [
  '/api/dashboard/corporate', // corporate roll-up
  '/api/dashboard/watchlist', // at-risk watchlist
  '/api/dashboard/map',       // map roll-up
  '/api/territories',         // territory list + /{id}/health-score
];

export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  if (READ_DOWN_PATHS.some((path) => req.url.includes(path))) {
    return next(req);
  }

  const token = inject(TenantService).token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
