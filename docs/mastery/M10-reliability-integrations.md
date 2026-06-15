# M10 — Reliability Patterns & Integrations

> HFC Senior Full Stack Cloud Developer · mastery study doc
> Scope: optimistic concurrency (double-booking → 409), idempotency (deposits never double-charge), and the integration roadmap (Stripe, Twilio/SendGrid, geospatial). Cross-links: [[M8-azure-durable]].

---

## 1. Mental model

The booking→deposit path is **the revenue path**. Two failure classes can corrupt it, and both are concurrency/retry problems, not feature gaps:

1. **Lost update / double-write** — two agents (or two browser tabs) book the *same slot*. Without a guard, both succeed: two appointments on one slot, an overbooked technician, an angry customer. The fix is **optimistic concurrency** + a **unique index** — the database, not the app, is the referee.
2. **Duplicate side-effect on retry** — a deposit POST times out on the client; the client retries; without protection it charges twice. The fix is **idempotency**: a client-supplied `Idempotency-Key` makes "do this once" safe to repeat.

The unifying idea: **make the operation safe to race and safe to repeat.** Distributed systems give you *at-least-once* delivery (clients retry, load balancers re-dispatch, webhooks replay). You cannot prevent the duplicate request — you can only make the *effect* exactly-once. That is what these two patterns buy.

Two enforcement layers, deliberately belt-and-suspenders, both in `BookingEndpoints.cs`:
- A **concurrency token** (`Slot.Version`) catches the read-modify-write race on the slot row.
- A **unique index** on `Appointment.SlotId` catches the insert race even if two requests both read `IsBooked == false`.

---

## 2. Optimistic concurrency — double-booking → 409 (BUILT)

### The book handler

```csharp
// /api/appointments — Book a slot. Optimistic concurrency on Slot.Version means two racing
// bookings can't both win — the loser gets 409.
app.MapPost("/api/appointments", async (BookRequest req, AppDb db, TenantContext t) =>
{
    var slot = await db.Slots.FirstOrDefaultAsync(s => s.Id == req.SlotId);
    if (slot is null) return Results.NotFound();   // not found OR not this tenant's
    if (slot.IsBooked) return Results.Conflict("Slot already booked.");

    slot.IsBooked = true;
    slot.Version++;                       // bump the concurrency token
    ...
    db.Appointments.Add(appt);
    try
    {
        await db.SaveChangesAsync();
    }
    catch (DbUpdateConcurrencyException)  // someone booked this slot first
    {
        return Results.Conflict("Slot was just booked by someone else.");
    }
    catch (DbUpdateException)              // unique-index race on SlotId
    {
        return Results.Conflict("Slot already booked.");
    }
    return Results.Created(...);
}).RequireAuthorization();
```
— `api/Endpoints/BookingEndpoints.cs:38-72`

### What backs it in the model

```csharp
// Concurrency token for double-booking protection (see Slot.Version).
b.Entity<Slot>().Property(x => x.Version).IsConcurrencyToken();

// A slot can only be booked once: unique appointment per slot.
b.Entity<Appointment>().HasIndex(x => x.SlotId).IsUnique();
```
— `api/AppDb.cs:57-61`

### How the race actually resolves (step by step)

Two requests for `SlotId = 5`, both arrive while `Version = 1`, `IsBooked = false`:

| Step | Request A | Request B |
|------|-----------|-----------|
| read slot | sees `Version=1`, `IsBooked=false` | sees `Version=1`, `IsBooked=false` |
| both pass the `if (slot.IsBooked)` check | — | — |
| `SaveChangesAsync` | EF emits `UPDATE Slots SET IsBooked=1, Version=2 WHERE Id=5 AND Version=1` → **1 row** → commits | EF emits the *same* `WHERE Id=5 AND Version=1` → **0 rows** (Version is now 2) → EF throws `DbUpdateConcurrencyException` → **409** |

Because `IsConcurrencyToken()` appends `Version` to the `WHERE` clause, the second update matches **zero rows**. EF interprets "expected 1, affected 0" as a concurrency conflict. The app turns that into HTTP **409 Conflict**.

The **unique index on `SlotId`** is the second net: even if both requests somehow got past the version check (e.g., different transaction isolation), the two `INSERT`s into `Appointment` collide on the unique `SlotId`, the second throws `DbUpdateException`, also caught → 409. *Two independent guarantees for one invariant.*

### Optimistic vs pessimistic — the trade-off

