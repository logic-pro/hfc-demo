import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  ReportCatalog,
  ReportQuery,
  ReportResult,
  SaveReportRequest,
  SavedReport,
} from './reports.models';
import {
  buildCatalog,
  deleteSaved,
  listSaved,
  runReport,
  saveReport,
} from './reports.fixtures';

// Single seam between the local mock and alpha's live reporting endpoints (§C2).
// The shapes are identical, so flipping `live` is the only change required — no
// component touches this decision (same pattern as the dashboard's D17 seam).
// Live mode is opt-in via `window.__REPORTS_LIVE__` so a deployed build can point
// at the API without a rebuild; `__API_BASE__` is shared with the dashboard.
@Injectable({ providedIn: 'root' })
export class ReportsDataService {
  private readonly http = inject(HttpClient);
  private readonly base = (window as { __API_BASE__?: string }).__API_BASE__ ?? 'http://localhost:5180';
  private readonly live = (window as { __REPORTS_LIVE__?: boolean }).__REPORTS_LIVE__ === true;

  // Small fixture latency so loading states are real, not theoretical.
  private readonly LATENCY = 240;

  catalog(): Observable<ReportCatalog> {
    if (this.live) {
      return this.http.get<ReportCatalog>(`${this.base}/api/reports/catalog`);
    }
    return of(buildCatalog()).pipe(delay(this.LATENCY));
  }

  run(query: ReportQuery): Observable<ReportResult> {
    if (this.live) {
      return this.http.post<ReportResult>(`${this.base}/api/reports/run`, query);
    }
    return of(runReport(query)).pipe(delay(this.LATENCY));
  }

  savedList(): Observable<SavedReport[]> {
    if (this.live) {
      return this.http.get<SavedReport[]>(`${this.base}/api/reports/saved`);
    }
    return of(listSaved()).pipe(delay(160));
  }

  save(req: SaveReportRequest): Observable<SavedReport> {
    if (this.live) {
      return this.http.post<SavedReport>(`${this.base}/api/reports/saved`, req);
    }
    return of(saveReport(req)).pipe(delay(160));
  }

  remove(id: string): Observable<void> {
    if (this.live) {
      return this.http.delete<void>(`${this.base}/api/reports/saved/${encodeURIComponent(id)}`);
    }
    deleteSaved(id);
    return of(void 0).pipe(delay(120));
  }
}
