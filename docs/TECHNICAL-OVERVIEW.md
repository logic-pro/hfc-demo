# HFC Multi-Tenant Franchise Platform — Technical Overview

A working, deployed demo built to show — not just describe — how I design and ship the kind of
multi-tenant SaaS platform the **Senior Full Stack Cloud Developer** role calls for.

**▶ Live:** https://hfcdemo-api-pkz2lysbqoabq.azurewebsites.net

> A franchise platform exists to make franchisees and field crews more successful. This demo is built
> around that: it gives the franchisor system-wide visibility, hands each franchisee a daily operating
> dashboard, and tightens the path from **booking → paid deposit** — across eight brands on one platform,
> with each tenant's data strictly isolated.

---

## Try it yourself (~2 minutes)

Sign-in is a one-click persona picker — it stands in for B2C/Entra and mints a scoped token per persona.
*(Open in an incognito window for a clean session.)*

1. **`/login`** — note the four tiers: **Franchisor HQ → Brand → Region → Franchisee**. That's the RBAC hierarchy.
2. **Sign in as Franchisor HQ (HFC CEO)** → the **executive command center**: a portfolio roll-up across all
   brands — jobs completed, active/at-risk territories, network NPS, a territory map and scorecards.
3. **Sign out → sign in as a Brand President** (e.g., *Kitchen Tune-Up*) → the **same** command center,
   now scoped to just that brand's territories. The re-scope happens **server-side from the token claim**, not the UI.
4. **Sign out → sign in as a franchisee operator** (e.g., *Budget Blinds — Tustin*) → the **Operator dashboard**
   (bookings, slot-fill, deposit funnel, leaks) and **Scheduling** (book a slot → take a deposit). Note there is
   **no way to reach another brand from here** — that's tenant isolation, live.
5. **Sign in as a different brand's operator** → completely separate data. Same platform, different tenant.

---

## The stack (exactly what HFC runs)

| Layer | Technology | In this demo |
|---|---|---|
| Backend | **ASP.NET Core / C# (.NET 9)** minimal APIs | tenancy seam, DI, validation, versioned routes |
| Contracts | **OpenAPI 3.0 / Swagger**, RFC-7807 `problem+json` | `/swagger`; structured errors on every failure path |
| Data | **SQL Server / EF Core** (SQLite locally, Azure SQL in cloud) | modeling, migrations-free `EnsureCreated` seed, optimistic concurrency |
| Tenancy | **Multi-tenant**, claim-based isolation | verified `franchisee_id` claim → per-request `TenantContext` |
| AuthZ | **brand → region → territory RBAC** | scoped read-down tokens, server-enforced |
| Frontend | **Angular 20** SPA (signals, standalone, lazy chunks) | strongly typed view-models, executive + operator dashboards |
| BI | **pre-shaped read models** (CQRS-style roll-up) | corporate command center + custom Report Builder |
| Cloud | **Azure App Service**, Azure SQL, **Durable Functions** | same-origin SPA+API, Bicep IaC, booking/NPS orchestrations |
| CI/CD | **GitHub Actions** | build · test · web · tenant-isolation smoke · post-deploy e2e |

---

## Architecture highlights

### 1. Multi-tenancy & isolation — *"how do you guarantee tenant A never sees tenant B?"*
Tenant identity comes from a **verified token claim (`franchisee_id`), never a client-supplied header.** A single
auth seam (`api/Auth.cs`) maps the verified principal onto a per-request `TenantContext`, and every data path is
scoped by it. Corporate personas carry a *scope* claim (network/brand/region) instead of a tenant id and read
**down** the hierarchy. The isolation is proven, not asserted: the smoke suite logs in as one franchisee and
confirms another franchisee gets **404/0 rows** on its data, and a franchisee hitting corporate endpoints gets **403**.

### 2. RBAC over brand → region → territory
One login mints one scoped token; the server authorizes by its claim. The three corporate tiers read the *same*
executive surface, re-scoped server-side (network sees all territories; a brand sees only its own; a region only
its region). A franchisee sees only the operator surface for its tenant. The UI merely reflects what the API returns.

