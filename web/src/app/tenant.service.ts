import { Injectable, computed, signal } from '@angular/core';

// The four authorization scopes of the RBAC hierarchy. Login mints ONE token
// whose claim the server authorizes by (see the shared scope contract):
//   network    → HFC CEO: every territory
//   brand      → brand president: one brand's territories
//   region     → region manager: one region's territories
//   franchisee → operator: their own tenant
// The three corporate tiers all read the SAME executive command center, just
// re-scoped server-side; 'franchisee' is the operator surface.
export type Scope = 'network' | 'brand' | 'region' | 'franchisee';
export type CorporateScope = Extract<Scope, 'network' | 'brand' | 'region'>;

interface PersistedSession {
  scope: Scope;
  token: string;
  franchiseeId: string | null;
  brandId: string | null;
  displayName: string;
  scopeName: string;
}

// Survive a refresh so a signed-in user never lands back on /login with no way to
// tell why. Demo-grade persistence — a real build would hold the token in memory
// + an httpOnly refresh cookie; here localStorage keeps the SPA navigable.
const STORAGE_KEY = 'hfc.session';

// Single source of truth for "who am I signed in as." Holds the active scope, the
// franchisee tenant (null for corporate scopes), its brand slug, the bearer
// token, and two labels: the persona ("Signed in as …") and the scope name (the
// dashboard header). The HTTP interceptor reads the token to authenticate every
// request; the server resolves the scope from the token's verified claim, never
// from a client-supplied header. Signals: synchronous view state.
@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly scope = signal<Scope | null>(null);
  readonly franchiseeId = signal<string | null>(null);
  readonly brandId = signal<string | null>(null); // slug — franchisee / booking only
  readonly token = signal<string | null>(null);
  readonly displayName = signal<string>(''); // persona, e.g. "Sandra Chen — HFC CEO"
  readonly scopeName = signal<string>(''); // active scope, e.g. "HFC Network" / "<Brand>"

  readonly isAuthenticated = computed(() => this.token() !== null);
  // network / brand / region all land on the executive surface; franchisee on the operator one.
  readonly isCorporate = computed(() => {
    const s = this.scope();
    return s === 'network' || s === 'brand' || s === 'region';
  });
  readonly homeRoute = computed(() => (this.isCorporate() ? '/corporate' : '/dashboard'));

  constructor() {
    this.restore();
  }

  // A corporate persona (network / brand / region): scope claim, no operator
  // tenant. The server filters the read model by the scope; the UI only reflects it.
  setCorporateSession(scope: CorporateScope, token: string, displayName: string, scopeName: string): void {
    this.scope.set(scope);
    this.franchiseeId.set(null);
    this.brandId.set(null);
    this.token.set(token);
    this.displayName.set(displayName);
    this.scopeName.set(scopeName);
    this.persist();
  }

  // A franchisee operator: carries the tenant claim. Selecting a franchisee
  // (login or the booking picker) mints a scoped token — same brand, different
  // franchisee never leaks because the server scopes by the token's claim.
  setSession(franchiseeId: string, brandId: string, token: string, displayName?: string): void {
    this.scope.set('franchisee');
    this.franchiseeId.set(franchiseeId);
    this.brandId.set(brandId);
    this.token.set(token);
    if (displayName) {
      this.displayName.set(displayName);
      this.scopeName.set(displayName);
    }
    this.persist();
  }

  clear(): void {
    this.scope.set(null);
    this.franchiseeId.set(null);
    this.brandId.set(null);
    this.token.set(null);
    this.displayName.set('');
    this.scopeName.set('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — in-memory clear already done */
    }
  }

  private persist(): void {
    const scope = this.scope();
    const token = this.token();
    if (!scope || !token) return;
    const session: PersistedSession = {
      scope,
      token,
      franchiseeId: this.franchiseeId(),
      brandId: this.brandId(),
      displayName: this.displayName(),
      scopeName: this.scopeName(),
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
      if (!s?.token || !s?.scope) return;
      this.scope.set(s.scope);
      this.token.set(s.token);
      this.franchiseeId.set(s.franchiseeId ?? null);
      this.brandId.set(s.brandId ?? null);
      this.displayName.set(s.displayName ?? '');
      this.scopeName.set(s.scopeName ?? '');
    } catch {
      /* corrupt/unavailable — start unauthenticated, the guard sends to /login */
    }
  }
}
