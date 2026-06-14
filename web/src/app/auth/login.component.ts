import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../api.service';
import { TenantService } from '../tenant.service';
import { Franchisee } from '../models';

interface BrandGroup {
  brandName: string;
  franchisees: Franchisee[];
}

// The single entry point: choose a scope, mint the matching token, route by role.
// Franchisor HQ → corporate token → the executive command center; a franchisee
// chip → tenant token → the operator dashboard. Stands in for a B2C/Entra login.
@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <main class="login">
      <section class="card">
        <header class="head">
          <span class="mark">HFC<span>platform</span></span>
          <h1>Sign in</h1>
          <p class="sub">Choose how you’re signing in — your role decides what you see.</p>
        </header>

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }

        <!-- Franchisor HQ -->
        <button
          type="button"
          class="hq"
          [disabled]="busy() !== null"
          (click)="signInAsHq()">
          <span class="hq-title">Sign in as Franchisor HQ</span>
          <span class="hq-sub">Network-wide executive command center (read-down across all franchisees)</span>
          @if (busy() === 'hq') { <span class="spin" aria-hidden="true"></span> }
        </button>

        <div class="divider"><span>or sign in as a franchisee</span></div>

        @if (loading()) {
          <p class="muted">Loading franchisees…</p>
        } @else if (brands().length === 0 && !error()) {
          <p class="muted">No franchisees available.</p>
        } @else {
          @for (group of brands(); track group.brandName) {
            <div class="brand">
              <h2>{{ group.brandName }}</h2>
              <div class="chips">
                @for (f of group.franchisees; track f.id) {
                  <button
                    type="button"
                    class="chip"
                    [disabled]="busy() !== null"
                    [class.working]="busy() === f.id"
                    (click)="signInAsFranchisee(f)">
                    <span class="chip-name">{{ f.name }}</span>
                    <span class="chip-region">{{ f.region }}</span>
                  </button>
                }
              </div>
            </div>
          }
        }
      </section>
    </main>
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; background: #080b14; }
      .login {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      .card {
        width: 100%;
        max-width: 30rem;
        background: #101626;
        border: 1px solid #1e2942;
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
      }
      .head { margin-bottom: 1.5rem; }
      .mark { font-weight: 800; color: #fff; letter-spacing: -0.5px; font-size: 1.1rem; }
      .mark span { font-weight: 400; opacity: 0.6; margin-left: 0.2rem; }
      h1 { color: #f4f7ff; font-size: 1.6rem; margin: 0.75rem 0 0.25rem; }
      .sub { color: #8a99b8; font-size: 0.9rem; margin: 0; }
      .error {
        background: rgba(255, 99, 99, 0.12);
        border: 1px solid rgba(255, 99, 99, 0.4);
        color: #ffb4b4;
        padding: 0.6rem 0.8rem;
        border-radius: 8px;
        font-size: 0.85rem;
        margin: 0 0 1rem;
      }
      .muted { color: #5a6b8c; font-size: 0.9rem; }
      .hq {
        width: 100%;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        position: relative;
        background: linear-gradient(135deg, #14b89a, #0f8d77);
        border: none;
        border-radius: 12px;
        padding: 1rem 1.1rem;
        cursor: pointer;
        transition: filter 0.15s ease;
      }
      .hq:hover:not(:disabled) { filter: brightness(1.08); }
      .hq:disabled { opacity: 0.6; cursor: default; }
      .hq-title { color: #042; font-weight: 700; font-size: 1rem; }
      .hq-sub { color: rgba(0, 40, 32, 0.8); font-size: 0.78rem; }
      .divider {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: #5a6b8c;
        font-size: 0.78rem;
        margin: 1.4rem 0 1rem;
      }
      .divider::before, .divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: #1e2942;
      }
      .brand { margin-bottom: 1rem; }
      .brand h2 {
        color: #8a99b8;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin: 0 0 0.5rem;
      }
      .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      .chip {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        text-align: left;
        background: #161e32;
        border: 1px solid #1e2942;
        border-radius: 10px;
        padding: 0.55rem 0.8rem;
        cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .chip:hover:not(:disabled) { border-color: #5fe3c0; background: #1a2540; }
      .chip:disabled { opacity: 0.5; cursor: default; }
      .chip.working { border-color: #5fe3c0; }
      .chip-name { color: #f4f7ff; font-size: 0.88rem; font-weight: 600; }
      .chip-region { color: #5a6b8c; font-size: 0.74rem; }
      .spin {
        position: absolute;
        top: 0.9rem;
        right: 0.9rem;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(0, 40, 32, 0.4);
        border-top-color: #042;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `,
  ],
})
export class LoginComponent implements OnInit {
  private api = inject(ApiService);
  private tenant = inject(TenantService);
  private router = inject(Router);

  readonly franchisees = signal<Franchisee[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  // Which control is mid-flight ('hq' or a franchisee id) — disables the rest.
  readonly busy = signal<string | null>(null);

  // Group the picker by brand so a multi-brand network reads as a hierarchy,
  // not a flat wall of chips.
  readonly brands = computed<BrandGroup[]>(() => {
    const byBrand = new Map<string, BrandGroup>();
    for (const f of this.franchisees()) {
      const g = byBrand.get(f.brandName) ?? { brandName: f.brandName, franchisees: [] };
      g.franchisees.push(f);
      byBrand.set(f.brandName, g);
    }
    return [...byBrand.values()];
  });

  ngOnInit(): void {
    // Already signed in (e.g. refresh): skip the login, go to the role's home.
    if (this.tenant.isAuthenticated()) {
      this.router.navigateByUrl(this.tenant.homeRoute());
      return;
    }
    this.loading.set(true);
    this.api.franchisees().subscribe({
      next: (f) => {
        this.franchisees.set(f);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not reach the API on :5180. Is it running?');
        this.loading.set(false);
      },
    });
  }

  signInAsHq(): void {
    this.error.set(null);
    this.busy.set('hq');
    this.api.corporateToken().subscribe({
      next: (res) => {
        this.tenant.setCorporateSession(res.token);
        this.router.navigateByUrl('/corporate');
      },
      error: () => {
        this.error.set('Could not sign in as Franchisor HQ.');
        this.busy.set(null);
      },
    });
  }

  signInAsFranchisee(f: Franchisee): void {
    this.error.set(null);
    this.busy.set(f.id);
    this.api.token(f.id).subscribe({
      next: (res) => {
        this.tenant.setSession(res.franchiseeId ?? f.id, res.brandId ?? f.brandId, res.token, f.name);
        this.router.navigateByUrl('/dashboard');
      },
      error: () => {
        this.error.set('Could not sign in as that franchisee.');
        this.busy.set(null);
      },
    });
  }
}
