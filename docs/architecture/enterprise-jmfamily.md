# Enterprise Architecture — JM Family Enterprises (Federated Platform)

> Interview-prep talking point: "How would you architect at conglomerate scale?"
> Audience: Senior Full Stack Cloud Developer candidate.
>
> **Key thesis:** JM Family is to its subsidiaries exactly what HFC is to its
> brands. The same federated pattern — autonomous tenants, shared identity,
> consolidated reporting — applies at both levels. Nail it for HFC and you have
> the enterprise blueprint. The HFC demo already implements tenant isolation via
> an EF Core global query filter; everything in this doc is that pattern scaled
> two orders of magnitude.

---

## 1. The problem: multi-dimensional conglomerate, three-way tension

JM Family Enterprises is not a simple parent/child hierarchy. It is a
portfolio of operationally independent businesses with deeply different
regulatory profiles, data models, and customer types:

| Subsidiary | Domain | Key constraint |
|---|---|---|
| Southeast Toyota Distributors | Vehicle distribution + logistics to 178 dealerships across 5 states | VIN-level inventory, dealer codes, logistics |
| Southeast Toyota Finance / World Omni Financial | Auto lending, banking-regulated | Fed/state banking reg, strict data isolation |
| JM&A Group | F&I products to ~4,000 external dealers | High-volume B2B, dealer-facing portals |
| National Truck Protection | Commercial vehicle warranty | Specialty insurance regulation |
| JM Lexus | Retail dealership | OEM integration, customer PII |
| Futura Title & Escrow | Real-estate title | RESPA, state licensing |
| Rollease Acmeda | B2B window-covering hardware manufacturer | Manufacturing ops, distributor network |
| **Home Franchise Concepts** | Franchisor of 8 home-services brands, 2,600+ territories | **Franchise law, 50 states, franchisee-as-data-controller** |

$24.7B revenue, ~5,500 associates. Stack: Workday (HRIS), Azure (cloud).

### The three-way tension

Every architectural decision at JM Family scale is pulled by three competing
requirements that cannot all be maximized simultaneously:

1. **Isolation.** Subsidiaries must not share a database, a release cycle, or
   an on-call rotation. A World Omni incident must not page the HFC team. A
   bad HFC deploy must not touch auto-lending data.

2. **Shared identity.** Corporate needs consolidated financials, people data,
   and shared services (SSO, HR, compliance tooling) built once, not
   reimplemented eight times.

3. **Divergent tempo and regulation.** World Omni operates under banking
   regulation with change-advisory boards. JM&A ships features to thousands
   of external dealers. HFC ships to franchisees who are legally independent
   data controllers. A single governance cadence fits none of them.

The wrong mental model: a strict hierarchy where everything rolls up to a
central platform. The right mental model: **a platform with independently
deployable tenants** — the same mental model that makes Kubernetes or AWS
work at scale.

---

## 2. Federated platform model

Four layers, each with a clear owner and a clear interface contract.

### Layer 1 — JM Family Corporate Platform (shared services)

Built and governed centrally; consumed by all subsidiaries as APIs, never as
shared databases.

**Identity & Access (Entra ID)**

- Employees SSO across all subsidiaries via a single Entra ID tenant.
- External parties (franchisees, dealers, customers) get brand-specific
  portals on the same identity fabric, but in a separate trust domain (Azure
  AD B2C or Entra External ID). They authenticate to their brand's portal;
  corporate never exposes the corporate directory to them.
- RBAC with hierarchical scope inheritance:
  ```
  Organization (root)
    └── Subsidiary            → CFO, CISO, Corporate Analyst
          └── BusinessUnit    → VP, Controller
                └── Territory / Location
                      └── User (roles scoped to their level)
  ```
  A franchise-owner role at Territory level cannot escalate to Subsidiary
  visibility. A corporate CFO role at Organization level reads aggregated
  summaries, never raw operational tables.

**Shared financial reporting**

Each subsidiary writes nightly **summarized financials** to a central
warehouse (Snowflake or Azure Synapse) via a canonical schema. Subsidiaries
own their operational databases. Corporate sees the roll-up. No subsidiary
reads another subsidiary's raw data — ever. The warehouse is append-only from
the subsidiary's perspective; only the corporate data-engineering team can
modify the canonical schema.