| | Optimistic (what HFC uses) | Pessimistic (`SELECT ... FOR UPDATE` / app lock) |
|---|---|---|
| Mechanism | version token, detect conflict at commit | lock the row on read, block others |
| Best when | conflicts are **rare** (most slots aren't fought over) | conflicts are **common / contended** |
| Cost on the happy path | ~zero — no locks held | a lock held for the whole transaction |
| Cost on conflict | one wasted request → 409, client retries another slot | callers serialize / wait |
| Failure mode it avoids | lost update | lost update **and** dirty reads |
| Downside | "wasted work" if contention is high; need retry UX | reduced throughput, deadlock risk, lock held across slow ops |

**Why optimistic is right here:** booking contention is low (a given slot is rarely fought over by two agents in the same second), and the operation is short. Optimistic keeps the hot path lock-free and pushes the rare loser to "pick another slot." If HFC later had highly-contended resources (e.g., one emergency-response truck per region), pessimistic locking or a queue would be the better tool — that's a defensible "it depends" answer.

### Failure modes without it
- **No version token, no unique index:** both bookings commit. Lost update — the slot shows one appointment but two customers think they own it (last-writer-wins silently destroys the first booking's intent). This is the classic *lost update* anomaly.
- **Unique index only, no version token:** still correct for the *appointment* (the second insert 409s), but `Slot.IsBooked`/`Version` could drift if other code paths mutate the slot. The token guards the slot row itself.

---

## 3. Idempotency — deposits never double-charge (BUILT)

### The deposit handler

```csharp
// Pay a deposit. Idempotent: a retry with the same Idempotency-Key never
// double-charges — it returns the already-applied result.
app.MapPost("/api/appointments/{id:int}/deposit",
    async (int id, DepositRequest req, HttpRequest http, AppDb db) =>
{
    if (!http.Headers.TryGetValue("Idempotency-Key", out var key) || string.IsNullOrWhiteSpace(key))
        return Results.Problem(statusCode: 400, title: "Missing Idempotency-Key header.");

    var appt = await db.Appointments.FirstOrDefaultAsync(a => a.Id == id);
    if (appt is null) return Results.NotFound();   // not found OR not this tenant's

    if (appt.DepositKey is not null)       // already paid
    {
        // Same key => safe retry; different key => the deposit is already settled.
        return Results.Ok(new AppointmentDto(appt.Id, appt.TerritoryId, appt.StartUtc,
            appt.CustomerName, appt.Service, appt.DepositCents, true));
    }

    appt.DepositCents = req.AmountCents;
    appt.DepositKey = key.ToString();
    await db.SaveChangesAsync();
    return Results.Ok(...);
}).RequireAuthorization();
```
— `api/Endpoints/BookingEndpoints.cs:76-97`

### How the key works

1. The client **must** send an `Idempotency-Key` header (else **400** — fail fast, no silent charges). The key is generated once per logical "pay this deposit" intent and reused across retries of that intent.
2. The first successful call **stores** the key on the appointment row (`appt.DepositKey = key`) inside the same `SaveChangesAsync` that records the charge — the key and the effect are **persisted together**.
3. Any retry finds `DepositKey is not null` and **short-circuits**, returning the already-applied result (`DepositCents`, `deposit: true`). No second write, no second charge. The response is the *same* as the original — that's what makes it a safe retry, not just a no-op.

This is the "make the effect exactly-once over an at-least-once channel" pattern in its simplest form.

### Idempotency-key vs natural-key dedupe — the trade-off

| | Idempotency-Key (header, client-supplied) | Natural-key dedupe (server-derived) |
|---|---|---|
| Identity of "the same op" | an opaque token the **client** chose | a server-meaningful key (e.g., "one deposit per appointment") |
| What it protects against | retries of *one specific request* | *any* duplicate for that natural key, from anywhere |
| Example here | the `Idempotency-Key` header | the **unique index on `Appointment.SlotId`** (one appt per slot) |
| Strength | works even when the client retries with new intent semantics; standard for payments | no client cooperation needed |
| Weakness | client must remember & resend the same key | hard to define a natural key for "same payment, retried" (amount can legitimately change) |

HFC actually uses **both**, each where it fits: a *natural key* (unique `SlotId` index) for "one appointment per slot" because the slot IS the natural identity; an *idempotency key* for deposits because "the same payment retried" has no good natural key (you can't dedupe on amount — a customer might legitimately pay two deposits). The booking handler today even leans on the natural key as belt to the version token's suspenders. Knowing *which* tool fits *which* invariant is the senior signal.

### Failure modes without it
- **No idempotency key:** client POSTs deposit, network drops the response, client retries → **two charges**. The customer disputes; you eat the chargeback. This is the canonical double-charge bug.
- **Key stored *after* a separate side-effect:** if you charged Stripe first and stored the key second, a crash in between loses the dedupe and the next retry charges again. **Persist the key in the same transaction as the effect** (or, with Stripe, pass the key *to Stripe* so Stripe dedupes — see roadmap).
- **Webhook replay:** payment providers re-deliver webhooks (at-least-once). Same problem, same fix — dedupe on the provider's event id. (Roadmap §5.)

### HFC tie-in
Booking creates the appointment; the **paid deposit converts it to committed revenue**. The 409 protects against *selling the same slot twice*; the idempotency protects against *charging the customer twice*. Both directly defend the money path the franchise runs on — which is exactly why they're the two reliability patterns built first, and why the smoke test asserts both.

---

## 4. Demo proof — `e2e/smoke-api.sh`

The smoke test books with two franchisees of the **same brand** (the isolation boundary) and asserts the reliability contract:

```bash
# booking -> 201
chk "$(code -X POST "$B/api/appointments" ... -d "{\"slotId\":$SID,...}")" "201" "book open slot -> 201"

# double-book same slot -> 409 (optimistic concurrency)
chk "$(code -X POST "$B/api/appointments" ... -d "{\"slotId\":$SID,...}")" "409" "re-book same slot -> 409"

# idempotent deposit: same key twice keeps the amount
curl ... -H 'Idempotency-Key: smoke-key' -d '{"amountCents":5000}' >/dev/null
amt=$(curl ... -H 'Idempotency-Key: smoke-key' -d '{"amountCents":5000}' | ... ['depositCents'])
chk "$amt" "5000" "deposit retried with same key does not double-charge"

# missing idempotency key -> 400
chk "$(code -X POST "$B/api/appointments/$AID/deposit" ... -d '{"amountCents":5000}')" "400" "deposit without Idempotency-Key -> 400"
```
— `api/e2e/smoke-api.sh:42-59`

Three reliability assertions, all green: **409 on re-book**, **deposit retried with same key stays $50.00 (5000¢, not 10000¢)**, and **400 when the key is missing**. (Plus a tenant-isolation assertion: a *different* franchisee of the same brand re-booking that slot gets **404**, not 409 — the slot is invisible to it, so write isolation, not concurrency, is what fires.)

---

## 5. ROADMAP — NOT yet built

> Everything below is **design, not code**. The current implementations are stubs. This section is how you'd extend them — say so plainly in the interview, then show you know the real shape.

### 5.1 Real Stripe deposit (current deposit is a stub)

Today `deposit` just records `DepositCents`/`DepositKey` in the DB — **no money moves.** Real flow:

1. **Create a PaymentIntent** server-side, passing the request's `Idempotency-Key` straight through to Stripe's `Idempotency-Key` (Stripe natively dedupes on it for 24h — so your client key and Stripe's dedupe align end-to-end). Return the `client_secret` to the SPA.
2. **Confirm on the client** with Stripe.js (card details never touch HFC servers — PCI scope stays minimal).
3. **Webhook is the source of truth.** Listen for `payment_intent.succeeded`; mark the appointment paid *only* then. Never trust the client's "success" callback alone.
4. **Webhook idempotency:** Stripe delivers at-least-once and *replays*. Dedupe on the Stripe **event id** — store processed event ids (a `ProcessedWebhookEvent` table, unique on event id) and ignore repeats. This is the same idempotency pattern, one layer out.
5. **Failure recovery:** verify the webhook signature (reject forgeries); on transient processing failure return non-2xx so Stripe retries; reconcile via a scheduled job that fetches PaymentIntents that never produced a terminal webhook. Tie the **unpaid timeout** to the existing Durable timer (see [[M8-azure-durable]]) so an abandoned booking expires and releases the slot.

**Key insight to state:** the existing `DepositKey` column and 400-on-missing-key already establish the idempotency *contract*; Stripe just makes the key *do real work* (charge dedupe) instead of DB-only dedupe.

### 5.2 Twilio / SendGrid reminders via Durable Functions

The Durable orchestration already has the reminder *seam* — it's a stubbed activity:

```csharp
[Function(nameof(SendReminder))]
public static string SendReminder([ActivityTrigger] BookingInput i, FunctionContext fc)
{
    fc.GetLogger(nameof(SendReminder)).LogInformation(
        "[{Brand}] Reminder: deposit due for appointment {Id}.", i.BrandId, i.AppointmentId);
    return "reminded";
}
```
— `functions/BookingWorkflow.cs:70-76`

The orchestrator already fires a **durable timer** then calls `SendReminder`, then awaits the `DepositPaid` external event with a timeout (`functions/BookingWorkflow.cs:34-46`). To make it real: inside `SendReminder`, call **Twilio** (SMS) or **SendGrid** (email). Activities are the right place — they run at-least-once and Durable Functions retries them, so the activity itself must be **idempotent** (pass a Twilio/SendGrid idempotency key, or guard on a "reminder sent" flag) so a replay doesn't text the customer twice. This is exactly the same exactly-once-effect discipline as the deposit. See [[M8-azure-durable]] for why the orchestrator (timers, replay-safe state, human-interaction wait) is the right host for a multi-day reminder→deposit→expire workflow.

### 5.3 Geospatial scheduling

The data is already there — every territory carries coordinates:

```csharp
public double? Lat { get; set; }             // map coords, clustered by region
public double? Lng { get; set; }
```
— `api/Domain.cs:64-65`

Today these power a **map view** (territories plotted, clustered by region). The roadmap extension is **routing & territory assignment**:
- **Territory assignment:** point-in-polygon — given a customer's lat/lng, which territory owns it? (SQL Server `geography` type / `STContains`, or a service like Mapbox.)
- **Route optimization:** order a technician's appointments to minimize drive time (a TSP-style solve, or an external routing API). The booking handler could even *prefer* slots that cluster geographically.
- **Nearest-available:** when a slot is double-booked and 409s, suggest the nearest open slot by distance instead of just "pick another."

This turns the passive map into an operational scheduler. State clearly in interview: **the lat/lng exist and render today; routing/assignment is the unbuilt layer on top.**

---

## 6. Interview defense — follow-ups & answers

**Q: Why optimistic concurrency instead of locking the slot row?**
Booking contention is low — a given slot is rarely fought over in the same second — so holding a lock on every read penalizes the 99.9% happy path to protect the 0.1% race. Optimistic keeps the hot path lock-free; the rare loser just gets a 409 and picks another slot. If we had a genuinely contended resource (one emergency truck per region), I'd switch to pessimistic locking or a queue — it's a contention-rate decision.

**Q: You have a unique index on `SlotId` *and* a version token. Isn't one redundant?**
They guard different rows for the same invariant. The version token catches the read-modify-write race on the **slot** (and protects `IsBooked`/`Version` from any code path). The unique index catches the insert race on the **appointment** even if two requests both read `IsBooked == false`. Belt and suspenders on the revenue path is a deliberate choice, not an accident — and the handler catches both `DbUpdateConcurrencyException` and `DbUpdateException`, mapping each to 409 (`BookingEndpoints.cs:61-68`).

**Q: What stops a deposit being charged twice?**
The client sends an `Idempotency-Key`; the first call stores it on the row in the same transaction as the charge; any retry finds the key already set and returns the original result without re-writing. Missing key is a hard 400 — we never charge without one. With real Stripe, I'd pass that same key to Stripe so the dedupe is end-to-end, and dedupe webhooks on the Stripe event id.

**Q: Webhooks fire twice — now what?**
Providers are at-least-once and replay. Same pattern, one layer out: dedupe on the provider's event id, stored unique, processed once. Verify the signature first (reject forgeries), return non-2xx on transient failure so the provider retries, and reconcile via a scheduled sweep for intents that never produced a terminal webhook.

**Q: The deposit handler returns 200 on a retry, not 409. Why not 409 like booking?**
Because a deposit retry isn't a *conflict* — it's the **same intended operation** arriving again, and idempotency means it should succeed with the same result. 409 is for "you tried to do something that conflicts with current state" (booking a taken slot). A retried deposit with the same key is a success replay → 200 with the original body. Different semantics, different status code.

---

## Flashcards

1. **Q:** What HTTP status does the loser of a double-booking race get? **A:** 409 Conflict (`BookingEndpoints.cs:61-68`).
2. **Q:** What EF Core feature makes `Slot.Version` enforce concurrency? **A:** `.IsConcurrencyToken()` — it appends `Version` to the UPDATE's WHERE clause (`AppDb.cs:58`).
3. **Q:** What does EF do when an UPDATE with a concurrency token affects 0 rows? **A:** Throws `DbUpdateConcurrencyException` (expected 1, got 0).
4. **Q:** What's the *second* guard against double-booking, besides the version token? **A:** Unique index on `Appointment.SlotId` (`AppDb.cs:61`) → `DbUpdateException` → 409.
5. **Q:** What header makes the deposit idempotent? **A:** `Idempotency-Key` (`BookingEndpoints.cs:79`).
6. **Q:** What happens if the deposit POST has no `Idempotency-Key`? **A:** 400 — fail fast, never charge without a key (`BookingEndpoints.cs:79-80`).
7. **Q:** How is a deposit retry detected? **A:** `appt.DepositKey is not null` → return the already-applied result, no re-write (`BookingEndpoints.cs:85`).
8. **Q:** Why persist the idempotency key in the *same* transaction as the effect? **A:** A crash between charge and key-store would lose the dedupe and let a retry charge again.
9. **Q:** Optimistic vs pessimistic — pick optimistic when…? **A:** Conflicts are rare and you want a lock-free happy path.
10. **Q:** Idempotency-key vs natural-key dedupe — HFC uses which where? **A:** Natural key (unique SlotId) for one-appt-per-slot; idempotency key for deposits (no good natural key for "same payment retried").
11. **Q:** Why is at-least-once delivery the root of both patterns? **A:** You can't stop duplicate *requests* (retries/replays); you make the *effect* exactly-once.
12. **Q:** What does the smoke test assert for reliability? **A:** book→201, re-book→409, retried deposit stays 5000¢, missing-key→400 (`smoke-api.sh:42-59`).

---

## Mock Q&A

**1. Walk me through what happens when two agents book the same slot at the same instant.**
Both read the slot at `Version=1`, `IsBooked=false`, both pass the in-memory check. On save, EF emits `UPDATE ... WHERE Id=? AND Version=1`. The first commits (1 row, `Version→2`); the second now matches 0 rows, EF throws `DbUpdateConcurrencyException`, the handler returns 409 (`BookingEndpoints.cs:59-64`). Even if both got past the version check, the two appointment inserts collide on the unique `SlotId` index → `DbUpdateException` → also 409.
- *Follow-up: which fires first?* The version-token UPDATE happens before the appointment INSERT in the same `SaveChanges`, so for the slot-row race the `DbUpdateConcurrencyException` is the typical winner; the unique index is the backstop for edge cases.

**2. A customer says they were charged twice for a deposit. How does the system prevent that, and how would you debug it?**
Prevent: the `Idempotency-Key` header; first call stores it on the row with the charge in one transaction; retries short-circuit on `DepositKey is not null` (`BookingEndpoints.cs:85-90`). Debug: check whether the client sent the *same* key on both calls — if it generated a new key per retry, that's a client bug, not a server one. With real Stripe I'd also check Stripe's idempotency dedupe and webhook event-id dedupe.
- *Follow-up: client sent two different keys for one intent — whose bug?* Client's. The contract is "same intent → same key." The server can only dedupe what the client tells it is the same operation. That's the inherent limit of client-supplied idempotency keys vs server natural keys.

**3. Design the real Stripe deposit. What changes from the stub?**
Server creates a PaymentIntent (passing the request's idempotency key through to Stripe), returns `client_secret`; client confirms with Stripe.js; a signature-verified webhook on `payment_intent.succeeded` is the source of truth that marks paid; webhook handler dedupes on Stripe event id; a reconciliation sweep + the Durable unpaid-timeout handle the gaps. The existing `DepositKey`/400 contract already encodes the idempotency shape — Stripe just makes the key charge-real.
- *Follow-up: webhook arrives before the client returns — race?* Fine — the webhook is the source of truth, so it can mark paid first; the client callback is a UX nicety, not the commit point. Dedupe on event id makes the order irrelevant.

**4. Where does geospatial come in, and what's built vs not?**
Built: every territory has `Lat`/`Lng` (`Domain.cs:64-65`) that render a region-clustered map. Not built: point-in-polygon territory assignment from a customer address, route optimization for a tech's day, and nearest-open-slot suggestions when a slot 409s. The data layer is ready; the routing layer is the roadmap.
- *Follow-up: where would you compute routing — API, Functions, or external?* External routing API (Mapbox/Google) called from a Durable activity or a background Function, cached — it's CPU-heavy and rate-limited, so it doesn't belong on the synchronous booking request.

**5. Why build *these two* reliability patterns first, before Stripe or notifications?**
They protect the integrity of the data the money path depends on, and they need no external dependency to be correct — they're pure database discipline. You can't safely *add* Stripe until "one appointment per slot" and "one charge per intent" are already guaranteed locally; otherwise you'd be charging real money on top of a racy data model. Reliability is the foundation; integrations build on it.
- *Follow-up: could you ship Stripe without the idempotency column?* No — Stripe's dedupe is 24h and provider-side; you still want your own row-level record of "this appointment's deposit settled" so reconciliation and the unpaid-timeout have a local source of truth.

---

*See also: [[M8-azure-durable]] — the Durable orchestrator that hosts the reminder activity, the unpaid-deposit timeout, and the `DepositPaid` external-event wait that the Stripe webhook would raise.*
