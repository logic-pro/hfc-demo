# HFC Interview — Fast-Recall Cheat Sheet

Day-of recall for the **Senior Full Stack Cloud Developer** interview. One scan before you walk in.
Deep-dives: [M1](M1-multitenancy.md) · [M2](M2-aspnetcore-backend.md) · [M3](M3-api-contracts.md) · [M4](M4-data-modeling-efcore.md) · [M5](M5-rbac-hierarchy.md) · [M6](M6-angular-spa.md) · [M7](M7-bi-readmodels.md) · [M8](M8-azure-durable.md) · [M9](M9-cicd-prod.md) · M10 (reliability/integrations — see README, file pending).

---

## 1. The stack (layer → tech → proof file in this repo)

| Layer | Tech | Proof file |
|---|---|---|
| SPA | Angular 20 (standalone, signals, RxJS) | `web/src/app/*` (HTTP interceptor, login, dashboards) → [M6](M6-angular-spa.md) |
| API | ASP.NET Core 9 minimal API | `api/Program.cs` → [M2](M2-aspnetcore-backend.md) |
| Auth/tenant | Token-claim tenant + role resolver | `api/Auth.cs` (`TenantResolver.Populate`) → [M1](M1-multitenancy.md) [M5](M5-rbac-hierarchy.md) |
| Tenant isolation | EF Core global query filter, fail-closed | `api/AppDb.cs` (`HasQueryFilter` on `FranchiseeId`) → [M1](M1-multitenancy.md) [M4](M4-data-modeling-efcore.md) |
| Domain model | EF Core entities (Slot/Appointment/Estimate/NpsSurvey) | `api/Domain.cs`, `api/AppDb.cs` → [M4](M4-data-modeling-efcore.md) |
| Concurrency | Optimistic concurrency token → 409 | `api/Program.cs` (`Slot.Version` as `IsConcurrencyToken`) → M10 |
| Idempotency | `Idempotency-Key` on deposit | booking/deposit endpoint → M10 |
| BI read model | `report`-schema roll-up, outside the tenant filter | `api/Rollup.cs` (`RecomputeRollup`), `api/ReadModel.cs`, `api/Dashboard/*` → [M7](M7-bi-readmodels.md) |
| RBAC scope | corporate / regional lens = query predicate | `api/Dashboard/DashboardScope.cs` → [M5](M5-rbac-hierarchy.md) |
| Orchestration | Azure Durable Functions (.NET isolated) | `functions/BookingWorkflow.cs`, `functions/NpsWorkflow.cs` → [M8](M8-azure-durable.md) |
| DB | SQLite local / Azure SQL prod | `api/Program.cs` (`UseSqlite`; swaps on `deploySql=true`) |
| IaC / deploy | Bicep + deploy.sh | `infra/main.bicep`, `infra/deploy.sh` → [M8](M8-azure-durable.md) [M9](M9-cicd-prod.md) |
| CI gate | build + test + web AOT + smoke | `.github/workflows/ci.yml` → [M9](M9-cicd-prod.md) |
| Contract | frozen DTOs / ProblemDetails | `docs/dashboard/CONTRACT.md` → [M3](M3-api-contracts.md) |

---

## 2. The six questions interviewers always ask (2-sentence killers)

1. **Tenant isolation — A never sees B.** Tenant comes from a *verified token claim* (`api/Auth.cs`), and every tenant-scoped entity has one EF global query filter on `franchiseeId` in `api/AppDb.cs` that is **fail-closed** — no claim, zero rows. Isolation lives in one auditable seam, not sprinkled `WHERE` clauses, so cross-tenant leakage has a single place to get right. → [M1](M1-multitenancy.md)

2. **Region-manager RBAC.** The role + scope ride in the token claim; a regional manager's scope becomes a *query predicate* (`api/Dashboard/DashboardScope.cs`) — corporate = all, regional = their region — so it's **one read model, three lenses**, not three apps. The corporate dashboard never widens the operational tenant filter; it reads the separate `report` plane. → [M5](M5-rbac-hierarchy.md)

3. **Why read models, not operational tables, for the dashboard.** Three reasons converge: **boundary** (franchisees are data controllers — corporate is entitled to aggregates, not raw rows), **cost** (2,600 territories × rolling-12-mo × a multi-input score would contend with live booking writes), and **consistency** (one KPI definition, reproducible snapshots). The read model makes "aggregates only" the *only* thing the dashboard can see. → [M7](M7-bi-readmodels.md) [ADR-18/19]

4. **Why Durable Functions, not a chained queue.** The post-booking flow (confirm → reminder → await-deposit-or-durable-timer-timeout → finalize/expire) spans minutes-to-days and must survive deploys and scale-to-zero; a `Task.Delay` on a background thread dies on restart, and a queue+cron is more glue to manage. Durable replays from history, so the long-lived state is durable without me hand-rolling a state machine. → [M8](M8-azure-durable.md) [ADR-08]

5. **Idempotent + crash-safe deposit.** The deposit carries an `Idempotency-Key` so a retry on an at-least-once network is a no-op, never a double-charge; booking itself uses optimistic concurrency (`Slot.Version`) → **409** for the loser. Crash-safety comes from the Durable orchestration owning the await-and-timeout, so a deploy mid-flight resumes instead of losing the appointment. → M10 [M8](M8-azure-durable.md) [ADR-06/07/08]