**HR / People**

Workday is the single authoritative source of org structure. All downstream
systems derive their org hierarchy from Workday events, not from local copies.
When a new franchisee territory is created in HFC, HFC publishes an event;
Workday-integration subscribes and creates the org record. The direction of
truth flows outward from Workday, not inward.

**Audit & Compliance**

Shared logging, retention policy enforcement, and compliance tooling are
built once at the platform layer. This is especially load-bearing for World
Omni (banking examination readiness) and HFC (50-state franchise disclosure
law, per-franchisee audit trails).

---

### Layer 2 — Subsidiary Platforms (independent domains)

Each major subsidiary is its own independently deployable application domain.
It consumes Layer-1 shared services via APIs. It is **not** a multi-tenant
row in one central application.

HFC mirrors the federated model one level down:

```
JM Family Platform
  └── HFC Platform
        └── Brand (Budget Blinds, Two Maids, …)
              └── Territory (franchisee boundary — the isolation key)
                    └── Crew / Associate
```

Southeast Toyota's domain — VINs, dealer codes, parts, logistics — shares no
data model with HFC. Forcing a shared operational schema would be a category
error. The shared contract is the **API interface to Layer-1 services**, not
a shared table.

---

### Layer 3 — Org hierarchy data model

The org graph must be queryable at any level ("all territories rolling up to
HFC," "all employees reporting to the SET president") without recursive CTEs
on hot paths across 5,500 people and thousands of locations.

**Closure table pattern:**

```sql
-- One row per node in the org graph
CREATE TABLE org_node (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   UUID REFERENCES org_node(id),
    node_type   TEXT NOT NULL,          -- organization|subsidiary|business_unit|division|location|team
    name        TEXT NOT NULL,
    external_id TEXT,                   -- Workday ID or ERP reference
    metadata    JSONB,                  -- node-type-specific attributes (see below)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Closure table: one row for every (ancestor, descendant) pair at every depth
CREATE TABLE org_closure (
    ancestor_id   UUID NOT NULL REFERENCES org_node(id),
    descendant_id UUID NOT NULL REFERENCES org_node(id),
    depth         INT NOT NULL,
    PRIMARY KEY (ancestor_id, descendant_id)
);
```

**Why closure table over recursive CTE:** a single indexed join answers
"all territories under HFC" in constant time regardless of tree depth.
Recursive CTEs re-execute at query time; at conglomerate scale with
real-time dashboards, that's a predictable latency problem.

**Why JSONB for metadata:** an HFC territory carries `brands[]`, `zip_codes[]`,
`royalty_rate`, and `franchisee_agreement_date`. A Toyota dealership carries
`dealer_code`, `region`, and `franchise_agreement_type`. Storing both in a
shared relational schema produces a sparse table with dozens of nullable
columns. JSONB keeps the shared table clean; validation of node-type-specific
shape happens at the application layer, enforced by JSON Schema or a typed
domain model. This is a deliberate trade-off: schema flexibility at the cost
of moving some constraints out of the database. Document it and own it.

---

### Layer 4 — Cross-subsidiary data flows

**Consolidated reporting (upward flow)**

Subsidiaries push nightly canonical summaries to the central warehouse.
Corporate reads the warehouse; it never touches operational databases. The
canonical schema is owned by the corporate data-engineering team and versioned
like an API — subsidiaries adapt to it, not the reverse.

**Cross-subsidiary customer intelligence**

A Toyota buyer who is also a Budget Blinds and Two Maids customer is a
high-value signal. But that signal is also the highest-risk data flow in the
architecture. The rule: **never share raw transactional databases across
subsidiaries.** Instead, build a Customer Data Platform (CDP) at JM Family
level that operates exclusively on opted-in, consented data, with explicit
per-subsidiary sharing controls. Consent is captured at the point of
transaction, stored in the canonical `Consent` table, and is the
precondition for any cross-subsidiary identity join. Do this before Phase 3
of any feature build.

**Event streaming (horizontal flow)**

Subsidiaries communicate through a message bus (Azure Service Bus or
Kafka-on-Azure Event Hubs), not through direct API calls or shared databases.
Publishers declare events; subscribers react to them. Neither side knows the
other's internal schema.

Example:
- HFC publishes `franchise.territory.opened { territoryId, brandId, franchiseeId, region }`
- Corporate HR-integration subscribes and creates the Workday org record automatically
- Corporate compliance subscribes and initiates the franchise disclosure audit trail
- The publisher (HFC) knows none of this; it just fires the event

This decoupling is what lets subsidiaries deploy independently without
coordinating release windows.

---

## 3. How HFC is the reference implementation

The HFC platform is not just one subsidiary of eight. It is the **reference
implementation** of the federated model — the subsidiary where the pattern is
proven before it is formalized into the corporate shared-services layer.

### What the demo already implements

`api/AppDb.cs` contains the EF Core global query filter that enforces tenant
isolation at the data layer:

```csharp
// TenantContext is DI-scoped; set by TenantMiddleware from X-Tenant-Id header.
// EF compiles WHERE BrandId = @tenantId into every tenant-scoped query.
// With no tenant set, BrandId compares against null — fail-closed, never cross-tenant.
b.Entity<Territory>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
b.Entity<Slot>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
b.Entity<Appointment>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
```

This is the same isolation contract the org closure table enforces at the
enterprise level — just one layer down. The pattern is identical: every
query is scoped to an isolation key; without a valid key, the result is empty
(fail-closed), not an error or a full cross-tenant leak.

### What the ROADMAP corrects and extends

The ROADMAP identifies two improvements that move the HFC demo closer to
enterprise-grade:

1. **Two-axis tenancy:** The current demo keys on `BrandId`. The corrected
   isolation key is `(brandId, franchiseeId)` — brand is a grouping, franchisee
   is the boundary. A Budget Blinds owner in Irvine must not see Budget Blinds
   Dallas data. The EF query filter mechanism is unchanged; only the source
   of the tenant claim changes.

2. **Token-claim tenancy:** The current demo resolves `BrandId` from the
   `X-Tenant-Id` HTTP header — spoofable by any client. Phase-0 ROADMAP work
   moves the tenant claim into the auth token (Entra ID / Azure AD B2C),
   making it tamper-proof. Same query filter, trusted source. This is the
   direct HFC analog of the enterprise pattern: identity is always asserted by
   a trusted identity provider, never by the client.

**The structural mirror:**

```
JM Family level:    org_node scoped by subsidiary_id, enforced by Layer-1 IAM
HFC level:          EF query filter scoped by franchiseeId, enforced by token claim
```

Both enforce the same contract at different granularities: you see exactly
the data your identity entitles you to, and the enforcement is automatic and
fail-closed.

---

## 4. Build sequence

Get this order wrong and you refactor everything twice.

| Phase | Deliverable | Why this sequence |
|---|---|---|
| **1 — Org model + IAM** | Closure table, Entra ID federation, RBAC, consent schema | Everything downstream asks "who is this user, at what org level, what can they see." Getting it wrong means rewriting every access-control check. |
| **2 — HFC as reference impl** | Multi-tenant-by-franchisee, territory-scoped data, franchisee dashboard, eventing backbone | HFC has the highest software velocity of any JM Family subsidiary. Prove the pattern here, with real franchisees, before generalizing. |
| **3 — Shared-services extraction** | Formalize auth, notifications, audit logging, reporting adapters as an internal developer platform | When the second or third subsidiary needs auth, you already have it. You extract, not rebuild. |
| **4 — Corporate intelligence** | Consolidated reporting + cross-subsidiary CDP analytics | Only possible once subsidiaries emit structured events and consent data. Build it last because it depends on everything above it being correct. |

---

## 5. Senior review and enhancements

The draft above is architecturally sound. These are the places where a senior
reviewer would push harder in a whiteboard session or a design review.

**Consent as a first-class data-controller boundary, not a checkbox**

Franchisees are often legally independent data controllers under CCPA/CPRA and
similar state privacy laws. "Consent to share data cross-brand" is not a
UI feature — it is a legal obligation that determines whether cross-subsidiary
identity joins are lawful at all. The Consent table in the ROADMAP data model
(`{ id, customerId, scope, grantedAt, revokedAt }`) is the right structure.
What the draft undersells: every cross-brand data join must check this table,
the check must be auditable (append-only audit log), and revocation must
propagate within a legally required window (often 15–45 days under CCPA).
Design consent revocation as a first-class async workflow, not an afterthought.

**Data mesh vs. central warehouse — name the trade-off explicitly**

The draft recommends a central warehouse (Snowflake / Azure Synapse) with
subsidiaries pushing canonical summaries. This is correct for Phase 1 and
probably Phase 2. The trade-off to name: as subsidiaries mature, they will
want to own their analytical data products, not just push feeds to a central
team's schema. A data-mesh model (subsidiaries publish analytical data
products; corporate composes them) is the natural evolution. The warehouse
is not the wrong answer — it is the right answer now. Design the canonical
schema as a versioned API so the migration to mesh is additive, not a rewrite.

