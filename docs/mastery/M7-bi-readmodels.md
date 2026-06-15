# M7 — BI Read Models + Provenance

> Mastery doc for the HFC Senior Full Stack Cloud Developer interview.
> Topic: CQRS-style pre-shaped read model for the franchisor-CEO dashboard, why we
> never query operational tables for it, rollup cadence + idempotency, and
> provenance/trust as a first-class, signature feature.
>
> Cross-links: [[M4-data-modeling-efcore]] (the operational plane + the global
> tenant query filter this read model deliberately steps around) and
> [[M5-rbac-hierarchy]] (the brand→region→territory scope lens applied at request time).

---

## 1. Mental model

There are **two planes** in HFC, on opposite sides of the franchisee data-controller
boundary:

- **Operational plane** — the live transactional tables (`Slot`, `Appointment`,
  `MonthlyReport`, `NpsSurvey`, …). Tenant-isolated by a fail-closed `FranchiseeId`
  global query filter (see [[M4-data-modeling-efcore]]). Franchisees own these rows.
- **Corporate read model (`report` plane)** — `TerritoryPeriodSummary` +
  `WatchlistFlag`. Wide, pre-shaped, pre-scored, one row per `(territory_id, period_id)`.
  **No** tenant query filter. The CEO dashboard reads **only** here.

The seam between "write/aggregate" and "read/project" is classic **CQRS**:

```
operational writes ──┐
                     ▼
            Rollup.Recompute()  ← the ONE cross-tenant aggregator (write side)
                     │  IgnoreQueryFilters() crosses the tenant boundary on purpose
                     ▼
   TerritoryPeriodSummary + WatchlistFlag   (pre-shaped, pre-scored read model)
                     │
                     ▼
   DashboardEndpoints  ← request-time PROJECTION ONLY: filter / sort / scope (read side)
```

The single rule that makes this defensible: **all aggregation, scoring, and
trailing-window math happens in the rollup; the request path only filters, sorts,
paginates, and scopes.** If you ever find yourself aggregating in an endpoint, you've
broken the model.

`api/Dashboard/DashboardReadModel.cs:9-13`:

```csharp
// Governance (corporate-rollup-readmodel-architect + franchise-kpi-metric-guard):
//   • Scores, roll-ups, watchlist flags, and drivers are PRE-COMPUTED ...
//   • Request-time handlers do projection only: filter / sort / paginate / scope.
//     No aggregation, no scoring, no trailing-window math on the request path.
```

---

## 2. Why NOT query the operational tables for the dashboard

This is ADR-18. Four reasons converge, and you should be able to recite all four.

**`docs/decisions.md:138-149` (ADR-18):**

> three reasons converge — (1) **boundary**: franchisees are data controllers;
> corporate is entitled to *aggregates*, not raw rows ... (2) **cost**: 2,600
> territories × rolling-12-mo windows × a 15-input score is a latency cliff that
> would contend with franchisees' live booking writes; (3) **consistency**: one
> KPI definition, reproducible snapshots.

Mapped to the named failure forces:

1. **Noisy-neighbor / lock contention (cost).** A CEO loading a portfolio dashboard
   would fan out heavy `GROUP BY` scans across 2,600 territories × 12-month windows.
   Those scans contend with franchisees' live booking writes on the transactional
   path — the executive's curiosity must never slow an operator's checkout.
2. **Shape mismatch.** The operational tables are normalized for *writes*
   (one `Slot`, one `Appointment` row). The dashboard wants a *wide, denormalized*
   row per `(territory, period)` with brand/region names, four sub-scores, and
   provenance baked in. Re-deriving that shape per request is wasted, repeated work.
3. **The read-down crosses tenants.** This is the subtle one. A corporate consolidated
   view must read **across** franchisees — exactly what the fail-closed `FranchiseeId`
   filter forbids. So the read model lives **outside** the filter on the other side of
   the controller boundary (ADR-19), and exactly **one** code path is allowed to bypass
   the filter. Reusing the operational `DbContext` with the filter disabled per-query
   was rejected: *one bypass bug = a cross-tenant leak*.

