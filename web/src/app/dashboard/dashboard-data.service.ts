import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  CorporateDashboard,
  TerritoryHealthScore,
  TerritoryListResponse,
  WatchlistResponse,
} from './dashboard.models';
import {
  buildCorporateDashboard,
  buildHealthScore,
  buildTerritoryList,
  buildWatchlist,
} from './dashboard.fixtures';

// Single seam between fixtures and live Bravo (D17). The shapes are identical
// (CONTRACT §2), so flipping `live` is the only change required — no component
// touches this decision. Live mode is opt-in via `window.__DASHBOARD_LIVE__` so a
// deployed build can point at Bravo without a rebuild (same pattern as __API_BASE__).
@Injectable({ providedIn: 'root' })
export class DashboardDataService {
  private http = inject(HttpClient);
  private base = (window as any).__API_BASE__ ?? 'http://localhost:5180';
  private live = (window as any).__DASHBOARD_LIVE__ === true;

  // Small fixture latency so loading states are real, not theoretical.
  private readonly FIXTURE_LATENCY = 220;

  corporate(period?: number, brandId?: number, regionId?: number): Observable<CorporateDashboard> {
    if (this.live) {
      return this.http.get<CorporateDashboard>(`${this.base}/api/dashboard/corporate`, {
        params: this.params({ period, brandId, regionId, trailingWindow: 12 }),
      });
    }
    return of(buildCorporateDashboard()).pipe(delay(this.FIXTURE_LATENCY));
  }

  territories(): Observable<TerritoryListResponse> {
    if (this.live) {
      return this.http.get<TerritoryListResponse>(`${this.base}/api/territories`, {
        params: this.params({ page: 1, pageSize: 50 }),
      });
    }
    return of(buildTerritoryList()).pipe(delay(this.FIXTURE_LATENCY));
  }

  healthScore(territoryId: number, period?: number): Observable<TerritoryHealthScore> {
    if (this.live) {
      return this.http.get<TerritoryHealthScore>(
        `${this.base}/api/territories/${territoryId}/health-score`,
        { params: this.params({ period }) },
      );
    }
    const score = buildHealthScore(territoryId);
    return of(score as TerritoryHealthScore).pipe(delay(160));
  }

  watchlist(): Observable<WatchlistResponse> {
    if (this.live) {
      return this.http.get<WatchlistResponse>(`${this.base}/api/dashboard/watchlist`);
    }
    return of(buildWatchlist()).pipe(delay(this.FIXTURE_LATENCY));
  }

  private params(obj: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null) out[k] = String(v);
    }
    return out;
  }
}
