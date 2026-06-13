# Franchisee Operations Dashboard (Slice D)

Decision served: *a franchisee finding where their territory leaks bookings/
deposits this week and what to follow up on* — answerable in <30s, click-through
to the appointments that need action.

## Component structure

```
dashboard/
  dashboard-page.component.ts     SMART container: filters (signals), data load
                                  (forkJoin + switchMap + DashboardState<T>),
                                  DTO→VM mapping, drill wiring. Imports all below.
  dashboard-api.service.ts        the single read-model call + territory lookup
                                  (USE_MOCK flag flips mock ⇄ live)
  dashboard.mock.ts               mock DashboardResponse (shaped exactly like live)
  dashboard.models.ts            *Dto (wire) + *Vm (view) + DashboardState<T>
  utils/number-format.util.ts     null-safe count/percent/currency/delta formatters
  components/                     all PRESENTATIONAL (OnPush, typed signal inputs):
    kpi-card · kpi-grid           5 hero tiles + responsive grid (drill output)
    filter-bar                    period segmented control + territory select
    chart-panel                   generic chart wrapper (swap chart lib here)
    booking-trend                 zero-dep SVG bars+line behind chart-panel
    deposit-funnel                Booked→Reminded→DepositPaid→Finalized + Expired leak
    territory-breakdown           per-territory fill / deposit-conversion bars
    action-table                  ranked follow-up list (trackBy, drill filter)
    detail-drawer                 slide-over: appointment + recommended action
    loading-skeleton · empty-state · error-panel   states
    data-quality-badge            measured / unavailable chip
```

Smart/dumb split: only `dashboard-page` talks to the service and holds state;
every `components/*` is pure input→output. Charts sit behind `chart-panel` so a
library (ECharts/Chart.js) can replace the SVG with no page change.

## Mocked vs. live

| Concern | Now (mock) | Live |
|---|---|---|
| Data source | `dashboard.mock.ts` via `DashboardApiService.USE_MOCK = true` (350ms simulated latency so skeletons show) | flip `USE_MOCK = false` → `GET /api/dashboard` (see [API-CONTRACT.md](./API-CONTRACT.md)) |
| Tenant | existing `X-Tenant-Id` interceptor | Slice A token claim — interceptor is the only swap point |
| Territory list | mock 3 territories | `GET /api/dashboard/territories` |
| Detail-drawer actions ("Send deposit link") | stubbed buttons | wire to existing `ApiService.deposit(...)` |
| Job revenue | **unavailable by design** — deposit volume only, labelled | unchanged (not in system) |

Nothing else changes between mock and live: the mock returns the identical
`DashboardResponse`, so swapping is one boolean.

## To view it

The component is self-contained and mountable. Wire it via the router (recommended):

```ts
// app.config.ts → add provideRouter; app shell → <router-outlet/>
export const routes: Routes = [
  { path: '', component: App },                       // existing booking demo
  { path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard-page.component')
      .then(m => m.DashboardPageComponent) },
];
```

Then `npm install` (pulls Tailwind v4, already added to package.json +
`.postcssrc.json` + `@import "tailwindcss"` in `styles.css`), `npm start`, open
`/dashboard`.

## Constraints honoured

Standalone + signals · OnPush everywhere · Tailwind (slate-50 page, white cards) ·
status shown with **text + colour, never colour-only** · responsive (4 KPIs/row →
stacked) · `trackBy` (`@for ... track`) on the table · debounced filters
(`debounceTime(150)` + `switchMap` cancels stale) · explicit loading/empty/error ·
deposits never labelled as revenue · charts behind a wrapper · data-fetch
separated from presentation.
