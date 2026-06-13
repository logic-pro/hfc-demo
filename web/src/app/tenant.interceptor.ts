import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TenantService } from './tenant.service';

// Cross-cutting concern handled once, not in every service call: attach the
// bearer token to every outgoing request. The server resolves the tenant from
// the token's verified claim — this interceptor is the single client-side seam
// where auth is applied. (Functional interceptor — Angular's modern API.)
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TenantService).token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