**`docs/decisions.md:159-161` (ADR-19):**

> **Alternative:** reuse the operational DbContext with the filter disabled per-query
> — rejected: one bypass bug = cross-tenant leak; a physically separate schema/role
> makes leakage structurally impossible.

The corporate read model carries **no** tenant filter by design —
`api/ReadModel.cs:7-11`:

```csharp
// is read-only and scope-filtered by Bravo before query. There is deliberately
// NO tenant query filter on these entities: they are the corporate plane, and
// the franchisee/corporate lens is a scope filter applied pre-query, per the
// CONTRACT RBAC decision — not row-level tenancy.
```

So tenancy on the read side is **not** row-level — it's a **scope predicate** applied
at request time (`scope.Allows(...)`, see [[M5-rbac-hierarchy]]). One read model,
three lenses (corporate = all; regional ops = their region; franchisee = own rows).

---

## 3. The cross-tenant aggregator (the one sanctioned bypass)

`Rollup.Recompute` is the *only* reader allowed to cross the tenant boundary, and it
does so explicitly with `IgnoreQueryFilters()`.

`api/Rollup.cs:61-68`:

```csharp
// ADR-19: RecomputeRollup is the ONE sanctioned corporate cross-tenant
// aggregator. IgnoreQueryFilters() deliberately bypasses the FranchiseeId
// tenant boundary here — the franchisor is entitled to consolidate its
// whole network into the read model. This is the only code path allowed
// to read across franchisees; every request-time reader stays filtered.
var territories = db.Territories.IgnoreQueryFilters().AsNoTracking()
    .Where(t => t.RegionId != null)           // dashboard set only
    .ToList();
```

It pulls the measured plane the same way — cross-tenant, `AsNoTracking`, grouped in
memory by `(territory, YYYYMM)`. `api/Rollup.cs:73-84`:

```csharp
var slots = db.Slots.IgnoreQueryFilters().AsNoTracking()
    .Where(s => terrIds.Contains(s.TerritoryId)).ToList();
var appts = db.Appointments.IgnoreQueryFilters().AsNoTracking()
    .Where(a => terrIds.Contains(a.TerritoryId)).ToList();

var slotAgg = slots
    .GroupBy(s => (s.TerritoryId, Period: Pid(s.StartUtc)))
    .ToDictionary(g => g.Key, g => (
        Total: g.Count(),
        Booked: g.Count(s => s.IsBooked),
        AsOf: g.Max(s => s.StartUtc)));   // the as-of stamp = latest measured data date
```

Note: it is **read-only operationally** — its only *writes* are to the read model
(`territory_period_summary` + `watchlist_flag`), `api/Rollup.cs:9-10`.

---

## 4. Rollup cadence + the idempotency requirement we hardened

**Cadence (demo):** one **boot / on-demand** full rebuild — not a streaming/incremental
update. `api/Rollup.cs:17-19`:

```csharp
// Cadence for the demo is one on-demand/boot rebuild (CONTRACT decision). It is a
// full rebuild — idempotent: clears the read model and rewrites it, so re-runs
// never duplicate rows or flags.
```

(In production this is the nightly job of ADR-18; the demo collapses it to a boot/on-demand
rebuild. Same contract: a full deterministic recompute.)

**Idempotency — the hardening.** A full rebuild that *appends* would crash on the second
run: `TerritoryPeriodSummary` is keyed on `(TerritoryId, PeriodId)` and `WatchlistFlag`
on a deterministic id, so re-inserting the same keys is a **duplicate-key violation**.
The fix is **clear-then-rewrite, in that order**, before any new rows are added.

`api/Rollup.cs:171-173`:

```csharp
db.WatchlistFlags.RemoveRange(db.WatchlistFlags);
db.TerritoryPeriodSummaries.RemoveRange(db.TerritoryPeriodSummaries);
db.SaveChanges();
```

Two belt-and-suspenders details that make re-runs safe even mid-rebuild:

- **Deterministic flag ids.** `api/Rollup.cs:311` / `api/ReadModel.cs:68`:

  ```csharp
  WatchlistFlagId = $"WF-{cur.Terr.Id}-{cur.PeriodId}-{key}",
  ```
  > `api/ReadModel.cs:68` — "the id is deterministic so a re-run is idempotent (no duplicate flags)."

  Because the id is a pure function of `(territory, period, flagKey)`, the same input
  always produces the same id — there is no monotonic counter that drifts across runs.

- **The composite read-model key.** `TerritoryPeriodSummary` is one row per
  `(territory_id, period_id)` (`api/ReadModel.cs:13-14`, `:17` `:30`), so a rebuild
  produces exactly the same row set, not a growing one.

**This is a real bug we fixed:** the original rollup wrote rows without the
`RemoveRange` clear, so the *first* boot succeeded and the *second* on-demand rebuild
threw a duplicate-key crash on `SaveChanges`. The fix made `Recompute` a true
idempotent full rebuild — clear, then rewrite — so the job is safe to run any number of
times and always converges to the same read model.

---

## 5. Provenance / trust as a first-class concern (the signature feature)

This is the part that wins the interview. HFC does **not** yet own the franchisees'
financial plane in this app — gross sales, royalty, MRR are *self-reported* and *lag*
the monthly royalty cycle. Shipping those numbers as if they were measured would turn
an estimate into a decision input. So **every metric carries its own provenance**, and a
seeded value can *never* render as measured.

### Three provenance fields ride on every metric

ADR-20 mandates the trio. On the read model (`api/ReadModel.cs:59-63`):

```csharp
// ── provenance / freshness (per-row summary) ─────────────────────────────
public DateTime? AsOfMeasured { get; set; }
public DateTime? AsOfReported { get; set; }
public string RefreshStatus { get; set; } = ""; // current | stale | missing | pending | seeded
```

On every metric DTO (`api/Dashboard/DashboardReadModel.cs:107-110`, `VitalSign`):

```csharp
public sealed record VitalSign(
    string MetricKey, string Label, double Value, string Unit,
    string? TrendDirection, double? TrendPercent,
    string ProvenanceType, string AsOfDate, string RefreshStatus, string ConfidenceLevel);
```

`DriverData` was extended so **every** metric the dashboard emits satisfies the
ADR-20 invariant — `api/Dashboard/DashboardReadModel.cs:95-98`:

```csharp
// CONTRACT §2 v1.3, additive: drivers now carry refreshStatus too, so EVERY
// metric the dashboard emits satisfies the ADR-20 invariant (provenanceType +
// asOfDate + refreshStatus).
```

### Two planes: measured vs seeded (deposits/estimates are never revenue)

The read model physically separates the two planes — `api/ReadModel.cs:35-48`:

```csharp
// ── measured plane (real — derived from Slot/Appointment) ────────────────
public int JobsCompleted { get; set; }
public double SlotFillRate { get; set; }      // 0..1
public double NoShowRate { get; set; }        // 0..1

// ── seeded plane (illustrative; labeled in API) ──────────────────────────
public double GrossRevenue { get; set; }
...
public int NpsScore { get; set; }             // 0..100; seeded -> measured on Slice C
```

ADR-20 spells out the trust argument — `docs/decisions.md:172-177`:

> the CEO's headline numbers live in a plane HFC doesn't yet own in this app; shipping
> them unlabeled turns a self-reported estimate into a decision input. The deposit
> (ADR-07) is a stub and the estimate is a quote — substituting either for realized
> revenue is the classic vanity-metric failure. **Alternative:** show one blended number
> — rejected: false confidence.

### NPS is measured *only* when real surveys exist (the hardening)

Round-3 hardening: NPS moved from the seeded plane to **measured-from-surveys**, but if
a territory has no survey rows it falls back to the seeded value — *and records that the
fallback is not measured*, so it can never read as measured downstream.

`api/Rollup.cs:126-132`:

```csharp
// NPS provenance (round 3 / ADR-20 hardening): NPS is MEASURED only when
// the territory has real survey rows. With none, we fall back to the
// seeded report value ... but we record that this row's NPS is NOT measured, so
// it can never be presented as measured downstream. The fallback is the seeded value
// (never the 0 that an empty survey set would average to).
bool npsMeasured = npsByTerr.TryGetValue(r.TerritoryId, out var measuredNps);
```

That boolean flows straight into `RefreshStatus` — `api/Rollup.cs:237`:

```csharp
RefreshStatus = !x.Reported ? "pending" : x.NpsMeasured ? "current" : "seeded",
```

So `refresh_status` is derived from real provenance, not hand-set: a reported row whose
headline customer metric is *not* survey-measured is stamped `"seeded"`, never `"current"`.

### Why this builds executive trust

A CEO who catches the dashboard inflating a self-reported number once will stop trusting
*every* number on it. Honest provenance does the opposite: by clearly labeling
`System Revenue LTM` as `seeded` / `illustrative` while `Jobs Completed LTM` is `measured`
/ `current`, the dashboard says "here's exactly how much to trust each tile." Executives
trust an instrument that *knows its own error bars* far more than one that projects false
precision. And ADR-20 makes the upgrade path painless: when POS/billing lands, flip the
field to `actual` — **the API contract is unchanged**, the `value` just goes non-null
(`docs/decisions.md:176-177`).

---

## 6. HFC tie-in — the franchisor-CEO executive dashboard

The whole surface is the **Portfolio → Brand → Region → Territory** BI dashboard a
franchisor CEO uses to run network economics (not operator workflow). The corporate
endpoint requires the `Corporate` role and refuses any narrower scope, because the
roll-up is a portfolio aggregate and narrowing it would force forbidden request-time
re-aggregation — `api/Dashboard/DashboardEndpoints.cs:29-34`:

```csharp
// The corporate roll-up is a portfolio aggregate; narrowing it to one
// franchisee would require request-time re-aggregation (forbidden).
// A franchisee uses the territory-scoped endpoints instead.
if (!scope.IsCorporate)
    return Results.Problem(statusCode: 403,
        title: "Corporate scope required for the corporate dashboard.");
```

The same endpoint maps each pre-rolled `VitalSign` straight to a `MetricDto`, passing
provenance through untouched — `api/Dashboard/DashboardEndpoints.cs:43-45`:

```csharp
roll.VitalSigns.Select(v => new MetricDto(
    v.MetricKey, v.Label, v.Value, v.Unit, v.TrendDirection, v.TrendPercent,
    v.ProvenanceType, v.AsOfDate, v.RefreshStatus, v.ConfidenceLevel)).ToList(),
```

The health score (ADR-21) is four versioned, tenure-curved sub-scores; the composite is
**for sort/color only** (`api/ReadModel.cs:55`, `docs/decisions.md:179-189`). A naked
composite would mask a collapsing-NPS territory behind lagging-but-strong financials —
so the dashboard always exposes the four sub-scores and their drivers, with provenance
on each driver.

---

## 7. Trade-offs

| Axis | Read model (what we chose) | Live query (rejected) |
|---|---|---|
| **Freshness** | Stale between rebuilds (boot/on-demand; nightly in prod) | Sub-second fresh |
| **Latency** | O(1) projection; no scans | Latency cliff on 2,600 territories |
| **Transactional impact** | Zero contention with booking writes | Noisy-neighbor / lock contention |
| **Tenant safety** | One sanctioned bypass; structurally isolated | One bypass bug = cross-tenant leak |
| **KPI consistency** | One definition, reproducible snapshots | Definition drifts per query |
| **Shape** | Pre-denormalized wide rows | Re-derive shape every request |

The honest cost is **staleness**. We accept it because this is an *executive* surface —
the CEO makes monthly/quarterly capital and intervention decisions, not minute-by-minute
ones. ADR-18's revisit clause is explicit: *if a metric needs sub-day freshness for an
operational dashboard, that's a different surface, not this one* (`docs/decisions.md:148-149`).

