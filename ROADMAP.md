# HFC Platform — Reviewed & Enhanced Roadmap

> Senior review of the feature tech spec, with the foundations it assumes made
> explicit, the data/tenancy model corrected, and the build sequence re-cut for
> efficiency. Two tracks: the **product vision** (what a team builds over a year)
> and the **demo track** (thin slices one person builds to *prove* the range).
>
> Baseline today: a deployed multi-tenant scheduling demo
> (`hfcdemo-api-pkz2lysbqoabq.azurewebsites.net`) — ASP.NET Core 9 + EF Core +
> Angular 20 + Durable Functions, with tenant isolation (EF query filter),
> optimistic-concurrency booking (409), and idempotent deposits. See [README](README.md).

---

## 1. Verdict on the spec

**What's right:** It's anchored in the real business (franchisor + franchisee +
customer, royalty economics), and it correctly identifies the **cross-brand
identity graph as HFC's only defensible moat** — no single-brand competitor can
copy it. Stakeholder framing and the stack picks are sound.

**Where it's wrong or risky — the parts a reviewer will probe:**

| # | Issue | Fix |
|---|---|---|
| 1 | **No foundation phase.** Every "P0" feature silently depends on auth, enforced tenancy, and an eventing backbone the demo doesn't have. | Insert **Phase 0**. Nothing ships safely without it. |
| 2 | **Feature 2 (identity graph) marked P0 but is the highest-risk item.** Identity resolution + fuzzy merge + cross-brand consent is hard and legally loaded. Doing it first is a trap. | Move it to Phase 3, after the data flows and consent capture exist. |
| 3 | **Tenancy is modeled on one axis (brand); the real isolation key is the franchisee/territory.** A Budget Blinds owner in Irvine must not see Budget Blinds Dallas. | Tenancy = `(brandId, franchiseeId)`. Brand is a *grouping*, franchisee is the *boundary*. |
| 4 | **Cross-brand data sharing is a legal问题, not a checkbox.** Franchisees are often separate data controllers; CCPA/CPRA, TCPA (SMS consent), and insurance-data handling (Lightspeed) gate the whole thing. | Consent capture + per-controller boundaries + audit log are Phase-0 requirements, not Feature-2 bullets. |
| 5 | **"Deposit" ≠ payments.** The endpoint is a stub. Real money = Stripe + PCI scope + refunds + reconciliation. | Use Stripe-hosted elements to stay *out* of PCI scope; idempotency key (already designed) carries to the provider. |
| 6 | **AI intake over-promised.** A chatbot that "books the job" invites hallucination/cost/latency risk. | Reframe as **AI-assisted structured intake**: the LLM extracts fields into a typed schema a human/UI can verify. Great demo, safe in prod. |
| 7 | **Everything is "ROI: Very High."** That's not a prioritization. | Right-sized priorities below. |
| 8 | **The demo's tenancy is header-based (`X-Tenant-Id`) — spoofable.** The spec calls the brand-picker "the right pattern" without noting this. | Phase 0 moves tenant to the **auth token claim**. Same query filter, trusted source. |

---

## 2. The foundations the spec skips (Phase 0 — the real unlock)

These are cross-cutting and gate every feature. They're also where the demo's
current gaps get closed and where the Durable Functions already built become
load-bearing infrastructure.

**AuthN / AuthZ**
- **Customers** → Azure AD B2C (social + email). **Staff (franchisee/corporate)** → Entra ID.
- Three roles: `customer`, `franchisee` (scoped to one or more `franchiseeId`s), `corporate` (cross-brand, read-only aggregates only).
- Tenant/role come from token claims — never client-supplied.

**Tenancy & data isolation (corrected model)**
- Isolation key is `franchiseeId`; `brandId` groups franchisees. EF global query
  filter keys on the resolved `franchiseeId` from the claim (the demo already has
  the filter mechanism — only the *source* changes).
- **Two data planes:** *operational* data (appointments, crews, quotes) owned by
  the franchisee and never shared; *identity* data (the Home Profile) owned by
  HFC corporate, shared cross-brand **only with explicit consent**. This split is
  the privacy boundary that makes Feature 2 legal.

**Eventing backbone (already started)**
- The booking lifecycle Durable Functions orchestration in [functions/](functions/)
  is the seed. Promote it to a **Service Bus + Durable Functions** backbone that
  all async flows publish to (confirmations, reminders, NPS, cross-brand signals).
  At-least-once + idempotent consumers (the patterns already in the demo).

**Cross-cutting:** OpenTelemetry → App Insights (correlation across API↔Functions),
idempotency on every mutating endpoint (done for deposits — generalize it),
CI/CD (GitHub Actions → Azure), automated tests (integration + the concurrency test).

---

## 3. Corrected data model

Changes from the spec in **bold**.

