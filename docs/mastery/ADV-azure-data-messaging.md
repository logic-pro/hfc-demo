# ADV — Azure Data + Messaging for Multi-Tenant SaaS

> Mastery-grade deep dive for the HFC Senior Full Stack Cloud Developer interview.
> Goes **deeper than [[M8-azure-durable]]** on the *data plane* (Azure SQL) and the *messaging plane* (Service Bus vs Durable) specifically.
> Every claim is labelled **DEMO-PROVEN** (it exists in `hfc-demo/`, with file:line) or **PROD-ADD** (what I would add for real HFC scale, honestly flagged as not-in-demo).
> Cross-links: [[M8-azure-durable]] (the Durable saga itself), [[M1-multitenancy]] (the isolation model the data tier must enforce).

---

## 0. What the demo actually provisions (read this first)

`infra/main.bicep` is the source of truth. The header diagram (`infra/main.bicep:1-14`) is the topology:

```
Static Web App (Angular SPA)
     │ calls
     ▼
App Service (ASP.NET Core API) ──managed identity──▶ Azure SQL (serverless)
     │ starts orchestrations
     ▼
Function App (Durable Functions) + Storage ──▶ Application Insights (both)
```

| Plane | Resource | Demo SKU | File:line | Status |
|---|---|---|---|---|
| Data | Azure SQL serverless | `GP_S_Gen5_1`, 1 vCore, autopause 60min, minCap 0.5 | `infra/main.bicep:181-190` | **DEMO-PROVEN** (behind `deploySql` flag) |
| Data (default) | SQLite on `/tmp` | ephemeral file | `infra/main.bicep:115`, `api/Program.cs:9-12` | **DEMO-PROVEN** (lean first pass) |
| Identity | System-assigned MI on API + Func | `SystemAssigned` | `infra/main.bicep:91, 147` | **DEMO-PROVEN** |
| Passwordless SQL | `Authentication=Active Directory Default`, Entra-only | conn string + `azureADOnlyAuthentication: true` | `infra/main.bicep:113-114, 175` | **DEMO-PROVEN** |
| Storage | `Standard_LRS` StorageV2, no public blobs | required by Functions | `infra/main.bicep:122-131` | **DEMO-PROVEN** |
| Messaging | Durable Functions (storage-backed) | Consumption `Y1` | `infra/main.bicep:134-163`, `functions/BookingWorkflow.cs` | **DEMO-PROVEN** |
| Messaging | **Service Bus** (queues/topics) | — | — | **PROD-ADD** (not in demo; the alternative transport, §6) |
| Data | **Elastic pools**, geo-replication, failover groups | — | — | **PROD-ADD** (§4, §5) |
| Secrets | **Key Vault** | — | — | **PROD-ADD** — demo's whole point is *zero secrets* via MI (§8) |

**The honest headline for the panel:** the demo proves the *passwordless serverless data path* and the *Durable saga*. Service Bus, elastic pools, and geo-replication are deliberate PROD-ADDs I can defend on a whiteboard but did not ship in the demo.

---

## 1. Mental model

Two planes, two different failure shapes:

