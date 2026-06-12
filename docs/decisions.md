# Architecture Decision Record — HFC demo

Why each choice was made, the alternatives considered, and what would make us
revisit. Short ADR format. These are the questions an interviewer will ask as
"why did you do X and not Y" — answer with the trade-off, not the feature.

---

### ADR-01 — Domain: multi-tenant franchise scheduling
**Decision:** Model the demo as a booking platform where one codebase serves 8
franchise brands. **Why:** It mirrors HFC's actual business (8 brands, 2,600+
territories) *and* maps one-to-one onto the candidate's real IPS multi-tenant
permit-platform experience — so every answer bridges to production work already
done. **Alternative:** a generic CRUD app — rejected as un-grounded. **Revisit:** n/a.

### ADR-02 — Stack: ASP.NET Core 9 + Angular 20 + Azure Durable Functions
**Decision:** Build on the exact JD stack. **Why:** the demo *is* the evidence for
"I can do your stack." Durable Functions specifically because the JD calls out
AI/cloud-native and the flashcards call out Durable Functions. **Trade-off:** more
moving parts than a single web app. **Revisit:** n/a — deliberate.

### ADR-03 — Minimal APIs over MVC controllers
**Decision:** Minimal API endpoints in `Program.cs`. **Why:** less ceremony for a
small surface; the request pipeline and DI are explicit and easy to narrate.
**Alternative:** MVC controllers — better for large APIs with filters/conventions;
overkill here. **Revisit:** if the API grew past ~15 endpoints or needed rich
filter pipelines, switch to controllers.

### ADR-04 — Multi-tenancy via EF Core global query filter
**Decision:** One `HasQueryFilter` per tenant-scoped entity, keyed on a scoped
`TenantContext`; fail-closed (no tenant → no rows). **Why:** the isolation lives in
**one enforced seam** you can audit — cross-tenant leakage is the scary failure.
**Alternative (and the honest trade-off):** this is the *shared-schema / row-level*
model — cheapest, least isolation. Database-per-tenant + elastic pools gives stronger
isolation at higher cost; that's what I'd argue for at HFC scale. **Revisit:** when a
tenant needs hard data residency or noisy-neighbor isolation → db-per-tenant.

### ADR-05 — Tenant from a header in the demo; from a token claim in prod
**Decision:** The demo resolves tenant from `X-Tenant-Id`; production resolves it
from the authenticated token's claim. **Why:** the header keeps the demo zero-auth
and easy to drive; it is **insecure** (spoofable) and I say so up front. The query
filter doesn't change — only the *source* of the tenant id. **Revisit:** Slice A this
week moves it to the claim (AD B2C). This is the #1 thing to volunteer in the interview.

### ADR-06 — Double-booking: optimistic concurrency → 409
**Decision:** `Slot.Version` as an `IsConcurrencyToken`, bumped on book; the loser's
UPDATE matches 0 rows → `DbUpdateConcurrencyException` → HTTP 409. Unique index on
`SlotId` as a second backstop. **Why optimistic, not pessimistic:** booking conflicts
are rare; a lock per slot would serialize throughput and risk deadlocks. **SQLite
caveat:** no native `rowversion`, so the token is an `int` bumped in code. **Revisit:**
if write contention were high, consider a reservation/queue model.

### ADR-07 — Payments: Idempotency-Key on deposits
**Decision:** Deposit requires an `Idempotency-Key`; a retry with the same key is a
no-op. **Why:** at-least-once networks mean a refresh/retry/timeout must never
double-charge — idempotency is designed in, not bolted on. **Honest limit:** stored
per-appointment, not in a dedicated idempotency-key table caching the full response.
**Revisit:** real payments → Stripe hosted elements (stay out of PCI scope) + a proper
idempotency store + reconciliation.

### ADR-08 — Post-booking workflow: Durable Functions, not a background service
**Decision:** Model confirm → reminder → await-deposit-or-timeout → finalize/expire as
a Durable orchestration. **Why:** it spans minutes-to-days and must survive deploys and
scale-to-zero; a `Task.Delay` on a hosted background thread dies on every restart.
Durable replays from history, so state is durable without us managing it. **Alternative:**
Logic Apps (less code, less control) or a queue + cron (more glue). **Revisit:** n/a.

