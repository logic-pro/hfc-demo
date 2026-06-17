import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  ReportCatalog,
  ReportQueryRequest,
  ReportQueryResult,
  SavedReport,
  SavedReportInput,
} from './reports.models';
import { buildCatalog, deleteSaved, listSaved, runReport, saveReport } from './reports.fixtures';

/** A selectable filter member (a dimension value + its id, where the dimension has one). */
export interface DimensionMember {
  id?: number;
  label: string;
}

// Single seam between the local mock and alpha's live reporting endpoints (§C2).
// The shapes are byte-identical, so flipping `live` is the only change required —
// no component touches this decision (the dashboard's D17 fixtures→live pattern).
// Live mode is opt-in via `window.__REPORTS_LIVE__` so a deployed build can point
// at the API without a rebuild; `__API_BASE__` is shared with the dashboard.
@Injectable({ providedIn: 'root' })
export class ReportsDataService {
  private readonly http = inject(HttpClient);
  private readonly base =
    (window as { __API_BASE__?: string }).__API_BASE__ ?? 'http://localhost:5180';
  private readonly live = (window as { __REPORTS_LIVE__?: boolean }).__REPORTS_LIVE__ === true;

  // Small fixture latency so loading states are real, not theoretical.
  private readonly LATENCY = 240;

  /** id-field per id-bearing dimension, for reading members out of `dimensionKeys`. */
  private static readonly ID_FIELD: Record<string, string> = {
    brand: 'brandId',
    region: 'regionId',
    territory: 'territoryId',
    franchisee: 'franchiseeId',
  };

  catalog(): Observable<ReportCatalog> {
    if (this.live) return this.http.get<ReportCatalog>(`${this.base}/api/reports/catalog`);
    return of(buildCatalog()).pipe(delay(this.LATENCY));
  }

  run(query: ReportQueryRequest): Observable<ReportQueryResult> {
    if (this.live)
      return this.http.post<ReportQueryResult>(`${this.base}/api/reports/query`, query);
    return of(runReport(query)).pipe(delay(this.LATENCY));
  }

  /**
   * Enumerate the members of a dimension, for the filter pickers. The catalog
   * does not ship member lists, so we discover them the contract-faithful way:
   * a `territory_count`-by-dimension query whose rows carry the label (and id, via
   * `dimensionKeys`, for id-bearing dimensions). Works identically against mock
   * and live since both honour the §C2 query shape.
   */
  dimensionMembers(dimKey: string): Observable<DimensionMember[]> {
    const idField = ReportsDataService.ID_FIELD[dimKey];
    const query: ReportQueryRequest = { metrics: ['territory_count'], dimensions: [dimKey] };
    return this.run(query).pipe(
      map((res) =>
        res.rows.map((row) => ({
          label: String(row[dimKey] ?? ''),
          id: idField ? row.dimensionKeys?.[idField] : undefined,
        })),
      ),
    );
  }

  savedList(): Observable<SavedReport[]> {
    if (this.live) return this.http.get<SavedReport[]>(`${this.base}/api/reports/saved`);
    return of(listSaved()).pipe(delay(160));
  }

  save(req: SavedReportInput): Observable<SavedReport> {
    if (this.live) return this.http.post<SavedReport>(`${this.base}/api/reports/saved`, req);
    return of(saveReport(req)).pipe(delay(160));
  }

  remove(id: string): Observable<void> {
    if (this.live)
      return this.http.delete<void>(`${this.base}/api/reports/saved/${encodeURIComponent(id)}`);
    deleteSaved(id);
    return of(void 0).pipe(delay(120));
  }
}