**Eventual consistency of the org graph vs. Workday**

The org closure table is derived from Workday events. Workday is authoritative;
the closure table is a read-optimized projection. These will be temporarily
inconsistent: a manager change in Workday takes seconds to minutes to
propagate. For access control, this is a risk — a user whose role changed may
retain access briefly. Mitigate with: (a) token expiry aligned to the
acceptable staleness window (15-minute tokens for high-security paths), (b) an
event-driven re-computation of the closure table on org-change events rather
than nightly batch, and (c) a hard permission check against the live HRIS for
any operation above a risk threshold. Document the staleness SLA and own it.

**What to build first if you joined tomorrow**

1. Entra ID federation with a working RBAC model scoped to the org hierarchy.
   Nothing else matters until you know who the user is.
2. The canonical financial summary schema and one subsidiary's adapter.
   Proves the warehouse pattern with real data; unblocks CFO-level reporting.
3. The event bus contract and HFC's first published event (`franchise.territory.opened`).
   Makes every future integration additive.

Do not build the CDP or cross-subsidiary identity joins until (1) consent
infrastructure is live and (2) at least two subsidiaries are emitting clean
data. Doing it earlier is how you build the wrong schema and create a privacy
incident simultaneously.

**Operational concerns the draft does not name**

- **Schema migration coordination:** Each subsidiary owns its schema, but the
  canonical warehouse schema is shared. Version it with semantic versioning;
  breaking changes require a migration window with all subsidiaries.
