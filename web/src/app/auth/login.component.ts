import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { ApiService } from '../api.service';
import { TenantService } from '../tenant.service';
import { Brand, DevTokenResponse, Franchisee, RegionRef } from '../models';

// One persona in the picker: a label, the token mint it triggers, how to apply
// the result to the session, and where it lands. Keeping the behaviour on the
// persona (not in the template) lets one generic click handler drive every tier.
interface Persona {
  id: string;
  name: string;
  role: string;
  mint: () => Observable<DevTokenResponse>;
  apply: (res: DevTokenResponse) => void;
  target: string;
}

interface PersonaGroup {
  tier: string;
  hint: string;
  personas: Persona[];
}

// The single entry point: pick a persona across the 4-tier hierarchy, mint the
// matching scoped token, route by scope. network/brand/region → the executive
// command center (re-scoped server-side); a franchisee → the operator dashboard.
// Stands in for a B2C/Entra login. Brand/region tiers populate from the API and
// degrade quietly if those catalogs aren't present yet.
@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <main class="login">
      <section class="card">
        <header class="head">
          <span class="mark">HFC<span>platform</span></span>
          <h1>Sign in</h1>
          <p class="sub">Pick a persona — your scope in the hierarchy decides what you see.</p>
        </header>

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }

        @if (loading()) {
          <p class="muted">Loading personas…</p>
        } @else if (apiDown()) {
          <p class="error" role="alert">Could not reach the API on :5180. Is it running?</p>
        } @else {
          @for (group of groups(); track group.tier) {
            @if (group.personas.length) {
              <div class="tier">
                <h2>{{ group.tier }} <span class="tier-hint">{{ group.hint }}</span></h2>
                <div class="chips">
                  @for (p of group.personas; track p.id) {
                    <button
                      type="button"
                      class="chip"
                      [class.working]="busy() === p.id"
                      [disabled]="busy() !== null"
                      (click)="run(p)">
                      <span class="chip-name">{{ p.name }}</span>
                      <span class="chip-role">{{ p.role }}</span>
                    </button>
                  }
                </div>
              </div>
            }
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
        max-width: 34rem;
        background: #101626;
        border: 1px solid #1e2942;
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
      }
      .head { margin-bottom: 1.25rem; }
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
      .tier { margin-bottom: 1.1rem; }
      .tier h2 {
        color: #8a99b8;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin: 0 0 0.5rem;
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
      }
      .tier-hint { text-transform: none; letter-spacing: 0; color: #5a6b8c; font-size: 0.72rem; }
      .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      .chip {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        text-align: left;
        min-width: 9rem;
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
      .chip-role { color: #5a6b8c; font-size: 0.74rem; }
    `,
  ],
})
export class LoginComponent implements OnInit {
  private api = inject(ApiService);
  private tenant = inject(TenantService);
  private router = inject(Router);

  private readonly brands = signal<Brand[]>([]);
  private readonly regions = signal<RegionRef[]>([]);
  private readonly franchisees = signal<Franchisee[]>([]);

  readonly loading = signal(true);
  readonly apiDown = signal(false);
  readonly error = signal<string | null>(null);
  // Which persona is mid-flight — disables the rest until it resolves.
  readonly busy = signal<string | null>(null);

  // The 4-tier persona picker. Network is always offered; brand/region/franchisee
  // populate from the catalogs and a tier is hidden if its catalog is empty.
  readonly groups = computed<PersonaGroup[]>(() => [
    {
      tier: 'Franchisor HQ',
      hint: 'network scope — every territory',
      personas: [
        {
          id: 'network',
          name: 'HFC CEO',
          role: 'Franchisor HQ — every territory',
          mint: () => this.api.networkToken(),
          apply: (res) =>
            this.tenant.setCorporateSession('network', res.token, 'HFC CEO', 'HFC Network'),
          target: '/corporate',
        },
      ],
    },
    {
      tier: 'Brand',
      hint: 'one brand’s territories',
      // Needs the numeric brand id to mint a brand scope; brands without it are skipped.
      personas: this.brands()
        .filter((b) => b.num != null)
        .map((b) => ({
          id: `brand:${b.num}`,
          name: b.name,
          role: 'Brand President',
          mint: () => this.api.brandToken(b.num as number),
          apply: (res: DevTokenResponse) =>
            this.tenant.setCorporateSession('brand', res.token, `${b.name} · Brand President`, b.name),
          target: '/corporate',
        })),
    },
    {
      tier: 'Region',
      hint: 'one region’s territories',
      personas: this.regions().map((r) => ({
        id: `region:${r.id}`,
        name: r.name,
        role: 'Region Manager',
        mint: () => this.api.regionToken(r.id),
        apply: (res: DevTokenResponse) =>
          this.tenant.setCorporateSession('region', res.token, `${r.name} · Region Manager`, r.name),
        target: '/corporate',
      })),
    },
    {
      tier: 'Franchisee',
      hint: 'operator — their own tenant',
      personas: this.franchisees().map((f) => ({
        id: `franchisee:${f.id}`,
        name: f.name,
        role: `${f.brandName} · ${f.region}`,
        mint: () => this.api.token(f.id),
        apply: (res: DevTokenResponse) =>
          this.tenant.setSession(res.franchiseeId ?? f.id, res.brandId ?? f.brandId, res.token, f.name),
        target: '/dashboard',
      })),
    },
  ]);

  ngOnInit(): void {
    // Already signed in (e.g. refresh): skip the picker, go to the scope's home.
    if (this.tenant.isAuthenticated()) {
      this.router.navigateByUrl(this.tenant.homeRoute());
      return;
    }
    // Franchisees back the operator tier AND prove the API is reachable; brands
    // and regions are best-effort so a missing catalog doesn't break login.
    this.api.franchisees().subscribe({
      next: (f) => {
        this.franchisees.set(f);
        this.loading.set(false);
      },
      error: () => {
        this.apiDown.set(true);
        this.loading.set(false);
      },
    });
    this.api.brands().subscribe({ next: (b) => this.brands.set(b), error: () => {} });
    this.api.regions().subscribe({ next: (r) => this.regions.set(r), error: () => {} });
  }

  run(p: Persona): void {
    if (this.busy()) return;
    this.error.set(null);
    this.busy.set(p.id);
    p.mint().subscribe({
      next: (res) => {
        p.apply(res);
        this.router.navigateByUrl(p.target);
      },
      error: () => {
        this.error.set(`Could not sign in as ${p.name}.`);
        this.busy.set(null);
      },
    });
  }
}