- **Data plane (Azure SQL):** the question is *how do N tenants share or not share a database server, and how do you pay for idle?* The axes are **isolation** (noisy-neighbor, blast radius, per-tenant compliance) vs **cost** (you don't want 1,200 idle franchise territories each paying for a provisioned DB).
- **Messaging plane:** the question is *who owns the state of a long-running, multi-step process that outlives an HTTP request?* Either the **framework owns it** (Durable Functions — replayed event history) or **you own it** (Service Bus queue + a worker + your own state table). [[M8-azure-durable]] is the framework choice; §6 is the queue choice.

The unifying HFC lens: **brand → region → territory → operator** ([[M1-multitenancy]]). The data tier must keep tenant A from reading tenant B even when they share a server, and the messaging tier must keep a saga for booking #1 from being confused with booking #2.

---

## 2. Azure SQL — vCore vs DTU vs Serverless

### 2a. The two purchasing models

| Model | Unit | Mental model | When |
|---|---|---|---|
| **DTU** | "Database Transaction Unit" — a blended bundle of CPU+IO+memory (Basic/Standard/Premium) | a pre-mixed smoothie; one knob | small, predictable, you don't want to think |
| **vCore** | explicit CPUs + tier (General Purpose / Business Critical / Hyperscale) | à la carte; pick CPU, pick storage tier | anything serious — it's the only model that supports serverless, Hyperscale, and **Azure Hybrid Benefit** (bring SQL licenses to cut cost) |

The demo picks **vCore General Purpose, serverless**: `sku: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose' }` at `infra/main.bicep:185`. The `_S_` is the serverless marker; `Gen5_1` = Gen5 hardware, 1 vCore ceiling.

**Interview one-liner:** "DTU is a fixed bundle; vCore lets you size CPU and storage independently and is the gateway to serverless and Hyperscale. We chose vCore because we wanted serverless auto-pause for a demo that sits idle."

### 2b. Serverless auto-pause — what the demo does, and the cold-start trade-off  **DEMO-PROVEN**

```bicep
// infra/main.bicep:181-190
resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = if (deploySql) {
  parent: sqlServer
  name: sqlDbName
  location: location
  sku: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose' } // serverless, 1 vCore
  properties: {
    autoPauseDelay: 60 // auto-pause after 1h idle to save cost
    minCapacity: json('0.5')
  }
}
```

What serverless gives you:
- **Auto-scale** between `minCapacity` (0.5 vCore, `:188`) and the SKU ceiling (1 vCore) based on load — you pay per-second for vCores actually used, plus storage always.
- **Auto-pause** after `autoPauseDelay` minutes idle (`:187`, 60 min). While paused you pay **only for storage** — compute bill goes to zero. Perfect for a demo or a low-traffic franchise territory.

The trade-off — and it is the whole point of this section — is the **resume cold start**. A paused DB is *offline*. The first query after a pause must spin compute back up; that resume is **tens of seconds**, and during it clients get connection errors / timeouts until the DB is warm. The demo even documents the *symptom this caused on the app side*:

```bicep
// infra/main.bicep:106-108
// Cold start + EF create/seed on F1 can exceed the default 230s container
// start limit and trip a crash-loop; give it generous headroom.
{ name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '900' }
```

**The real failure we hit (cite this):** on the **Free (F1) App Service plan**, cold start + EF Core create/seed could blow past Azure's **default 230-second container start limit**, which trips an App Service **crash-loop** (the container is killed for "not responding in time," restarts, and fails the same way). The fix in the demo was to raise `WEBSITES_CONTAINER_START_TIME_LIMIT` to **900** (`infra/main.bicep:108`). That 230s number is the *App Service* container timeout, and serverless SQL resume latency is one of the things that can push you over it. (Note: F1 itself can't run `alwaysOn` — `infra/main.bicep:57, 101` gate it off on Free/Shared — so the app *also* cold-starts, compounding the wait.)

> Distinction to keep straight under pressure: there are **two cold starts** stacked here — (1) the **App Service / Function** container cold start, and (2) the **serverless SQL resume**. The 230s limit belongs to #1; serverless resume is #2. They compound on first hit after idle.

**Mitigations** (PROD-ADD): move the API to **B1+** so `alwaysOn` keeps it resident (the demo already auto-enables this on Basic+, `infra/main.bicep:56-57`); set `minCapacity` higher so the DB scales-up faster; or just go **provisioned** (next).

### 2c. Serverless vs Provisioned — the decision  (trade-off)

| | Serverless | Provisioned |
|---|---|---|
| Billing | per-second vCore + storage | fixed vCore 24/7 |
| Idle cost | ~storage only (if auto-pause) | full compute always |
| Cold start | **yes** (resume latency on first hit after pause) | none — always warm |
| Best for | dev, demos, spiky/intermittent, "long tail" low-traffic tenants | steady production traffic, latency-SLA workloads |

**HFC tie-in:** a brand-new franchise **territory** doing 3 bookings a day is a *perfect* serverless tenant (auto-pause overnight, near-zero cost). The **flagship brand HQ** read model serving an executive dashboard at 8am every weekday wants **provisioned** (or serverless with a high `minCapacity` and no pause) so the CEO never eats a cold start. Same codebase, per-tenant SKU.

---

## 3. Managed identity — passwordless data access  **DEMO-PROVEN**

This is the demo's proudest data-tier fact: **zero database passwords anywhere.**

The connection string carries **no credential** — it names an auth *mode*:

```bicep
// infra/main.bicep:113-114  (deploySql branch)
{ name: 'ConnectionStrings__Default', value: deploySql
    ? 'Server=tcp:${sqlServerName}${environment().suffixes.sqlServerHostname},1433;Database=${sqlDbName};Authentication=Active Directory Default;Encrypt=True;'
    : 'Data Source=/tmp/hfc-demo.db' }
```

