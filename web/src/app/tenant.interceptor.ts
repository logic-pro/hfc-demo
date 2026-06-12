import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TenantService } from './tenant.service';

// Cross-cutting concern handled once, not in every service call: stamp the
// current tenant onto every outgoing request. In production this header is
// replaced by the auth token's tenant claim — the interceptor is the single
// seam where that swap happens. (Functional interceptor — Angular's modern API.)
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const brandId = inject(TenantService).brandId();
  if (!brandId) return next(req);
  return next(req.clone({ setHeaders: { 'X-Tenant-Id': brandId } }));
};
