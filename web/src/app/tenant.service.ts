import { Injectable, computed, signal } from '@angular/core';

// The two auth scopes the platform serves. The login mints ONE token whose
// claim the server authorizes by: 'corporate' (franchisor HQ, no tenant) or
// 'franchisee' (carries the tenant claim). See the shared auth contract.
export type Role = 'corporate' | 'franchisee';

interface PersistedSession {
  role: Role;
  token: string;
  franchiseeId: string | null;
  brandId: string | null;
  displayName: string;
}

// Survive a page refresh so a signed-in user never lands back on /login with no
// way to tell why. Demo-grade persistence — a real build would hold the token in
// memory + httpOnly refresh cookie; here localStorage keeps the SPA navigable.
const STORAGE_KEY = 'hfc.session';

// Single source of truth for "who am I signed in as." Holds the role, the active
// franchisee (the tenancy boundary, null for HQ), its brand, and the bearer
// token. The HTTP interceptor reads the token to authenticate every request; the
// server resolves the scope from the token's verified claim, never from a
// client-supplied header. Signals (not BehaviorSubjects): synchronous view state.
@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly role = signal<Role | null>(null);
  readonly franchiseeId = signal<string | null>(null);
  readonly brandId = signal<string | null>(null);
  readonly token = signal<string | null>(null);
  readonly displayName = signal<string>('');

  readonly isAuthenticated = computed(() => this.token() !== null);
  // Where this session belongs: the guard sends a bare/foreign visit here.
  readonly homeRoute = computed(() => (this.role() === 'corporate' ? '/corporate' : '/dashboard'));

  constructor() {
    this.restore();
  }

  // Franchisor HQ session: role claim only, no tenant. Reads ACROSS franchisees;
  // the server gates the corporate endpoints on this role.
  setCorporateSession(token: string): void {
    this.role.set('corporate');
    this.franchiseeId.set(null);
    this.brandId.set(null);
    this.token.set(token);
    this.displayName.set('Franchisor HQ');
    this.persist();
  }

  // Franchisee operator session: carries the tenant claim. Selecting a franchisee
  // (login or the booking picker) mints a scoped token — same brand, different
  // franchisee never leaks because the server scopes by the token's claim.
  setSession(franchiseeId: string, brandId: string, token: string, displayName?: string): void {
    this.role.set('franchisee');
    this.franchiseeId.set(franchiseeId);
    this.brandId.set(brandId);
    this.token.set(token);
    if (displayName) this.displayName.set(displayName);
    this.persist();
  }

  clear(): void {
    this.role.set(null);
    this.franchiseeId.set(null);
    this.brandId.set(null);
    this.token.set(null);
    this.displayName.set('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable (private mode) — in-memory clear already done */
    }
  }

  private persist(): void {
    const role = this.role();
    const token = this.token();
    if (!role || !token) return;
    const session: PersistedSession = {
      role,
      token,
      franchiseeId: this.franchiseeId(),
      brandId: this.brandId(),
      displayName: this.displayName(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* storage unavailable — session still lives in the signals for this load */
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as PersistedSession;
      if (!s?.token || !s?.role) return;
      this.role.set(s.role);
      this.token.set(s.token);
      this.franchiseeId.set(s.franchiseeId ?? null);
      this.brandId.set(s.brandId ?? null);
      this.displayName.set(s.displayName ?? '');
    } catch {
      /* corrupt/unavailable — start unauthenticated, the guard sends to /login */
    }
  }
}