### ADR-09 — EF EnsureCreated + startup seed, not Migrations
**Decision:** `EnsureCreated()` and idempotent seeding on boot. **Why:** zero-setup for
a demo — clone and run. **Trade-off:** no schema-versioning/upgrade path; you can't
evolve a populated DB. **Revisit:** any real deployment → EF Migrations (the moment the
schema must change without data loss).

### ADR-10 — SQLite locally; Azure SQL (conditional) in the cloud
**Decision:** `UseSqlite` with a file; the connection string swaps to Azure SQL when
`deploySql=true`. **Why:** SQLite = zero-install local dev and persists on App
Service's `/home`; Azure SQL = the real managed-identity story. **Trade-off:** SQLite
serializes writers, so true concurrency only shows on Azure SQL. **Revisit:** the
`deploySql=true` pass for the managed-identity demo.

### ADR-11 — Serve the SPA from the API App Service (not Static Web Apps)
**Decision:** Build the Angular prod bundle same-origin, copy into `api/wwwroot`,
serve via `UseStaticFiles` + `MapFallbackToFile`. **Why:** the SWA CLI upload was
**blocked by a network proxy** in the build environment; single-origin hosting also
removes the CORS hop and gives one URL. **Alternative:** Azure Static Web Apps (free,
CDN, great from an unproxied machine) — kept in git history. **Revisit:** if we want
CDN/edge for the SPA, move it back to SWA from a clean network.

### ADR-12 — Deploy region: centralus
**Decision:** Deploy to centralus, not eastus2. **Why:** the free subscription had an
App Service quota of **0 in eastus2/eastus/westus2** (preflight `SubscriptionIsOverQuota`,
"Total VMs: 0") but quota in centralus — a region-specific quota, *not* a spending
limit. **Revisit:** request a quota increase if a specific region is required.

### ADR-13 — Managed identity + Entra-only SQL auth (no passwords)
**Decision:** System-assigned managed identity on the API/Function; Azure SQL with
`azureADOnlyAuthentication`; connection string `Authentication=Active Directory Default`.
**Why:** zero secrets in code/config — the credential never exists to leak.
**Trade-off:** one manual data-plane step (`CREATE USER … FROM EXTERNAL PROVIDER`) that
Bicep can't do. **Alternative:** connection string in Key Vault — still a secret to
rotate. **Revisit:** n/a — managed identity is the right default.

### ADR-14 — IaC in Bicep
**Decision:** Bicep, validated with `az bicep build` / `what-if`. **Why:** native to
Azure, no state file to manage, concise; matches a Microsoft-centric shop (JM Family).
**Alternative:** Terraform (multi-cloud, state management) — unnecessary here; ARM JSON
(verbose). **Revisit:** multi-cloud or existing Terraform estate → Terraform.

### ADR-15 — Free tiers first (F1 App Service, Consumption Functions), lean deploy
**Decision:** Deploy the lean stack (no Azure SQL) on free tiers first; SQL is a
`deploySql=true` second pass. **Why:** get a working public URL fast at ~$0 and avoid
free-sub SQL quota/cost risk; SQL is the talking-point pass. **Revisit:** turn on
`deploySql` when demoing managed-identity-to-SQL specifically.

### ADR-16 — Real tenancy is two-axis: brand × franchisee
**Decision:** The production model isolates on `franchiseeId` (territory), with
`brandId` as a grouping — not brand alone. **Why:** a Budget Blinds owner in Irvine
must not see Budget Blinds Dallas; the *franchisee* is the security boundary. The demo
simplifies to brand. **Revisit:** Slice A / any real build adds `franchiseeId` as the
tenant key. See [ROADMAP](../ROADMAP.md) §2–3.

### ADR-17 — Parallel work via git worktrees
**Decision:** One worktree/branch per demo slice (A/B/C/D) under
`../hfc-demo-worktrees/`. **Why:** lets slices progress independently (and multiple
agent/dev sessions run at once) without branch-switching churn. **Caveat:** Slice A
(auth/tenancy) is foundational — merge it to `main` first, then rebase B/C/D.
**Revisit:** collapse to a single branch if the slices turn out tightly coupled.