`Authentication=Active Directory Default` tells the SQL client to use `DefaultAzureCredential` — in Azure that resolves to the App Service's **system-assigned managed identity**, declared at `infra/main.bicep:91` (`identity: { type: 'SystemAssigned' }`). No secret is ever stored, rotated, or leaked.

The SQL server side is locked to Entra-only — **SQL password auth is disabled entirely**:

```bicep
// infra/main.bicep:171-177
administrators: {
  administratorType: 'ActiveDirectory'
  login: sqlAadAdminLogin
  sid: sqlAadAdminObjectId
  azureADOnlyAuthentication: true // no SQL passwords — Entra only
  principalType: 'User'
}
```

The Function App also gets its own MI (`infra/main.bicep:147`), and the bicep outputs both principal IDs (`:208-209`) so a follow-up step can `GRANT` each identity a contained DB user / role. **Comment to quote:** `infra/main.bicep:91` — *"managed identity — zero secrets in config."*

**Caveat I'll volunteer:** the demo's `AzureWebJobsStorage` for the Function still uses an **account key** (`infra/main.bicep:156`), not MI. That's a real gap — PROD-ADD would switch it to identity-based storage (`AzureWebJobsStorage__credential = managedidentity` + `Storage Blob/Queue Data` role assignments) to make the whole stack truly keyless.

---

## 4. Elastic pools — multi-tenant cost + isolation  **PROD-ADD**

This is the single most important *data-architecture* decision for HFC at scale, and it is **not in the demo** — be honest, then design it.

### The three multi-tenant data patterns

| Pattern | Isolation | Cost at N tenants | Noisy-neighbor | "Drop a tenant" |
|---|---|---|---|---|
| **Single shared DB, `TenantId` column** | logical only (app/RLS enforced) | cheapest | worst (one server) | `DELETE WHERE TenantId=` |
| **DB-per-tenant in an ELASTIC POOL** | strong (separate DB) | shared compute budget across DBs | bounded by pool | drop the DB |
| **DB-per-tenant, each provisioned** | strongest | most expensive (idle DBs cost full) | none | drop the DB |

**Elastic pool = the middle path.** You buy a *pool* of eDTU/vCore, and many databases draw from that shared budget. Tenant A and Tenant B each get their **own database** (strong isolation, per-tenant backup/restore/geo, "shred one tenant" = drop one DB) but they **share the compute bill** — so 1,000 mostly-idle franchise territories don't each pay for a full provisioned DB. You set per-DB min/max so any one DB *can* burst but **can't starve** the others.

**HFC tie-in (the per-tenant scaling story):**
- **db-per-tenant in a pool** maps cleanly onto **territory** isolation from [[M1-multitenancy]]: each territory is its own DB, the brand owns the pool. A compliance request ("export/delete everything for territory X") is one database, not a `WHERE` clause you have to trust.
- The demo's serverless single-DB (`infra/main.bicep:181-190`) is the **shared-DB** end of the spectrum — fine for a demo, and exactly what [[M1-multitenancy]] enforces logically via the `TenantContext`/global query filter. Pools are how I'd graduate the *biggest* brands to physical isolation without 1:1 provisioned-DB cost.

**Failure mode — noisy neighbor in a pool:** one territory runs a runaway report and consumes the pool's whole vCore budget; every other DB in the pool slows down. Mitigations: per-DB `maxCapacity` caps, per-DB `minCapacity` floors (guaranteed slice), alerting on pool DTU/vCore %, and **promoting a hot tenant out of the pool** into its own provisioned DB. That "promote the noisy/important tenant out" move is the standard escape hatch.

**Decision rule I'd state:** start shared-DB + RLS for small tenants; move a brand to **db-per-tenant elastic pool** when isolation/compliance demands it or a tenant gets large; **promote to standalone provisioned** for the few whitehot tenants. It's a continuum, sized per tenant — same as the serverless-vs-provisioned call in §2c.

---

## 5. Geo-replication, failover groups, scaling, indexing  **PROD-ADD** (none in demo)

### 5a. Active geo-replication vs failover groups
- **Active geo-replication:** asynchronously replicates a DB to **readable secondaries** in other regions. You can read from secondaries (offload reporting!) but **failover is manual / per-DB** and the connection endpoint changes.
- **Failover groups:** a layer on top that groups DBs (great for db-per-tenant), gives a **stable read-write listener** + **read-only listener** DNS name, and supports **automatic failover** with a policy. Apps connect to the listener and don't change connection strings on failover.