---

## 8. Failure modes

1. **Rollup not idempotent → duplicate-key crash on rebuild (the real bug).** Without the
   `RemoveRange` clear (`api/Rollup.cs:171-173`), the second boot/on-demand rebuild re-inserts
   the same `(territory_id, period_id)` rows / deterministic flag ids and `SaveChanges` throws.
   First run green, second run red — the nastiest kind of bug because boot smoke tests pass.
   Fixed by clear-then-rewrite + deterministic ids.
2. **Seeded value shown as measured.** If a metric's `provenanceType`/`refreshStatus` were
   hand-set instead of derived, a seeded number could render with a "LIVE"/measured badge —
   the classic vanity-metric / false-confidence failure ADR-20 exists to prevent. Guard:
   `RefreshStatus` is *computed* from `NpsMeasured` / `Reported` (`api/Rollup.cs:237`), never
   asserted.
3. **Empty-survey averages to 0.** Averaging zero survey rows yields NPS 0 — a fake
   "collapsed" signal. Guard: fall back to the seeded historical value, flagged not-measured
   (`api/Rollup.cs:126-132`).
4. **Aggregating on the request path.** Sneaking a `GROUP BY` / trailing-window into an
   endpoint re-introduces the latency cliff and KPI drift the read model was built to kill.
   Guard: endpoints are projection-only by contract (`DashboardReadModel.cs:9-13`).
5. **Read-side tenant leak.** Forgetting `scope.Allows(...)` before projecting watchlist /
   territory rows would expose another franchisee's rows (the read model has no row filter on
   purpose). Guard: scope-first in every handler (`DashboardEndpoints.cs:88,111,137`).

---

## 9. Interview defense — follow-ups + answers

**Q: Isn't a read model just a stale cache? Why not DirectQuery / live SQL against the
operational DB?**
A: Three things a cache doesn't give you. (1) It's the *only* thing the dashboard *can*
see — it enforces the franchisee-data-controller boundary structurally, not by discipline.
(2) It decouples release cycles and keeps heavy analytical scans off the transactional path
(noisy-neighbor). (3) It pins one reproducible KPI definition. Live DirectQuery was the
explicit rejected alternative in ADR-18 — it couples release cycles, stresses the booking
path, and leaks franchisee-private rows.

**Q: You bypass the tenant filter with `IgnoreQueryFilters()`. Isn't that exactly the
cross-tenant leak you're trying to avoid?**
A: It's the *one* sanctioned bypass, in the *one* job that's supposed to read across
franchisees — corporate consolidating its own network is legitimate oversight (read-*down*).
The filter still blocks franchisee-reads-*sideways*. The risk with the rejected alternative
(disable the filter per-query on the operational context) is that *any* query could forget to
re-enable it — one bug = a leak. Here the write side has a single audited bypass and the read
side is a physically separate plane with no filter and no operational write access.

**Q: How do you guarantee the rebuild is safe to run repeatedly — at boot, on demand, after
a crash mid-run?**
A: It's a full idempotent rebuild: `RemoveRange` both read-model tables and `SaveChanges`
*before* writing any new rows (`api/Rollup.cs:171-173`), flag ids are deterministic functions
of `(territory, period, flagKey)` (`api/Rollup.cs:311`), and the summary is keyed on
`(territory_id, period_id)`. So every run converges to the same row set with no duplicates.
We hit the duplicate-key crash exactly because the first version appended; clear-then-rewrite
fixed it.

**Q: Why bother labeling provenance instead of just shipping the best numbers you have?**
A: Because an executive who catches one inflated number distrusts the whole instrument.
Financial fields are self-reported and lag the royalty cycle; a deposit is a stub and an
estimate is a quote — calling either "revenue" is the textbook vanity-metric failure (ADR-20).
Labeling `measured` vs `seeded`/`illustrative` with an `as_of` date tells the CEO exactly how
much to trust each tile, and the contract is upgrade-safe: when billing integrates, flip the
field to `actual` and `value` goes non-null — no API change.