### 3. BI read models + reporting — *"why not just query the operational tables?"*
The executive dashboard reads a **pre-aggregated corporate read model** (a roll-up), not the live operational
tables — avoiding lock contention and shape mismatch, and keeping the franchisee as the data controller. On top of
it sits a **custom Report Builder**: pick metrics × dimensions × period → run → table + chart → **export to
CSV/XLSX** → **save / load / delete** named reports (corporate-scope, RBAC read-down). Every tile is tagged with
its **data provenance** — *Measured* (computed from operations) vs *Reported* (franchisee-submitted) vs
*Illustrative* (placeholder) — so no one mistakes a seeded number for a measured one.

### 4. Scheduling, deposits & the durable booking workflow
**Scheduling.** Booking a slot uses **optimistic concurrency**: `Slot.Version` is an `IsConcurrencyToken`; two
operators racing for the same slot means one wins and the other gets a clean **HTTP 409** instead of a
double-booking. Taking a deposit is **idempotent on an `Idempotency-Key`** — a retried call never double-charges
(Stripe-style semantics; the demo models the payment contract rather than calling a live PSP).

**The scheduler is a stateful orchestration, not a background thread.** The post-booking lifecycle runs as an
**Azure Durable Functions** orchestration (`functions/BookingWorkflow.cs`):

```text
confirm booking → (durable timer) send reminder
               → await "DepositPaid" event  ── paid  → finalize
                  bounded by a durable timer ── timeout → expire + release the slot
```

This is the textbook **human-interaction / "await money or expire"** pattern. It matters because the wait spans
**minutes-to-days** and must **survive process restarts, deploys, and scale-to-zero** — the orchestrator replays
from its event history, so its state is durable with zero infrastructure I manage, and that pending wait costs
nothing. The bounded **durable timer** is the part teams usually miss: an abandoned booking auto-expires and
frees the slot instead of leaking a zombie instance. Side-effecting steps are **activities** (independently
retryable); replay-safe time comes from `context.CurrentUtcDateTime`, never `DateTime.UtcNow`.

The **same orchestration backbone** drives the post-service **NPS → review** workflow (`NpsWorkflow.cs`): request
the survey, await the customer's 0–10 score *or* time out, then draft a tiered review — the other half of the
human-interaction pattern (act on a reply, still finish cleanly when none comes). *Why Durable over a cron/queue
chain:* built-in state, retries, fan-out/fan-in, and timeouts — instead of hand-rolled queue plumbing and a
separate store for in-flight state.

### 5. Azure delivery & CI/CD
The Angular SPA is built and served **same-origin** from the API's `wwwroot` (one App Service, no CORS hop in
prod); infrastructure is **Bicep**. Deploys are **health-gated** (`/health` must return 200) and auto-dispatch a
**post-deploy end-to-end** run against the live URL. CI gates every PR on **build · test · web build · API smoke
test**, and the smoke suite's assertions are load-bearing — including the cross-tenant isolation and RBAC checks
above. Browser end-to-end coverage runs via Playwright drivers.

---

## Why this maps to the role
This isn't a layer — it's the whole system, shipped: tenant-isolated data model, versioned REST/OpenAPI contracts,
a typed Angular SPA, the Azure infrastructure it runs on, and the CI/CD + tests that keep it honest. It's built
around HFC's actual problems — per-tenant isolation, the brand→region→territory hierarchy, executive and
operational BI over read models, and booking-to-deposit conversion — and around the franchise outcome those serve.
Every claim here is something you can click in the live demo or read in the code.

**On the roadmap (scaffolded, not yet integrated):** live Stripe PSP calls + webhooks, Twilio/SendGrid messaging,
and distance-based geospatial scheduling (territory lat/lng already powers the map). Happy to talk through how I'd
land each.

---

## Next step
I'd welcome the chance to walk through the platform in person and talk about how I'd apply it to HFC's roadmap.
**An in-person interview would be the ideal next step** — happy to work around your schedule.
