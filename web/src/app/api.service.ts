import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Appointment, BookRequest, Brand, DevTokenResponse, Franchisee, IntakeDraft, RegionRef, Slot } from './models';

// Thin typed wrapper over the API. Returns Observables so callers can compose
// with RxJS (retry, switchMap, combineLatest) — the tenant header is added by
// the interceptor, so nothing here knows about tenancy.
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  // Overridable at runtime for the deployed build; defaults to the local API.
  private base = (window as any).__API_BASE__ ?? 'http://localhost:5180';

  brands(): Observable<Brand[]> {
    return this.http.get<Brand[]>(`${this.base}/api/brands`);
  }
  franchisees(): Observable<Franchisee[]> {
    return this.http.get<Franchisee[]>(`${this.base}/api/franchisees`);
  }
  // Regions back the region-manager personas in the login picker. (Provided by
  // the API alongside the RBAC scope work; the picker degrades if it's absent.)
  regions(): Observable<RegionRef[]> {
    return this.http.get<RegionRef[]>(`${this.base}/api/regions`);
  }
  // Login stand-ins (B2C/Entra). Each mints a token whose role/scope claim the
  // server authorizes by. The franchisee mint resolves the tenant; the corporate
  // roles carry network/brand/region in the claim. The mint takes `role` — the
  // CEO sends role:'corporate' (network), brand/region send their tier + id.
  token(franchiseeId: string): Observable<DevTokenResponse> {
    return this.http.post<DevTokenResponse>(`${this.base}/api/dev/token`, { franchiseeId });
  }
  networkToken(): Observable<DevTokenResponse> {
    return this.http.post<DevTokenResponse>(`${this.base}/api/dev/token`, { role: 'corporate' });
  }
  brandToken(brandId: number): Observable<DevTokenResponse> {
    return this.http.post<DevTokenResponse>(`${this.base}/api/dev/token`, { role: 'brand', brandId });
  }
  regionToken(regionId: number): Observable<DevTokenResponse> {
    return this.http.post<DevTokenResponse>(`${this.base}/api/dev/token`, { role: 'region', regionId });
  }
  slots(): Observable<Slot[]> {
    return this.http.get<Slot[]>(`${this.base}/api/slots`);
  }
  appointments(): Observable<Appointment[]> {
    return this.http.get<Appointment[]>(`${this.base}/api/appointments`);
  }
  book(req: BookRequest): Observable<Appointment> {
    return this.http.post<Appointment>(`${this.base}/api/appointments`, req);
  }
  // AI-assisted intake: free text -> typed, reviewable draft. Tenant-scoped via
  // the bearer token the interceptor attaches; the server maps onto the brand's
  // service vocabulary from the verified claim.
  parseIntake(text: string): Observable<IntakeDraft> {
    return this.http.post<IntakeDraft>(`${this.base}/api/intake/parse`, { text });
  }
  // Idempotency-Key makes a retried deposit a no-op server-side.
  deposit(appointmentId: number, amountCents: number, idempotencyKey: string): Observable<Appointment> {
    return this.http.post<Appointment>(
      `${this.base}/api/appointments/${appointmentId}/deposit`,
      { amountCents },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
  }
}
