import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Appointment, BookRequest, Brand, Slot } from './models';

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
  slots(): Observable<Slot[]> {
    return this.http.get<Slot[]>(`${this.base}/api/slots`);
  }
  appointments(): Observable<Appointment[]> {
    return this.http.get<Appointment[]>(`${this.base}/api/appointments`);
  }
  book(req: BookRequest): Observable<Appointment> {
    return this.http.post<Appointment>(`${this.base}/api/appointments`, req);
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
