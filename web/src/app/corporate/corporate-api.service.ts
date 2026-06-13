import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { HeroVm } from '../models';

// Read-only client for the corporate roll-up read model. DELIBERATELY separate
// from ApiService: the corporate dashboard reads ACROSS franchisees, so it must
// carry a corporate/regional-scoped token, never a franchisee tenant token. The
// real endpoints live under /api/corporate-dashboard/* — a prefix the tenant
// interceptor skips (see tenant.interceptor.ts), so a franchisee token can never
// reach a cross-franchisee endpoint. That seam is the read-down boundary (ADR-19).
//
// v1 returns a MOCK HeroVm so the Portfolio view + provenance treatment can be
// built and reviewed before the read model and its nightly rollup exist. The
// four measured tiles carry real-shaped 'actual' data; the four financial tiles
// carry 'unavailable' + the literal gap note (ADR-20) — never a deposit/estimate.
@Injectable({ providedIn: 'root' })
export class CorporateApiService {
  // Real impl (later): this.http.get<HeroVm>(`${base}/api/corporate-dashboard/hero`, { params })
  getHero(period: HeroVm['period']['type'] = 'QTD'): Observable<HeroVm> {
    return of(MOCK_HERO).pipe(delay(400)); // delay exercises the loading skeleton
  }
}

const REVENUE_GAP = 'Requires completed_job.invoiceAmount + territory.royalty_rate.';

const MOCK_HERO: HeroVm = {
  period: { type: 'QTD', start: '2026-04-01', end: '2026-06-30' },
  lastUpdated: '2026-06-12T06:00:00Z', // nightly rollup, not live
  metricVersion: 'v1',
  metrics: {
    // ── measured plane — real shape, derivable from Slot/Appointment/NpsSurvey ──
    activeTerritories: {
      value: 412,
      deltaPercent: 0.02,
      sparkline: [398, 401, 404, 412],
      dataQuality: 'actual',
      asOf: '2026-06-12',
    },
    atRiskTerritories: {
      value: 37,
      deltaPercent: -0.05,
      sparkline: [41, 40, 39, 37],
      dataQuality: 'actual',
      asOf: '2026-06-12',
    },
    networkNps: {
      value: 61,
      deltaPercent: 0.03,
      sparkline: [57, 58, 60, 61],
      dataQuality: 'actual',
      asOf: '2026-06-12',
    },
    newFranchiseSales: {
      value: 14,
      deltaPercent: 0.17,
      sparkline: [9, 11, 12, 14],
      dataQuality: 'actual',
      asOf: '2026-06-12',
    },
    // ── reported plane — unwired in v1; shown honestly, not faked ──
    grossSales: { value: null, dataQuality: 'unavailable', asOf: '2026-06-12', gap: REVENUE_GAP },
    royaltyRevenue: { value: null, dataQuality: 'unavailable', asOf: '2026-06-12', gap: REVENUE_GAP },
    sameTerritoryGrowth: { value: null, dataQuality: 'unavailable', asOf: '2026-06-12', gap: REVENUE_GAP },
    collectionRate: { value: null, dataQuality: 'unavailable', asOf: '2026-06-12', gap: 'Requires billing/AR integration.' },
  },
};
