import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { DashboardFilters, DashboardResponse } from './dashboard.models';
import { mockDashboard } from './dashboard.mock';

/**
 * Owns the single dashboard read-model call. Mirrors the existing ApiService
 * conventions: thin, typed, returns Observables; tenancy is added by the
 * tenantInterceptor, so this knows nothing about brand/auth.
 *
 * USE_MOCK flips the whole UI between mock data and the live read-model with no
 * component changes — the mock and the API return the identical DashboardResponse.
 */
@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private http = inject(HttpClient);
  private base = (window as any).__API_BASE__ ?? 'http://localhost:5180';

  /** Live: GET /api/dashboard now exists (see API-CONTRACT.md). Flip to true to
   *  demo offline against dashboard.mock.ts — the shapes are identical. */
  private static readonly USE_MOCK = false;

  getDashboard(filters: DashboardFilters): Observable<DashboardResponse> {
    if (DashboardApiService.USE_MOCK) {
      // simulate latency so loading skeletons are visible in the demo
      return of(mockDashboard(filters)).pipe(delay(350));
    }

    let params = new HttpParams().set('period', filters.period);
    if (filters.territoryId != null) {
      params = params.set('territoryId', String(filters.territoryId));
    }
    return this.http.get<DashboardResponse>(`${this.base}/api/dashboard`, { params });
  }

  /** Territories in the franchisee's brand — populates the filter dropdown.
   *  Loaded once, in parallel with the dashboard (forkJoin) on the page. */
  getTerritories(): Observable<{ id: number; name: string }[]> {
    if (DashboardApiService.USE_MOCK) {
      return of([
        { id: 1, name: 'Orange County North' },
        { id: 2, name: 'Inland Empire' },
        { id: 3, name: 'San Diego Coast' },
      ]).pipe(delay(120));
    }
    return this.http.get<{ id: number; name: string }[]>(`${this.base}/api/dashboard/territories`);
  }
}