**Interview one-liner:** "Geo-replication is the replica mechanism; a **failover group** is the orchestration + stable DNS endpoint on top — that's what production HFC would use so the API connection string survives a regional failover untouched."

**HFC tie-in:** put the read-only listener to work — the **BI read-model / executive roll-up** ([[M7]] / dashboard plane) can read from a **geo-secondary**, taking analytical load off the primary that's taking bookings.

### 5b. Scaling
- **Vertical:** bump the vCore SKU (`GP_S_Gen5_1` → `_2`, `_4` …). Serverless does some of this automatically between min/max.
- **Read scale-out:** Business Critical tier gives a free read-only replica; geo-secondaries give cross-region read.
- **Hyperscale:** vCore tier that decouples compute from storage, scales to 100TB, near-instant backups, fast read replicas — the answer when a single brand's data outgrows General Purpose.

### 5c. Indexing for a multi-tenant + time-series workload
- **Lead every multi-tenant index with the tenant key:** `(TenantId, ...)`. With a shared DB, *every* query is filtered by tenant (the global query filter from [[M1-multitenancy]]), so `TenantId` belongs at the **front** of clustered/non-clustered keys or every query scans across tenants.
- **Covering indexes (`INCLUDE`)** for hot dashboard reads so they don't touch the base table.
- **Filtered indexes** for status-skewed columns (e.g. `WHERE Status='Pending'` on bookings awaiting deposit).
- Watch **parameter sniffing** when one tenant is 1000× bigger than another — a plan cached for a tiny tenant can be terrible for the whale. (`OPTIMIZE FOR UNKNOWN` / `RECOMPILE` / Query Store plan forcing.)

---

## 6. Service Bus — the queue-based alternative to the Durable saga  **PROD-ADD**

This is the marquee comparison the prompt wants: **Durable Functions vs Service Bus + workers** for the **booking → deposit saga**. The demo ships **Durable** ([[M8-azure-durable]]); Service Bus is the alternative I can build but didn't.

### 6a. Service Bus primitives (the vocabulary)

| Primitive | What it is | HFC use |
|---|---|---|
| **Queue** | point-to-point; one consumer competes for each message | `booking-confirm` work items |
| **Topic + Subscriptions** | publish once, fan out to N independent subscribers (each with its own filter) | `booking.created` → subscriptions for SMS, email, BI ingest, crew-dispatch |
| **Sessions** | FIFO + state grouped by `SessionId`; a session is locked to one consumer | **`SessionId = AppointmentId`** → all messages for one booking are processed in order by one worker (this is how you'd replace the orchestrator's per-instance ordering) |
| **Dead-letter queue (DLQ)** | per-queue/sub sub-queue where poison/expired/max-delivered messages land | quarantine for a booking message that keeps failing |
| **Scheduled messages** | enqueue now, deliver at a future `ScheduledEnqueueTime` | the **deposit-reminder** and the **expiry timeout** (replaces Durable timers) |
| **Peek-lock vs receive-and-delete** | lock a message, process, then `Complete`/`Abandon`/`DeadLetter` | at-least-once with explicit ack |

### 6b. How you'd rebuild the saga on Service Bus

Recall the Durable orchestrator: **confirm → durable-timer reminder → race(`DepositPaid` event, durable timeout) → finalize/expire** (`functions/BookingWorkflow.cs:25-59`). On Service Bus you hand-build that state machine:

1. API publishes `BookingCreated{appointmentId}` to a **topic** (or session-enabled queue, `SessionId = appointmentId`).
2. A worker runs `ConfirmBooking`, then **schedules** two future messages: `SendReminder` (`ScheduledEnqueueTime = +2s`) and `ExpireBooking` (`ScheduledEnqueueTime = +TimeoutSeconds`).
3. When the Stripe webhook lands `DepositPaid`, the worker runs `FinalizeBooking` **and cancels the scheduled `ExpireBooking`** (or, more robustly, writes `paid=true` to a **state table** and makes `ExpireBooking` a no-op when it sees `paid=true` — because cancelling a scheduled message races with its delivery).
4. The "where is this booking" state that Durable kept *for free in its event history* now lives in **your DB table**, and **you** own idempotency + ordering (sessions) + retries.

That state table is exactly the work the Durable runtime did for you. Here's the side-by-side the panel wants:

| Concern | **Durable Functions** (DEMO-PROVEN, `BookingWorkflow.cs`) | **Service Bus + workers** (PROD-ADD) |
|---|---|---|
| Where saga state lives | runtime **event history** (replayed) | **your** state table — you design it |
| Wait-for-event | `WaitForExternalEvent<double>("DepositPaid")` (`:45`) | external `DepositPaid` message + correlation by `SessionId`/state row |
| Timeout / reminder | **durable timers** `CreateTimer` (`:36, 44`) | **scheduled messages** (`ScheduledEnqueueTime`) |
| Race(event, timeout) | `Task.WhenAny(paid, timeout)` (`:47`) | scheduled-expiry vs paid-flag — you arbitrate (state row wins) |
| Ordering per booking | per-instance (one orchestration per appt) | **sessions**, `SessionId = appointmentId` |
| Poison handling | activity retries / `RetryPolicy` | **DLQ** + max delivery count |
| Code shape | straight-line async C# | event handlers + explicit state machine |
| Determinism footgun | **yes** (no `DateTime.UtcNow`, no I/O in orchestrator — see [[M8-azure-durable]]) | none (normal code) |
| Multi-language / fan-out | C#-centric, orchestration-shaped | language-agnostic, topic fan-out to *many* consumers |
| You operate | a Function App + its storage | a Service Bus namespace + workers + state schema |

