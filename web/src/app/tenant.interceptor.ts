import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TenantService } from './tenant.service';

// Cross-cutting concern handled once, not in every service call: attach the
// stored bearer token to every outgoing request. The server authorizes by the
// token's verified claim — role=corporate gates the franchisor read-down
// endpoints, a tenant claim gates the operator endpoints — so the client no
// longer needs to know which URLs are corporate vs franchisee. (This replaces
// the old read-down strip-list, which mis-stripped the token from the
// franchisee's /api/dashboard/territories call.) Functional interceptor.
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TenantService).token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