- **Cost attribution:** Azure costs accrue to one account. Tag every resource
  with `subsidiary` and `team`; set budget alerts per subsidiary. Without this,
  cost overruns become political problems, not engineering ones.
- **Disaster recovery boundaries:** A subsidiary's RTO/RPO should not be
  dictated by another subsidiary's backup policy. Each subsidiary defines its
  own DR targets; the shared platform sets a floor, not a ceiling.

---

## 6. Interview Q&A

**Q1: Why not just build one multi-tenant SaaS platform and have all
subsidiaries use it?**

Because the subsidiaries have fundamentally different data models, regulatory
regimes, and operational tempos. Southeast Toyota Finance operates under
banking regulation with change-control requirements incompatible with HFC's
weekly ship cadence. Rollease Acmeda runs manufacturing ops with no overlap
with franchise disclosure law. Forcing them into one platform means the
slowest-moving, most-regulated subsidiary sets the ceiling for everyone.
The federated model gives you shared identity and consolidated reporting
without shared blast radius.

**Q2: How does the EF Core global query filter in the HFC demo relate to
enterprise-scale tenant isolation?**

It is the same pattern at a different scope. The EF filter compiles
`WHERE BrandId = @tenantId` into every query at the ORM layer — fail-closed
if no tenant is set. At the JM Family level, the org closure table plus
IAM-enforced RBAC scoping does the same thing: every data access is scoped
to an org-hierarchy level, automatically, with no per-query opt-in required.
The key upgrade at enterprise scale is that the tenant claim comes from a
tamper-proof identity token (Entra ID), not a client-supplied header.

**Q3: Why a closure table instead of recursive CTEs for the org hierarchy?**

Recursive CTEs re-execute the graph traversal at query time. At 5,500 people
across hundreds of locations, with real-time dashboards querying "all employees
under this VP" or "all territories rolling up to HFC," that is a predictable
latency cliff. The closure table pre-materializes every ancestor-descendant
pair; answering any subtree query is a single indexed join. The write cost
(maintaining the closure table on org changes) is acceptable because org
changes are infrequent relative to reads.

**Q4: How do you handle the eventual consistency between Workday and the
derived org graph?**

