import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TenantService } from './tenant.service';

// Cross-cutting concern handled once, not in every service call: attach the
// bearer token to every outgoing request. The server resolves the tenant from
// the token's verified claim — this interceptor is the single client-side seam
// where auth is applied. (Functional interceptor — Angular's modern API.)
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  // Read-down boundary (ADR-19): the franchisor executive dashboard reads ACROSS
  // franchisees, so the franchisee tenant token must never be attached to its
  // requests — that would scope a cross-franchisee read to one tenant (or 403).
  // These endpoints carry their own corporate/regional-scoped credential. The
  // two prefixes cover every read in DashboardDataService:
  //   /api/dashboard/*   → corporate roll-up + watchlist
  //   /api/territories*  → territory list + per-territory health-score
  if (req.url.includes('/api/dashboard/') || req.url.includes('/api/territories')) {
    return next(req);
  }

  const token = inject(TenantService).token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