**When I'd switch to Service Bus (the honest answer):**
- I need **fan-out** — `booking.created` feeds SMS *and* email *and* BI ingest *and* crew-dispatch, each independently. Topics nail this; Durable is awkward for broadcast.
- Producers/consumers are **polyglot** or live in different services (Durable wants you in the Functions C# model).
- I want a **decoupled buffer** that absorbs spikes and back-pressures independently (e.g. a marketing blast creating 10k bookings).

**When Durable stays the right call (why the demo chose it):** a **single, well-bounded, stateful saga with a human-in-the-loop wait** — confirm/remind/await-deposit/expire — is *exactly* the textbook Durable use case (the comment at `functions/BookingWorkflow.cs:10-18` says so). You get durable state, timers, and event-waiting **for free** and write it as straight-line code. For HFC's one booking lifecycle, Durable is less infra to run. Service Bus earns its keep when the workflow becomes a **multi-consumer event backbone**, not a single saga.

> Crisp framing: **Durable Functions = orchestration (the framework owns the state machine). Service Bus = choreography/transport (you own the state machine, but you get fan-out, polyglot, and back-pressure).**

### 6c. Service Bus failure modes
- **Poison messages:** a message that always throws will be re-delivered up to **MaxDeliveryCount**, then auto-**dead-lettered**. You must have a DLQ drain (alert + a tool to inspect/replay). Forgetting the DLQ = silent data loss of failed bookings.
- **Duplicate delivery:** at-least-once means handlers must be **idempotent** (key on `appointmentId`); use **duplicate detection** windows or an idempotency table.
- **Scheduled-message cancel race:** cancelling the scheduled `ExpireBooking` when a deposit arrives can race the delivery — that's why §6b step 4 says *the state row is the source of truth*, the message just triggers a check.
- **Session starvation:** if `SessionId` cardinality is low (e.g. session per *brand* not per *booking*), one hot brand serializes everything. Pick the session key for parallelism.

---

## 7. Storage  **DEMO-PROVEN** (as Functions backing store)

The Storage account at `infra/main.bicep:122-131` is `Standard_LRS` StorageV2 with `allowBlobPublicAccess: false` (`:129`) and `minimumTlsVersion: 'TLS1_2'` (`:128`). Its job in the demo is to **back the Durable Functions runtime** — `AzureWebJobsStorage` (`infra/main.bicep:156`) is where Durable persists its **task hubs**: the control queues, the instances table, and the **history table** that the orchestrator replays from. So "Durable state is durable for free" is literally *"it's in this Storage account."*

- **LRS vs ZRS vs GRS:** LRS = 3 copies, one datacenter (cheapest, demo's pick). ZRS = across zones. GRS = cross-region. PROD-ADD: at least **ZRS** for the Durable backing store so a zone outage doesn't strand in-flight sagas.
- **PROD-ADD:** blob containers for things HFC actually stores — job photos, signed estimates/PDFs, exports — with **MI + RBAC** (Storage Blob Data Contributor) and **SAS** for time-boxed client uploads. None of that is in the demo.

---

## 8. Key Vault  **PROD-ADD** (and *why the demo doesn't need it for SQL*)

The demo's entire data-access story is **secretless by design** — that's *why there's no Key Vault*: SQL uses managed identity (`infra/main.bicep:113-114`), App Insights uses a connection string that isn't a secret, and the only real key (`AzureWebJobsStorage`, `:156`) is something I flagged in §3 as a gap to move to MI.

**Where Key Vault still earns its place (PROD-ADD):** third-party secrets that *aren't* Azure-resource access — **Stripe** API keys, **Twilio/SendGrid** tokens, signing keys, the JWT symmetric dev key. Pattern: store in Key Vault, grant the App Service MI **Key Vault Secrets User**, and reference via **Key Vault references** in app settings (`@Microsoft.KeyVault(SecretUri=...)`) so the app never sees the raw secret and rotation is config-only.

**Hierarchy to state:** *MI for Azure-resource access (no secret exists) → Key Vault for unavoidable third-party secrets (secret exists, but never in code/config) → never a secret in source or plain app settings.*

---

## 9. Failure modes (consolidated)

| Failure | Plane | Root cause | Mitigation | Demo evidence |
|---|---|---|---|---|
| **230s container crash-loop** | data+host | serverless SQL resume + EF seed on F1 cold start exceeds container start limit | raise `WEBSITES_CONTAINER_START_TIME_LIMIT=900`; B1+ `alwaysOn`; provisioned/high-min SQL | `infra/main.bicep:106-108` |
| **Serverless cold start** | data | auto-paused DB resume latency on first hit | high `minCapacity`, no/longer auto-pause, or provisioned | `infra/main.bicep:187-188` |
| **Noisy neighbor** | data | one tenant eats the elastic pool budget | per-DB max/min caps; promote hot tenant to standalone | PROD-ADD (§4) |
| **Cross-tenant read** | data | missing tenant filter / index not tenant-led | global query filter ([[M1-multitenancy]]) + `(TenantId,...)` indexes | logical in demo |
| **Poison message** | messaging | handler always throws | MaxDeliveryCount → DLQ + drain/replay | PROD-ADD (§6c) |
| **Duplicate delivery** | messaging | at-least-once delivery | idempotent handlers keyed on appointmentId; dup detection | PROD-ADD |
| **Determinism bug** | messaging | `DateTime.UtcNow`/I/O in orchestrator | use `context.CurrentUtcDateTime`, activities for I/O | `BookingWorkflow.cs:34-36` (see [[M8-azure-durable]]) |
| **Stranded in-flight saga** | messaging | LRS storage zone outage | ZRS for the task-hub storage | `infra/main.bicep:125` (LRS) |

---

## 10. Interview defense (follow-ups + answers)

**Q1. "Your demo uses one serverless SQL DB. How does that scale to 1,200 franchise territories?"**
> The demo's single serverless DB (`infra/main.bicep:181-190`) is the *shared-DB* end of a continuum, and [[M1-multitenancy]] already enforces tenant isolation logically via the global query filter. To scale, I move along the continuum **per tenant**: small/idle territories stay shared (or serverless with auto-pause for near-zero idle cost); larger brands graduate to **db-per-tenant in an elastic pool** for physical isolation + per-tenant restore/compliance while sharing one compute budget; the few whitehot tenants get promoted to standalone provisioned. It's sized per tenant, not one-size-fits-all.

**Q2. "Why Durable Functions for the booking saga instead of Service Bus?"**
> For *one* bounded stateful saga with a human-in-the-loop wait — confirm, remind, await deposit *or* expire (`BookingWorkflow.cs:25-59`) — Durable lets me write it as straight-line async C# while the runtime owns durable state, timers, and event-waiting. Service Bus would make me hand-build that state machine: a state table, scheduled messages for the timers, sessions for ordering, a DLQ for poison. I'd **switch to Service Bus the moment it becomes a fan-out backbone** — when `booking.created` must feed SMS + email + BI + crew-dispatch independently, or when producers/consumers go polyglot. Durable is orchestration; Service Bus is the decoupled transport. The demo's need is the former.

**Q3. "Where are your secrets?"**
> For data access, **there are none** — that's deliberate. SQL is `Authentication=Active Directory Default` over the App Service's managed identity (`infra/main.bicep:113-114, 91`) and the server is Entra-only with SQL passwords disabled (`:175`). The one honest gap is `AzureWebJobsStorage` still using an account key (`:156`); prod I'd move that to identity-based storage. Unavoidable third-party secrets (Stripe, Twilio) go in **Key Vault** referenced via MI — secret exists, but never in code or plain config.

**Q4. "What's the actual cold-start cost and did you hit it?"**
> Two stacked cold starts: the App Service/Function **container** resume and the **serverless SQL resume**. On Free (F1) they compounded — cold container + EF create/seed could exceed Azure's **default 230s container start limit** and crash-loop the app. I documented and fixed it by raising `WEBSITES_CONTAINER_START_TIME_LIMIT` to 900 (`infra/main.bicep:106-108`); the real fix is B1+ with `alwaysOn` (auto-enabled on Basic+, `:56-57`) plus a higher SQL `minCapacity` or provisioned for latency-sensitive tenants.

**Q5. "How do you guarantee the deposit-paid and expiry don't both fire?"**
> In Durable it's a single `Task.WhenAny(paid, timeout)` race with the loser's timer cancelled (`BookingWorkflow.cs:42-58`) — atomic within one orchestration. On Service Bus you can't trust a scheduled-message cancel (it races delivery), so the **state row is the source of truth**: `DepositPaid` sets `paid=true`, and the scheduled `ExpireBooking` becomes a no-op if it sees `paid=true`. Same outcome, but on Service Bus *I* own the arbitration.

---

## 11. Demo proof (what I can point at live)

- Serverless SQL, autopause, 1 vCore, min 0.5: `infra/main.bicep:181-190`.
- Passwordless via MI + Entra-only server: `infra/main.bicep:91, 113-114, 171-177`.
- The real 230s container-timeout fix: `infra/main.bicep:106-108`.
- Storage backing the Durable task hub: `infra/main.bicep:122-131, 156`.
- The Durable booking saga (the messaging baseline Service Bus is compared against): `functions/BookingWorkflow.cs:25-59`.
- Local default = SQLite, prod swaps to Azure SQL: `api/Program.cs:7-12`.

---

## Flashcards

1. **vCore vs DTU?** DTU = fixed CPU+IO+memory bundle (one knob). vCore = pick CPU + storage tier independently; only vCore supports serverless, Hyperscale, and Azure Hybrid Benefit. Demo uses vCore (`GP_S_Gen5_1`).
2. **What makes the demo SQL "serverless"?** `GP_S_Gen5_1` (the `_S_`), `autoPauseDelay: 60`, `minCapacity: 0.5` — `infra/main.bicep:185-188`. Auto-scales 0.5→1 vCore, pauses after 1h idle.
3. **Serverless cost win + its cost?** Win: paused = pay storage only. Cost: **resume cold start** (tens of seconds) on first hit after pause; clients get errors until warm.
4. **The 230s number?** Azure App Service **default container start time limit**; cold start + EF seed on F1 can exceed it → crash-loop. Fix: `WEBSITES_CONTAINER_START_TIME_LIMIT=900` (`infra/main.bicep:108`).
5. **Two stacked cold starts?** (1) App Service/Function container resume, (2) serverless SQL resume. The 230s limit is #1; they compound on first hit after idle.
6. **Passwordless SQL — how?** `Authentication=Active Directory Default` (`:114`) → `DefaultAzureCredential` → App Service system-assigned MI (`:91`); server is `azureADOnlyAuthentication: true` (`:175`). Zero stored secrets.
7. **Elastic pool in one line?** Many DBs (db-per-tenant, strong isolation) share one compute budget — isolation of separate DBs without paying for each idle one. Per-DB min/max caps prevent starvation.
8. **Three multi-tenant data patterns?** Shared DB + TenantId (cheap, logical iso) → db-per-tenant in elastic pool (strong iso, shared cost) → db-per-tenant provisioned (strongest, costliest). Size per tenant.
9. **Geo-replication vs failover group?** Geo-replication = readable cross-region secondaries (manual failover). Failover group = adds automatic failover + **stable r/w + r/o listener DNS** so connection strings survive failover.
10. **Service Bus: queue vs topic?** Queue = point-to-point, one consumer per message. Topic+subscriptions = publish once, fan out to N independent filtered subscribers.
11. **Service Bus sessions / DLQ / scheduled messages?** Sessions = FIFO+state per `SessionId` (use appointmentId). DLQ = poison/max-delivered quarantine. Scheduled = future-dated delivery (replaces Durable timers).
12. **Durable vs Service Bus for the saga?** Durable = framework owns state machine (event-history replay), straight-line code, single saga. Service Bus = you own state table + sessions + DLQ, but get fan-out, polyglot, back-pressure. Demo chose Durable; switch on fan-out.
13. **MI vs Key Vault?** MI = Azure-resource access with **no secret at all** (SQL, Storage). Key Vault = unavoidable third-party secrets (Stripe/Twilio), referenced via MI, never in code/config.

---

## Mock Q&A

**1. "Walk me through the data tier you provisioned."**
> Azure SQL serverless, vCore General Purpose, 1 vCore ceiling, 0.5 min, auto-pause after 1h (`infra/main.bicep:181-190`) — behind a `deploySql` flag; the lean default is ephemeral SQLite on `/tmp` (`:115`, `api/Program.cs:9-12`). Access is **passwordless**: connection string says `Authentication=Active Directory Default` (`:114`), resolving to the App Service's system-assigned managed identity (`:91`); the server is Entra-only (`:175`).
> *Follow-up: "Why a flag instead of always SQL?"* → Cost honesty — Azure SQL isn't free; the demo's first pass is zero-cost SQLite, and `deploySql=true` is the realistic second pass. Same EF model, just a different provider/connection string.

**2. "Your serverless DB is paused and a CEO opens the dashboard at 8am. What happens?"**
> The first query triggers a resume — tens of seconds of cold start where the dashboard would error/spin. Unacceptable for that tenant. Fixes: raise `minCapacity` and disable/extend auto-pause, or move the flagship brand's DB to **provisioned** (always warm), and read the dashboard from a **geo-secondary / read-only listener** so analytics never hit the hot primary. Per-tenant sizing — small idle territories keep auto-pause.
> *Follow-up: "Same problem at the app layer?"* → Yes — the App Service container also cold-starts; on F1 it can't even run `alwaysOn` (`:57, 101`). B1+ keeps it resident (auto-enabled, `:56-57`). Two cold starts compound; that's the 230s crash-loop we hit (`:106-108`).

**3. "Replace the Durable booking saga with Service Bus. Sketch it."**
> Publish `BookingCreated` (session-enabled queue, `SessionId=appointmentId` for per-booking ordering). Worker runs `ConfirmBooking`, then **schedules** two messages: reminder at +2s and `ExpireBooking` at +timeout. Stripe webhook lands `DepositPaid` → worker sets `paid=true` in a **state table** and runs `FinalizeBooking`; the scheduled `ExpireBooking` checks the table and no-ops if paid. Poison → DLQ via MaxDeliveryCount. That state table is exactly what Durable's event history did for me for free in `BookingWorkflow.cs`.
> *Follow-up: "So why didn't you?"* → For one bounded saga Durable is less to run and operate. I'd switch when it becomes fan-out — `booking.created` → SMS + email + BI + crew-dispatch as independent topic subscriptions — or polyglot consumers. Orchestration vs transport.

**4. "1,200 territories. One database or many?"**
> A continuum sized per tenant. Small/idle → shared DB with the global query filter from [[M1-multitenancy]] (or serverless w/ auto-pause). Larger brands → **db-per-tenant in an elastic pool**: separate DBs (physical isolation, per-tenant restore/GDPR-delete) sharing one compute budget so idle territories don't each pay for a provisioned DB. The few whales → standalone provisioned.
> *Follow-up: "A pool tenant runs a runaway report — blast radius?"* → Noisy neighbor: it can eat the pool's vCore budget and slow every DB in the pool. Mitigate with per-DB max caps + min floors and alerting; if a tenant is chronically hot, **promote it out** of the pool into its own DB.

**5. "Where do Stripe and Twilio keys live, and why no Key Vault for SQL?"**
> No Key Vault for SQL because there's **no secret** — it's managed identity (`:113-114, 91`), the strongest option. Key Vault is for secrets that *must* exist: Stripe/Twilio tokens, the JWT signing key. Store them in Key Vault, grant the App Service MI **Key Vault Secrets User**, reference via `@Microsoft.KeyVault(...)` app settings so the app never sees the raw value and rotation is config-only.
> *Follow-up: "Any secret left in your demo?"* → Yes, honestly — `AzureWebJobsStorage` uses an account key (`:156`). PROD-ADD: switch to identity-based storage (`AzureWebJobsStorage__credential=managedidentity` + Storage Data RBAC) to make the stack fully keyless.

---

*See also: [[M8-azure-durable]] (the Durable saga + determinism rules in depth), [[M1-multitenancy]] (the tenant-isolation model the data tier enforces).*