---

## 10. Demo proof

- **`GET /api/dashboard/corporate`** (`Corporate` role; `DashboardEndpoints.cs:24-53`)
  returns the pre-rolled vital signs. The "measured vs illustrative" tiles are visible in
  the payload: measured/`current` tiles —
  `Jobs Completed LTM`, `Active Territories`, `Network Slot Fill Rate`, `At-Risk Territories`
  (`StubDashboardReadModel.cs:209-216`) — vs seeded/`illustrative` tiles —
  `System Revenue LTM`, `Royalty Revenue LTM`, `Same-Territory Growth`, `Network NPS`
  (`StubDashboardReadModel.cs:217-224`).
- A portfolio-level **data note** says it plainly — `StubDashboardReadModel.cs:249`:
  *"Financial metrics are illustrative/seeded and lag measured operational metrics."*
- **`GET /api/territories/{id}/health-score`** (`DashboardEndpoints.cs:56-77`) shows the
  four sub-scores + per-driver provenance (`nps_score` = `seeded`, `slot_fill_rate` /
  `no_show_rate` = `measured`; `StubDashboardReadModel.cs:160-162`).
- **`GET /api/dashboard/watchlist`** (`DashboardEndpoints.cs:80-103`) returns the
  pre-computed flag rows, severity-sorted, scope-filtered.
- **Idempotency proof:** run the rollup twice (boot + on-demand). It succeeds both times and
  returns the identical row/flag set — no duplicate-key crash.

---

## Flashcards

1. **Q:** Where does the CEO dashboard read from? **A:** Only the corporate read model
   (`TerritoryPeriodSummary` + `WatchlistFlag`) — never operational tables (ADR-18).
2. **Q:** Name the three reasons not to query operational tables. **A:** Boundary
   (aggregates not raw rows), cost (noisy-neighbor latency cliff vs booking writes),
   consistency (one reproducible KPI definition). Plus: the read-down crosses tenants.
3. **Q:** What's CQRS-shaped about it? **A:** Write side = `Rollup.Recompute` aggregates +
   scores; read side = endpoints project (filter/sort/scope) only.
4. **Q:** How does the rollup legitimately cross tenants? **A:** `IgnoreQueryFilters()` —
   the one sanctioned bypass (ADR-19), `api/Rollup.cs:66`.
5. **Q:** Why no tenant query filter on the read model? **A:** The whole point is to read
   *across* franchisees; tenancy on the read side is a *scope predicate* at request time,
   not row-level (`api/ReadModel.cs:7-11`).
6. **Q:** What is the rollup cadence? **A:** One boot/on-demand full rebuild (nightly job in
   prod) — a deterministic full recompute, `api/Rollup.cs:17-19`.
7. **Q:** What makes the rebuild idempotent? **A:** `RemoveRange` both tables +
   `SaveChanges` before writing (`Rollup.cs:171-173`); deterministic flag id
   `WF-{terr}-{period}-{key}`; composite `(territory_id, period_id)` key.
8. **Q:** What's the duplicate-key bug? **A:** An *appending* rebuild crashes on the 2nd run
   (re-inserts same keys). Fix: clear-then-rewrite.
9. **Q:** Name the provenance trio on every metric. **A:** `provenanceType` (measured|seeded|
   …), `asOfDate`, `refreshStatus` (current|stale|missing|pending|seeded).
10. **Q:** Which plane is revenue in, and why never shown as measured? **A:** Seeded/reported
    plane — self-reported, lags the royalty cycle; a deposit is a stub, an estimate is a quote
    (ADR-20).
11. **Q:** When is NPS measured vs seeded? **A:** Measured only with real `NpsSurvey` rows;
    else seeded fallback flagged not-measured → `RefreshStatus="seeded"` (`Rollup.cs:126-132,237`).
12. **Q:** What's the composite health score used for? **A:** Sort/color only; the four
    versioned, tenure-curved sub-scores carry the meaning (ADR-21).

---

## Mock Q&A

