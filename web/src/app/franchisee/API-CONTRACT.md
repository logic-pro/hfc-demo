# `GET /api/dashboard` — Franchisee Operations read-model contract

The frontend never aggregates raw rows. This endpoint returns a pre-shaped read
model; the SPA only formats, filters, and drills. Canonical TS types live in
[dashboard.models.ts](./dashboard.models.ts) (`DashboardResponse`).

## Request

```
GET /api/dashboard?period={WTD|MTD|QTD|YTD}&territoryId={int?}
```

- **Tenant** comes from the auth token claim (Slice A). Today the demo sends the
  brand via the existing `X-Tenant-Id` interceptor — the EF query filter scopes
  every aggregate to the franchisee. No client-supplied tenant is trusted.
- `territoryId` omitted = all territories in the franchisee's brand.

## Response — `DashboardResponse`

```jsonc
{
  "period":   { "type": "MTD", "label": "This month", "start": "...", "end": "..." },
  "lastUpdated": "2026-06-12T13:05:00Z",
  "territory": { "id": 2, "name": "Inland Empire" },   // or null for all
  "kpis": [ /* KpiDto x5: bookings, slot_fill_rate, deposit_conversion,
                deposit_volume, expired_abandoned */ ],
  "bookingTrend":       [ /* TrendPointDto: date, bookings, filledSlots, openSlots */ ],
  "depositFunnel":      [ /* FunnelStageDto, see workflow mapping below */ ],
  "territoryBreakdown": [ /* TerritoryRowDto: bookings, fillRate, depositConversion, needsActionCount */ ],
  "actionRows":         [ /* ActionRowDto: appt needing follow-up + recommendedAction */ ],
  "revenue": { "available": false, "reason": "Job revenue is not captured in this system." }
}
```

## Funnel ⇄ Durable booking workflow mapping

The funnel stages are the **actual orchestration states** from
`functions/BookingWorkflow.cs`, so the operator sees where the workflow leaks:

| Funnel stage | Workflow state | Meaning |
|---|---|---|
| `Booked` | orchestration started | appointment created |
| `Reminded` | reminder timer fired | reminder sent, awaiting deposit |
| `DepositPaid` | external event received | deposit captured (idempotent) |
| `Finalized` | orchestration completed | confirmed |
| `Expired` *(leak)* | deposit-timeout path | expired without deposit — **recoverable** |

`conversionFromPrev` is the retained ratio between consecutive happy-path stages;
the lowest one is the operator's biggest leak. `Expired` count drives the
`expired_abandoned` KPI and the red leak branch in the funnel.

## Data-quality rules (enforced server-side, surfaced in the UI)

- Every operational metric is `dataQuality: "measured"`.
- **`deposit_volume` is deposits in cents, never revenue.** `revenue.available` is
  `false` with a reason; the UI renders an explicit "Job revenue unavailable" note.
- Do not substitute estimate/quote values for realized money.

## Server sketch (minimal-API, matches `Program.cs` style)

```csharp
app.MapGet("/api/dashboard", async (string period, int? territoryId, AppDb db, ITenant t) =>
{
    var range = PeriodRange.For(period);                 // WTD/MTD/QTD/YTD → start/end
    // db is already tenant-filtered by the EF global query filter (franchisee scope).
    var vm = await DashboardReadModel.BuildAsync(db, t, range, territoryId);
    return Results.Ok(vm);                               // shape == DashboardResponse
});
```

The aggregation belongs in a `DashboardReadModel` builder (or a materialized
summary table later) — **not** inline LINQ recomputed on every request as the
dashboard grows. For the demo, building it from `Appointment`/`Slot`/workflow
status server-side is acceptable; promote to a summary table if it gets hot.
