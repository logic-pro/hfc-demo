import { Injectable, signal } from '@angular/core';

// Single source of truth for "who am I acting as." Holds the active franchisee
// (the tenancy boundary), its brand (grouping), and the bearer token minted for
// that franchisee. The HTTP interceptor reads the token to authenticate every
// request — the server resolves the tenant from the token's claim, never from a
// client-supplied header. Signals (not BehaviorSubjects): synchronous view state.
@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly franchiseeId = signal<string | null>(null);
  readonly brandId = signal<string | null>(null);
  readonly token = signal<string | null>(null);

  setSession(franchiseeId: string, brandId: string, token: string): void {
    this.franchiseeId.set(franchiseeId);
    this.brandId.set(brandId);
    this.token.set(token);
  }

  clear(): void {
    this.franchiseeId.set(null);
    this.brandId.set(null);
    this.token.set(null);
  }
}