**1. Walk me through the data flow from a booking to a tile on the CEO dashboard.**
A booking writes a `Slot`/`Appointment` on the tenant-filtered operational plane. The
boot/on-demand `Rollup.Recompute` reads those cross-tenant via `IgnoreQueryFilters()`
(`Rollup.cs:66,73-76`), groups by `(territory, YYYYMM)`, computes the four sub-scores +
composite + watchlist flags, and writes `TerritoryPeriodSummary` / `WatchlistFlag` —
after first clearing them so the rebuild is idempotent. `GET /api/dashboard/corporate`
then projects the pre-rolled `VitalSign`s into DTOs, passing provenance through untouched.
No aggregation on the request path.
- *Follow-up: where could a tenant leak sneak in?* On the read side, if a handler projects
  watchlist/territory rows without `scope.Allows(...)` first — the read model has no row
  filter on purpose, so scope-first is mandatory.

**2. The rollup crashed the second time it ran. Diagnose and fix.**
Classic non-idempotent full rebuild: the first boot inserted rows, the second re-inserted
the same `(territory_id, period_id)` rows and deterministic flag ids → duplicate-key
violation on `SaveChanges`. Fix is clear-then-rewrite: `RemoveRange` both tables and
`SaveChanges` before adding (`Rollup.cs:171-173`), keep flag ids a pure function of
`(territory, period, key)`. Now any number of runs converge to the same set.
- *Follow-up: why not just `INSERT ... ON CONFLICT UPDATE` / upsert?* Could work, but a full
  clear-rewrite also drops rows that no longer apply (e.g., a watchlist flag that cleared),
  which an upsert would leave stale. For a full deterministic snapshot, rebuild is simpler and
  provably convergent.

**3. The CEO sees "System Revenue LTM: $X". How do you keep that honest?**
That tile is on the seeded/reported plane — self-reported, lagging the royalty cycle. It's
emitted with `provenanceType="seeded"`, `refreshStatus="seeded"`, an `as_of` reported date,
and a portfolio data note saying financials are illustrative and lag measured metrics
(`StubDashboardReadModel.cs:217-224,249`). It is structurally separate from measured tiles
like Jobs Completed. A deposit/estimate is never substituted for realized revenue (ADR-20).
- *Follow-up: what changes when POS/billing integrates?* Flip the field to `actual` and the
  `value` goes non-null — the API contract is unchanged (ADR-20 revisit clause).

**4. Why is `IgnoreQueryFilters()` safe here but dangerous in the operational app?**
Here it's a single audited code path whose *job* is cross-tenant consolidation (read-down
oversight), writing to a physically separate `report` plane with no operational write access.
In the operational app, disabling the filter per-query means *any* query could forget to
re-enable it — one bug = a sideways cross-tenant leak. ADR-19 chose structural isolation over
per-query discipline for exactly this reason.
- *Follow-up: how would you enforce that only one path bypasses?* Code review + an ADR + the
  separate-schema/role boundary; longer-term, move `report` to its own DB/warehouse so the
  operational role physically can't read it.

**5. Why expose four sub-scores instead of one composite number?**
A naked composite can hide *why*: a collapsing-NPS territory can be masked behind
lagging-but-strong financials. The four versioned, tenure-curved sub-scores (financial,
customer, growth, compliance) preserve the signal; the composite is sort/color only
(ADR-21, `ReadModel.cs:55`). Each driver also carries provenance so the CEO sees both the
number and how much to trust it.
- *Follow-up: why version the weights?* Un-versioned weights silently break every historical
  trend the moment Franchise Ops re-weights; stamping each row with `ScoreVersion`
  (`franchise_ops_v1`) keeps scores reproducible and auditable.

---

### See also
- [[M4-data-modeling-efcore]] — the operational plane and the fail-closed `FranchiseeId`
  global query filter this read model deliberately sits outside of.
- [[M5-rbac-hierarchy]] — the brand→region→territory scope lens (`scope.Allows`,
  `IsCorporate`) applied at request time to the one read model.