```
Brand        { id, name }                                  // grouping, not the tenant boundary
Franchisee   { id, brandId, name, territoryId, region }    // ← the tenancy boundary
Crew         { id, franchiseeId, skills[], homeZip, availabilityWindows[] }
Slot         { id, franchiseeId, crewId, startUtc, durationMinutes, bufferMinutes,
               locationZip, version }                       // version = optimistic-concurrency token (built)
Appointment  { id, franchiseeId, slotId, customerId?, serviceId, jobStatus,
               intakeData(json), createdAt, *deletedAt*, *rowVersion* }
Estimate     { id, franchiseeId, customerId, lineItems[], total, status, expiresAt, version }
Job          { id, appointmentId, photos[], readings[], insurerId, docPackageUri } // Lightspeed
// ── corporate-owned identity plane (separate isolation rules) ──
Customer     { id, email, phone, name, addressId, marketingOptIn, *crossBrandConsentAt* }
HomeProfile  { id, customerId, address, sqft, yearBuilt, pets[] }
Consent      { id, customerId, scope, grantedAt, revokedAt }   // ← makes cross-brand legal & auditable
NpsSurvey    { id, appointmentId, score, comment, respondedAt }
Lead         { id, brandId, stage, source, ownerId }           // franchise-development CRM
Referral     { id, referrerCustomerId, referredCustomerId, status, creditApplied }
```

Add to **every** operational table: `franchiseeId` (tenant key), `createdAt`,
`deletedAt` (soft delete), and a concurrency token. Add an **append-only audit
log** for any cross-brand identity access (compliance evidence).

---

## 4. Efficient roadmap (re-sequenced)

The spec's 4 phases are mostly right; the changes are **inserting Phase 0** and
**moving the identity graph to Phase 3**. Effort assumes a small team; the demo
track (§5) is what one person builds to *demonstrate* each phase.

| Phase | Goal | Features | Why here |
|---|---|---|---|
| **0 — Foundation** | Auth, real tenancy (token-claim), eventing backbone, consent, CI/CD, tests | — | Unlocks and de-risks everything. The demo's security gap closes here. |
| **1 — Customer quick wins** | Confirmations + reminders (SMS/email), reschedule/cancel, **NPS → review-gen** (F7), **AI-assisted intake** (F1 intake layer) | F1 (intake + comms), F7 | Cheapest, rides Phase-0 eventing, immediate measurable ROI (30–40% no-show reduction). |
| **2 — Franchisee value** | Ops dashboard (F3), quoting/estimate engine (F4), slot/geo optimization (rest of F1) | F3, F4 | Turns a booking widget into a daily operating tool → royalty growth. |
| **3 — Cross-brand moat** | Identity graph, Home Profile, recommendations, referrals (F2) | F2 | Highest value *and* highest risk; needs Phase-0 consent + Phase-1 data flowing first. |
| **4 — Corporate & specialty** | Franchisor analytics + territory intelligence (F6), Lightspeed dispatch + insurance docs (F5) | F5, F6 | Highest complexity, narrower audience; build once the system generates the data they analyze. |

**The one disagreement worth defending out loud:** the spec front-loads the
identity graph because it's the biggest prize. I'd sequence it *third* — not
because it's less valuable, but because doing identity resolution before you have
(a) a consent framework and (b) real multi-brand booking data is how you build the
wrong schema twice and create a privacy incident. Earn it.

---

## 5. Demo track — what to actually build (the "efficient to complete")

For the interview, you don't build the platform — you build **thin vertical
slices that each light up a JD keyword** and visibly extend what's already
deployed. Each is days, not months.

| Slice | Proves (JD keyword) | Builds on | Effort |
|---|---|---|---|
| **A. Token-claim tenancy + AD B2C login** | Azure security, multi-tenant correctness | existing EF query filter | ~1–2 days |
| **B. AI-assisted intake** (Azure OpenAI / Claude → typed intake schema) | "AI-assisted development," the JD's differentiator | booking flow | ~1 day |
| **C. NPS → review-gen pipeline** on Durable Functions | event-driven Azure, Durable Functions depth | the orchestration already built | ~1 day |
| **D. Franchisee dashboard page** (Angular, aggregates + a chart) | strong Angular, data viz | existing API + signals/RxJS | ~1–2 days |

Build A first (it's also the security fix), then pick the 1–2 that best match the
panel. Each slice has a screenshot and a smoke test, like the current demo.

---

## 6. Stack adjustments to the spec's table

Mostly agree. Refinements:
- **AI intake:** Azure OpenAI *or* Claude via the Anthropic SDK — use **structured
  outputs / tool-calling** to force a typed schema, not freeform chat. Latest
  models (Claude Opus/Sonnet, GPT-4o).
- **Payments:** Stripe **Checkout / hosted elements** specifically — keeps you out
  of PCI-DSS scope (no card data touches your servers).
- **SMS:** Twilio + **explicit TCPA consent capture** before any message.
- **Analytics:** Power BI Embedded is fine, but for franchisee dashboards a
  lightweight Angular + a charting lib avoids per-user licensing cost early.
- **Dispatch realtime (Lightspeed):** SignalR (Azure SignalR Service) for the
  live incident board — Microsoft-native, fits the stack.

---

## 7. Risks to name before they're asked

- **Privacy/consent across independent franchisees** — the gating legal constraint; design the consent + audit model first (Phase 0).
- **Payments correctness** — idempotency (built), refunds, reconciliation, PCI scope.
- **AI accuracy/cost** — structured extraction + human-verifiable fields; cap spend.
- **Cost discipline** — every async fan-out (reminders, NPS) is metered; design for batching and dead-lettering (already in the demo's patterns).