6. **Versioning without breaking franchisees.** DTOs in `docs/dashboard/CONTRACT.md` are **frozen byte-for-byte**; changes are *additive* (new optional fields) and a breaking change bumps the contract version rather than mutating a live shape. New data sources flip provenance in place (e.g. NPS `seeded → measured`) — a one-line source swap, contract unchanged. → [M3](M3-api-contracts.md)

---

## 3. Killer one-liners (drop these verbatim)

- "**`franchiseeId` is the isolation boundary; `brandId` is grouping — different axes.**" (A Budget Blinds Irvine owner must never see Budget Blinds Dallas.) [ADR-16]
- "Tenant comes from the **verified token claim, never a spoofable header** — the query filter is unchanged, only the *source* of the id moves." [ADR-05]
- "The query filter is **fail-closed**: no tenant → no rows. The scary failure is leakage, so the default is nothing."
- "Isolation lives in **one enforced seam** I can audit, not in every WHERE clause."
- "Optimistic concurrency, not pessimistic — booking conflicts are rare; a lock per slot would serialize throughput and risk deadlocks. The loser gets a **409**." [ADR-06]
- "Idempotency is **designed in, not bolted on** — at-least-once networks mean a retry must never double-charge."
- "A `Task.Delay` on a hosted background thread **dies on every deploy**; Durable Functions **replay from history**, so state is durable without me managing it."
- "The corporate dashboard reads the **read model, never operational tables** — that's the data-controller boundary made structural." [ADR-18]
- "The read model lives **outside** the EF query filter, in a separate `report` plane — one bypass bug in the operational context = a cross-tenant leak, so I made it physically separate." [ADR-19]
- "**Deposits and estimates are never shown as revenue** — a deposit is a stub, an estimate is a quote; substituting either is the classic vanity-metric failure." [ADR-20]
- "Every metric carries **provenance + `asOfDate` + refresh status** (measured vs reported/seeded/unavailable) — shipping an unlabeled estimate turns it into a decision input."
- "The health score is **four versioned, tenure-curved sub-scores**; the composite is for sort/color only — a naked number hides a collapsing-NPS territory behind strong lagging financials." [ADR-21]
- "Weights live in a config table owned by **Franchise Ops, not constants in code** — un-versioned weights silently break every historical trend the day Ops re-weights."
- "**One read model, three lenses** — RBAC scope is a query predicate, not three apps." [ADR-19]
- "**CI green is the merge authority**, not self-reports — learned the hard way when a self-reported-green lane went red on the integrated trunk."

---

## 4. Numbers to know

- **8 brands** (catalog); the dashboard demo set spans **3 brand archetypes**.
- **2 regions**, **~24 territories** with real-ish coords + a tenure spread, **~18 months** of monthly history. (Seed: `api/Seed.cs`.)
- Production scale framing: **2,600+ territories** across the 8 brands. [ADR-01/18]
- **Health score:** four sub-scores (financial / customer / growth / compliance), 0–100, + composite for sort/color only. [ADR-21]
- **Measured KPIs (real in demo):** `jobs_completed`, `slot_fill_rate`, `no_show_rate`.
- **Reported/seeded KPIs (labeled Illustrative):** `gross_revenue`, `royalty_*`, `same_territory_growth`, `mrr`, `nps_score`.
- Sample contract figures: **18,520 jobs completed LTM**; **4 territories at-risk** on the watchlist.
- **4 engineered at-risk stories:** Atlanta North (collapsing NPS), Miami-Dade (revenue deterioration), Raleigh-Durham (no-show spike), Richmond (royalty-late → pending compliance).

---

## 5. Honest caveats (volunteer these — never get caught overclaiming)

- **Demo uses an `X-Tenant-Id` header / Development-mode dev-login** → insecure/spoofable. Prod resolves tenant + role from the AD B2C token claim; **the query filter is identical, only the source moves**. *(The #1 thing to volunteer.)* [ADR-05]
- **Row-level (shared-schema) isolation** is the cheapest, least-isolated model. At HFC scale I'd argue **database-per-tenant + elastic pools** for hard data residency / noisy-neighbor isolation. [ADR-04]
- **Idempotency** is stored per-appointment, not in a dedicated idempotency-key table caching the full response. Real payments → **Stripe hosted elements** (stay out of PCI scope) + a proper idempotency store + reconciliation. [ADR-07]
- **SQLite local / Azure SQL prod** — SQLite serializes writers, so true write concurrency only shows on Azure SQL; the `int` version token stands in for `rowversion`. [ADR-06/10]
- **`EnsureCreated()` + startup seed, not Migrations** — zero-setup for the demo; any real deploy moves to **EF Migrations**. [ADR-09]
- **Stripe / Twilio / SendGrid are roadmap** — the deposit is a stub and reminders are orchestrated but not yet sent via a real provider. → M10
- **SPA served same-origin from the API App Service** (SWA upload was proxy-blocked); deployed to **centralus** (free-sub quota was 0 in eastus2). [ADR-11/12]
- **NPS is `seeded`** today; flips to `measured` when the NPS pipeline merges — a one-line source swap, contract unchanged. [CONTRACT, ADR-20]