Workday emits org-change events (via Workday Studio or the REST API webhook).
A consumer updates the closure table within minutes, not overnight. For
access control decisions, tokens have a short expiry (15 minutes for high-risk
paths) so stale permissions self-expire quickly. For operations above a
configurable risk threshold, the system performs a live HRIS check rather
than relying on the cached graph. The staleness window is documented and
agreed with the CISO as an explicit SLA, not an emergent property.

**Q5: Why is franchiseeId the isolation key rather than brandId?**

Because brandId is a grouping, not a security boundary. A Budget Blinds
franchisee in Irvine and a Budget Blinds franchisee in Dallas are legally
independent businesses. The Irvine owner has no right to see Dallas
appointments, revenue, or crew schedules — even though they share a brand.
BrandId determines which UI theme, royalty rate table, and brand config the
user sees. FranchiseeId determines which rows of operational data they can
access. The ROADMAP corrects the initial demo, which keys the EF query filter
on BrandId alone, to `(brandId, franchiseeId)`.

**Q6: How would you design cross-subsidiary customer identity without
creating a privacy incident?**

Three controls working together. First, consent is a precondition: no
cross-subsidiary join happens without a recorded, revocable consent grant
scoped to the specific sharing purpose. Second, the join happens in the
CDP (a corporate-level service), not by exposing operational databases to
each other. Third, an append-only audit log records every cross-brand data
access with the consent record that authorized it. Revocation triggers an
async workflow that purges derived records within the legally required window.
Build the consent infrastructure before building any feature that uses it.

**Q7: How do subsidiaries communicate without creating direct dependencies?**

Through a message bus (Azure Service Bus or Event Hubs). Subsidiaries publish
typed events to well-known topics; subscribers consume without the publisher's
knowledge. The contract is the event schema, not an API endpoint. This means
HFC can publish `franchise.territory.opened` and corporate HR-integration,
compliance, and analytics can all react independently — without HFC knowing or
caring. Adding a new consumer requires no change to the publisher. The
trade-off is that event schema changes must be versioned carefully; breaking
changes require a migration period with both old and new consumers running.

**Q8: Where does Azure Synapse fit vs. an operational database?**

Operational databases (Azure SQL, Cosmos DB per subsidiary) handle
transactional workloads: write-heavy, low-latency, normalized, isolated per
subsidiary. Azure Synapse (or Snowflake) handles analytical workloads: the
consolidated financial reporting view, cross-subsidiary trend analysis,
CFO-level roll-ups. Subsidiaries push nightly canonical summaries to Synapse.
Corporate reads only Synapse, never operational databases. This separation
keeps analytical queries from contending with transactional writes, and keeps
the analytical schema stable and governed independently of each subsidiary's
evolving operational schema.

**Q9: If you joined JM Family as the architect, what would you do in the first
90 days?**

First 30: audit what shared infrastructure already exists (IAM, monitoring,
event bus). Do not redesign what works. Map the org hierarchy in Workday to
understand the actual data structure. Interview one engineer from each major
subsidiary to find the pain points — they know where the shared-nothing model
breaks down. Days 31–60: design the canonical financial summary schema with
input from corporate finance and at least two subsidiary controllers. Design
the event bus topic naming convention and governance process. Days 61–90:
implement the org closure table from Workday data as a read model. Stand up
a working Entra ID RBAC model for one subsidiary (HFC is the natural choice)
and demonstrate consolidated financial reporting for that subsidiary. Expand
from there. The goal of 90 days is not to finish — it is to have a running
reference implementation that proves the pattern is real.

**Q10: What is the most common mistake teams make when implementing this kind
of federated architecture?**

Starting with the glamorous features (cross-subsidiary customer intelligence,
AI-driven analytics) before the boring foundations are solid (IAM, consent,
canonical schemas, audit logs). The identity and data-flow contracts have to
be right first — they cannot be retrofitted without touching every downstream
system. The second most common mistake is letting the central platform team
become a bottleneck: if subsidiaries have to file a ticket with the platform
team to add a field to their operational schema, the federated model has
collapsed back into a centralized one. The platform owns the shared contracts
(event schemas, canonical financial schema, IAM policies) and nothing else.
Subsidiaries own everything inside their boundary.
