# M8 — Azure Delivery + Durable Functions

> Mastery doc for the HFC Senior Full Stack Cloud Developer interview.
> Everything below is grounded in real files in `hfc-demo/`. File:line citations are exact — quote them, don't paraphrase numbers.
> Cross-links: [[M9-cicd-prod]] (how this ships), [[M10-reliability-integrations]] (how this stays up and talks to Stripe/Twilio).

---

## 1. Mental model

The post-booking lifecycle is **not a request/response** — it is a saga that spans **minutes to days**: confirm the booking, send a reminder, then wait for the customer to pay a deposit *or* let the slot expire. That outlives any HTTP request, any single API process, any deploy, and (on Consumption) any scale-to-zero.

Three places you could put that logic, and why we landed on Durable Functions:

| Option | What breaks |
|---|---|
| Background `Task`/timer inside the ASP.NET API | State lives in process memory. Deploy, restart, or scale-to-zero loses every in-flight booking. No durable "wait for an event." |
| Service Bus queue + a worker that hand-rolls state | You now own the state machine: a DB table of "where is this booking," idempotency, retry/backoff, and a separate scheduler for the timeout. Lots of correct-but-tedious plumbing. |
| **Durable Functions orchestrator** | The framework owns durable state, retries, timers, and event-waiting. You write the saga as *straight-line async C#*. |

The one idea to internalize: **the orchestrator function is replayed from an event history**. Every `await` is a checkpoint. When the orchestrator wakes up (deposit arrives, timer fires, process restarts), the runtime *re-runs the function from the top*, replaying completed steps from history instead of re-executing them, until it reaches the first thing that hasn't happened yet. That's why the state is durable "for free" — and it's also the source of every footgun (determinism rules, below).

```
Static Web App / SPA  ──calls──▶  App Service (ASP.NET API)  ──managed identity──▶  Azure SQL (serverless)
                                        │ starts orchestration
                                        ▼
                                  Function App (Durable) + Storage  ──▶  Application Insights
```
(That diagram is the header comment in `infra/main.bicep:1-14`.)

---

## 2. The booking→deposit saga, in real code

`functions/BookingWorkflow.cs:25-59` is the whole orchestrator. The shape is **confirm → durable-timer reminder → race(external event, durable timeout) → finalize or expire**.

```csharp
// functions/BookingWorkflow.cs:32-37
await context.CallActivityAsync(nameof(ConfirmBooking), input);

// Durable timer: a reminder a bit after confirmation. context.CurrentUtcDateTime
// (not DateTime.UtcNow) keeps replay deterministic.
await context.CreateTimer(context.CurrentUtcDateTime.AddSeconds(2), CancellationToken.None);
await context.CallActivityAsync(nameof(SendReminder), input);
```

The heart of the saga — the **await-deposit-OR-timeout** race — is `BookingWorkflow.cs:42-58`:

```csharp
// functions/BookingWorkflow.cs:42-58
using var cts = new CancellationTokenSource();
var deadline = context.CurrentUtcDateTime.AddSeconds(input.TimeoutSeconds);
Task timeout = context.CreateTimer(deadline, cts.Token);
Task<double> paid = context.WaitForExternalEvent<double>("DepositPaid");

var winner = await Task.WhenAny(paid, timeout);
if (winner == paid)
{
    cts.Cancel(); // tidy up the pending timer
    await context.CallActivityAsync(nameof(FinalizeBooking), input);
    log.LogInformation("Appointment {Id} finalized (deposit ${Amt}).", input.AppointmentId, paid.Result);
    return "finalized";
}

await context.CallActivityAsync(nameof(ExpireBooking), input);
log.LogInformation("Appointment {Id} expired (no deposit within {S}s).", input.AppointmentId, input.TimeoutSeconds);
return "expired";
```

Why this is the part people miss: it's easy to write `WaitForExternalEvent("DepositPaid")` and **forget the timer**. Without the durable timer, an abandoned booking waits *forever* — the orchestration never completes and the slot is never released. The `Task.WhenAny(paid, timeout)` race + `cts.Cancel()` on the winning path is the canonical "human interaction with a timeout" pattern. The author flagged exactly this in the comment at `BookingWorkflow.cs:39-41`.

**Activities** (`BookingWorkflow.cs:62-92`) are the side-effecting steps — `ConfirmBooking`, `SendReminder`, `FinalizeBooking`, `ExpireBooking`. They're separate `[Function]`s with `[ActivityTrigger]`. This separation matters: **activities are where you do non-deterministic / I/O work** (DB writes, send SMS, call Stripe), and the runtime **automatically retries** them on failure. The orchestrator stays pure.

**Starter** (`BookingWorkflow.cs:95-109`) is an HTTP-triggered function that injects `[DurableClient] DurableTaskClient` and calls `ScheduleNewOrchestrationInstanceAsync(...)`, then returns `CreateCheckStatusResponseAsync` — the built-in 202 + `statusQueryGetUri` / `raiseEventPostUri` management URLs:

```csharp
// functions/BookingWorkflow.cs:104-108
var instanceId = await client.ScheduleNewOrchestrationInstanceAsync(
    nameof(BookingOrchestrator), new BookingInput(brandId, appointmentId, timeoutSeconds));
return await client.CreateCheckStatusResponseAsync(req, instanceId);
```

The deposit event is raised back into the running instance (via `raiseEventPostUri` / the client's `RaiseEventAsync`) carrying the `double` amount that `WaitForExternalEvent<double>("DepositPaid")` unwraps.

### Why Durable Functions over a chained queue — feature by feature

- **Durable state**: the orchestrator's local variables and progress survive restarts because they're reconstructed from event history. No state table to design.
- **Automatic retries**: activity failures are retried by the framework (you can attach a `RetryPolicy`); with a raw queue you write the dead-letter/redelivery logic yourself.
- **Fan-out/fan-in**: `Task.WhenAll(items.Select(i => context.CallActivityAsync(...)))` parallelizes N activities and joins them with one line — e.g. notify every crew member, or run NPS review generation across appointments (`NpsWorkflow.cs` is the second orchestration in this demo).
- **Durable timers**: `context.CreateTimer(deadline)` is a *persisted* timer that survives process death — that's the deposit timeout. A queue gives you no native long-delay scheduler.
- **Replay/determinism**: the saga reads as linear code instead of a pile of message handlers and a correlation ID threaded through all of them.

### Replay / determinism rules (the orchestrator contract)

The orchestrator body runs **many times** (once per replay). So it must be **deterministic**:

- **No `DateTime.UtcNow`** — use `context.CurrentUtcDateTime`. The code comment at `BookingWorkflow.cs:34-35` calls this out: "`context.CurrentUtcDateTime` (not DateTime.UtcNow) keeps replay deterministic." On replay, `CurrentUtcDateTime` returns the *same* value it did originally; `UtcNow` would drift and corrupt the history.
- **No `Guid.NewGuid()`, `Random`, direct I/O, or DB/HTTP calls** in the orchestrator — push all of that into activities.
- **No blocking** (`Thread.Sleep`, `.Result` on non-durable tasks) — only `await` durable APIs.
- **Use the replay-safe logger** so you don't emit duplicate log lines on every replay: `var log = context.CreateReplaySafeLogger(...)` (`BookingWorkflow.cs:30`).

If you violate these, the replay diverges from the recorded history → "non-deterministic orchestrator" failure (see Failure modes).

---

## 3. App Service: Linux container, same-origin SPA + API

The API runs on a **Linux App Service** with a .NET runtime, defined at `infra/main.bicep:58-94`:

```bicep
// infra/main.bicep:58-64
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  sku: { name: 'F1', tier: 'Free' } // bump to B1 for always-on / no cold start
  kind: 'linux'
  properties: { reserved: true }
}
```

```bicep
// infra/main.bicep:73-74
linuxFxVersion: 'DOTNETCORE|9.0'
```

**Same-origin SPA + API.** Rather than a standalone Static Web App, the Angular production build is copied into the API's `wwwroot` and ASP.NET Core serves it (with an `index.html` SPA fallback). The reasons are documented honestly at `main.bicep:174-178`: the Static Web App CLI upload was blocked by a build-environment proxy, and single-origin hosting **avoids the CORS hop**. The deploy step that does it:

```bash
# infra/deploy.sh:56-60
echo "window.__API_BASE__='';" > "$ROOT/web/public/api-base.js"
(cd "$ROOT/web" && npm ci && npx ng build --configuration production)
rm -rf "$ROOT/api/wwwroot" && mkdir -p "$ROOT/api/wwwroot"
cp -r "$ROOT/web/dist/web/browser/." "$ROOT/api/wwwroot/"
```

`window.__API_BASE__=''` makes the SPA call its own origin — no separate API URL, no CORS preflight. One App Service, two responsibilities.

The Functions can't share the API's F1 plan; they get their **own Consumption (Y1 Dynamic) plan** — `main.bicep:108-115` — because Functions need the Dynamic SKU.

---

## 4. Azure SQL serverless + passwordless (managed identity / Entra)

**Serverless SQL** is provisioned only on the second pass (`deploySql=true`), `main.bicep:156-165`:

```bicep
// infra/main.bicep:160-164
sku: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose' } // serverless, 1 vCore
properties: {
  autoPauseDelay: 60 // auto-pause after 1h idle to save cost
  minCapacity: json('0.5')
}
```

Serverless = it **auto-pauses** after idle and auto-resumes on the next connection — cheap for a demo, at the cost of a **resume cold start** (first query after a pause can take seconds). That's the trade-off below.

**Passwordless / Entra-only auth.** There are *no SQL passwords anywhere*. Two layers:

1. The SQL server admin is an **Entra principal** with `azureADOnlyAuthentication: true` (`main.bicep:146-152`):
   ```bicep
   administrators: {
     administratorType: 'ActiveDirectory'
     azureADOnlyAuthentication: true // no SQL passwords — Entra only
     principalType: 'User'
   }
   ```
   `deploy.sh:26-27` sets that admin to *the signed-in user* (`az ad signed-in-user show`), so whoever runs the deploy becomes the Entra SQL admin — no secret generated.

2. The **API authenticates with its system-assigned managed identity** — `identity: { type: 'SystemAssigned' }` at `main.bicep:69` — and the connection string carries **no password**, just `Authentication=Active Directory Default` (`main.bicep:88-90`):
   ```bicep
   value: deploySql
     ? 'Server=tcp:...,1433;Database=...;Authentication=Active Directory Default;Encrypt=True;'
     : 'Data Source=/tmp/hfc-demo.db'
   ```
   The identity is granted a SQL login *as a database user* (not a secret) — `deploy.sh:46-52` prints the exact `CREATE USER [...] FROM EXTERNAL PROVIDER; ALTER ROLE db_datareader/db_datawriter ...` to run as the Entra admin.

So the whole secret-management story is: **there are no connection-string secrets to rotate, leak, or store.** That's the headline for the interview.

---

## 5. App Insights / observability

One Log Analytics workspace (`main.bicep:38-45`) backs one App Insights component (`main.bicep:47-55`), and **both** the API and the Function App point at it via `APPLICATIONINSIGHTS_CONNECTION_STRING` (`main.bicep:78` and `main.bicep:134`). That gives you correlated **logs + metrics + traces** across the HTTP request that starts a workflow and the orchestration that runs it. The Functions host opts into OpenTelemetry export — `host.json:3` (`"telemetryMode": "OpenTelemetry"`).

Honest demo caveat: the Functions `Program.cs:4-7` notes the local OTel exporter needs a live connection string, so it's *omitted locally* to keep `func start` clean and only wired in Azure via the app setting.

---

## 6. Be honest: demo realities visible in the code

A senior interviewer rewards you for naming the gaps before they do.

- **The API runs in `Development` in Azure.** `main.bicep:79-80`: `ASPNETCORE_ENVIRONMENT=Development`. This is *deliberate* so the built-in **dev-login** (no external IdP wired up) works in the cloud demo. In real prod you'd run `Production` and put Entra ID / a real auth provider in front. Say this out loud.
- **SQLite by default, Azure SQL is opt-in.** `deploySql` defaults to `false` (`main.bicep:24`), so the default deploy uses **SQLite at `/tmp/hfc-demo.db`** (`main.bicep:90`). And it's on `/tmp` *on purpose*: `/tmp` is wiped on each container start, so every boot **reseeds a clean DB** — which sidesteps a startup-rebuild crash seen against a *persisted* (`/home`) SQLite file (`main.bicep:85-87`). Azure SQL serverless is the "second pass / real" path.
- **The orchestrator timeout is seconds, not hours.** `StartBookingWorkflow` defaults `timeoutSeconds` to 30 (`BookingWorkflow.cs:103`) "so the demo can show expiry without waiting; real default would be hours."
- **F1 Free plan ⇒ cold starts.** `main.bicep:61` comment: "bump to B1 for always-on / no cold start." Free has no always-on.

---

## 7. Trade-offs (say these unprompted)

**Durable Functions vs Service Bus + workers**
- *Durable wins* when the logic is a **stateful saga / human-in-the-loop with timers** (exactly our deposit flow): less code, framework-owned state + retries + timers, linear readability.
- *Service Bus wins* for **high-throughput, stateless, fire-and-forget** messaging, ordering/sessions, competing consumers across heterogeneous services, or when you need a durable buffer between systems that don't share the Durable runtime. Durable's storage (Azure Storage queues/tables by default) is not built for million-msg/sec throughput.
- They compose: an activity inside the orchestrator can *publish to Service Bus* to hand work to another system (e.g. fan out to an external crew-dispatch service) — see [[M10-reliability-integrations]].

**Serverless SQL auto-pause vs provisioned**
- *Serverless wins* on **cost for spiky/low traffic** (auto-pause to ~$0 compute) — perfect for a demo or low-volume territory.
- *Cost*: the **resume cold start** — first query after a pause pays a multi-second resume penalty, and `autoPauseDelay: 60` (`main.bicep:162`) means a quiet hour triggers it. For latency-sensitive prod, use provisioned compute or a short/disabled auto-pause and accept the floor cost.

**Consumption Functions vs Premium/Dedicated**
- Consumption (Y1, `main.bicep:112`) = pay-per-execution, scale-to-zero, but **cold starts** and no VNet by default. Premium removes cold start and adds VNet — the prod move if SLA matters.

**F1 App Service vs B1+**
- F1 is free but **no always-on, low CPU, container start limits** → cold starts and the start-timeout risk below. B1 is the first "real" tier.

---

## 8. Failure modes (and the mitigations in this repo)

1. **Orphaned orchestration.** If you wait on `DepositPaid` with no timeout, an abandoned booking hangs forever and the slot is never released. *Mitigation in code:* the durable-timer race at `BookingWorkflow.cs:42-58` guarantees the instance always completes (`finalized` or `expired`). The dashboard even tracks "Bookings that expired without a deposit (the workflow leak)" — `api/DashboardReadModel.cs:161`.

2. **Non-deterministic orchestrator code.** Calling `DateTime.UtcNow`, `Guid.NewGuid()`, `Random`, or doing I/O directly in the orchestrator makes a replay diverge from history → the runtime throws a non-determinism error or wedges the instance. *Mitigation:* `context.CurrentUtcDateTime` (`BookingWorkflow.cs:36, 43`), `CreateReplaySafeLogger` (`BookingWorkflow.cs:30`), and all side effects pushed into activities (`BookingWorkflow.cs:62-92`).

3. **Cold-start container timeout (a real issue we hit).** On the F1 plan, **container cold start + EF Core create/seed exceeded the default 230s container start limit and tripped a crash-loop.** *Mitigation:* `WEBSITES_CONTAINER_START_TIME_LIMIT=900` in `main.bicep:81-83` ("Cold start + EF create/seed on F1 can exceed the default 230s container start limit and trip a crash-loop; give it generous headroom"). The deploy also has a **health gate** that polls `/health` up to 60×10s and *fails the deploy* if it never returns 200 (`deploy.sh:80-92`) — so a crash-looping container is caught at deploy time, not by a user. See [[M9-cicd-prod]].

4. **Persisted-SQLite startup crash.** A SQLite DB on `/home` (persisted) hit a startup rebuild crash; moving it to ephemeral `/tmp` so each boot reseeds clean sidesteps it (`main.bicep:84-90`).

5. **Activity failures.** Activities are I/O and *will* fail (SMS provider down, DB timeout). The framework retries them; for external calls you attach a `RetryPolicy` with backoff and make the activity **idempotent** (the dashboard models the deposit as idempotent — "DepositKey is set (deposit captured, idempotent)" `api/DashboardReadModel.cs:22`).

---

## 9. Interview defense — follow-ups + answers

**Q: "Your orchestrator does `Task.WhenAny(paid, timeout)`. What actually happens when the process dies mid-wait?"**
A: Nothing is lost. The wait is two *durable* awaits — an external-event subscription and a persisted timer — both recorded in the instance's event history in storage. When a worker picks the instance back up, it **replays the orchestrator from the top**, reconstructs that it's parked on `WhenAny`, and resumes. Whichever of the deposit event or the timer fires first wakes it; the loser is cancelled via the `CancellationTokenSource` (`BookingWorkflow.cs:42, 50`).

**Q: "Why not just a `Task.Delay` and a background service in the API?"**
A: `Task.Delay` lives in process memory — a deploy, restart, or scale-to-zero loses every in-flight timeout, and you'd be hand-rolling a state table, a scheduler, and idempotent retries to make it durable. Durable Functions gives me persisted timers, durable state, and automatic activity retries out of the box, and the saga reads as linear code. For a wait that can be hours/days, in-process is just wrong.

**Q: "How does the API talk to SQL without a password — and how is that better?"**
A: System-assigned managed identity. The App Service has `identity: SystemAssigned` (`main.bicep:69`); the connection string is `Authentication=Active Directory Default` with no secret (`main.bicep:88-90`); and the identity is granted a contained DB user via `CREATE USER ... FROM EXTERNAL PROVIDER` (`deploy.sh:48`). The SQL server is Entra-only (`azureADOnlyAuthentication: true`, `main.bicep:150`). Better because there's **no secret to store, rotate, or leak** — Azure issues short-lived tokens to the identity automatically.

**Q: "You said the demo runs in Development mode in Azure — isn't that a security problem?"**
A: Yes, and it's a deliberate demo shortcut, not a pattern. `ASPNETCORE_ENVIRONMENT=Development` (`main.bicep:80`) is there so the built-in dev-login works without standing up a real IdP. For prod I'd flip to `Production`, disable the dev-login, front the API with Entra ID (or the franchise's auth), and keep the managed-identity/SQL story unchanged.

**Q: "What broke in deployment and how did you find it?"**
A: On F1, the container's cold start plus EF create/seed blew past the **230s** default start limit and crash-looped. I raised `WEBSITES_CONTAINER_START_TIME_LIMIT` to 900 (`main.bicep:81-83`) and moved SQLite to ephemeral `/tmp` to avoid a persisted-rebuild crash (`main.bicep:84-90`). I caught it because the deploy has a **health gate** that fails if `/health` doesn't 200 within ~10 min (`deploy.sh:80-92`) — the failure surfaced at deploy, not in front of a user.

---

## 10. Demo proof (how to show it live)

1. **Start a booking workflow** — `POST /api/bookings/{brandId}/{appointmentId}/workflow?timeoutSeconds=30` (route at `BookingWorkflow.cs:97`). You get a 202 with `statusQueryGetUri` + `raiseEventPostUri` (`BookingWorkflow.cs:108`).
2. **Path A — finalize:** raise the `DepositPaid` event (POST to `raiseEventPostUri` with the amount) within the window. Logs show `Appointment {Id} finalized (deposit ${Amt})` and the instance returns `"finalized"` (`BookingWorkflow.cs:51-53`).
3. **Path B — expire:** do nothing; after `timeoutSeconds` the durable timer wins, `ExpireBooking` runs, logs `expired — slot released`, returns `"expired"` (`BookingWorkflow.cs:56-58`).
4. **Show it in the dashboard:** the deposit funnel mirrors the workflow stages, incl. `DepositPaid` and the expired-without-deposit "leak" metric (`api/DashboardReadModel.cs:180-188, 161`).
5. **Prove the health gate:** `deploy.sh` won't print "✅ Done" until `/health` returns 200 (`deploy.sh:80-93`).

(`scripts/` and the `e2e/` drivers + `run-hfc-demo` skill automate launching and driving this.)

---

## Flashcards

1. **Why Durable Functions over a queue+worker for the deposit saga?** Durable state + automatic retries + persisted timers + linear code; you don't hand-roll a state table or a scheduler. (`BookingWorkflow.cs:10-18`)
2. **What is the single most-forgotten piece of the await-deposit flow?** The durable *timer* that bounds the wait — without it, an abandoned booking hangs forever. (`BookingWorkflow.cs:39-44`)
3. **Why `context.CurrentUtcDateTime` not `DateTime.UtcNow`?** Orchestrators replay; `CurrentUtcDateTime` returns the same value each replay so history stays deterministic. (`BookingWorkflow.cs:34-36`)
4. **Where do side effects (DB, SMS, Stripe) go?** In activities (`[ActivityTrigger]`), never the orchestrator — activities are retried and may be non-deterministic. (`BookingWorkflow.cs:61-92`)
5. **How do you wait for the deposit AND a timeout?** `Task.WhenAny(WaitForExternalEvent<double>("DepositPaid"), CreateTimer(deadline))`, then cancel the loser. (`BookingWorkflow.cs:45-50`)
6. **How does the API auth to SQL?** System-assigned managed identity + `Authentication=Active Directory Default` — no password. (`main.bicep:69, 88-90`)
7. **What makes SQL "passwordless / Entra-only"?** `azureADOnlyAuthentication: true` admin + a contained DB user via `CREATE USER ... FROM EXTERNAL PROVIDER`. (`main.bicep:150`, `deploy.sh:48`)
8. **Why one App Service for SPA + API?** SPA prod build copied into `wwwroot`, served same-origin → no CORS hop. (`deploy.sh:56-60`, `main.bicep:174-178`)
9. **What's the serverless-SQL trade-off?** Auto-pause (`autoPauseDelay: 60`) = near-zero idle cost, but a resume cold start on first query. (`main.bicep:162`)
10. **What real deploy bug did the F1 plan cause?** Cold start + EF seed exceeded the 230s container start limit → crash loop; fixed with `WEBSITES_CONTAINER_START_TIME_LIMIT=900`. (`main.bicep:81-83`)
11. **What stops a bad container from reaching users?** A post-deploy health gate polling `/health` that fails the deploy. (`deploy.sh:80-92`)
12. **Honest caveat about the Azure demo's mode?** Runs `ASPNETCORE_ENVIRONMENT=Development` so the built-in dev-login works; prod would be `Production` + real IdP. (`main.bicep:79-80`)

---

## Mock Q&A

**Q1. Walk me through the post-booking workflow end to end.**
A: HTTP starter `StartBookingWorkflow` schedules a `BookingOrchestrator` instance and returns 202 + management URLs (`BookingWorkflow.cs:95-109`). The orchestrator calls `ConfirmBooking`, fires a durable timer then `SendReminder`, then races `WaitForExternalEvent<double>("DepositPaid")` against a durable timeout timer. Deposit-first → `FinalizeBooking`, return `"finalized"`; timeout-first → `ExpireBooking`, return `"expired"` (`BookingWorkflow.cs:32-58`).
- *Follow-up: where's the deposit amount come from?* The external event is typed `<double>`; the caller raises `DepositPaid` with the dollar amount via `raiseEventPostUri`, and `paid.Result` is logged (`BookingWorkflow.cs:45, 52`).

**Q2. The orchestrator runs many times due to replay. What rules does that impose?**
A: Determinism — no `DateTime.UtcNow` (use `CurrentUtcDateTime`), no `Guid.NewGuid`/`Random`, no direct I/O, no blocking; use a replay-safe logger and push side effects into activities. Break a rule and replay diverges from history → non-determinism failure (`BookingWorkflow.cs:30, 34-36`).
- *Follow-up: how would I detect a violation?* App Insights will show the instance failing/looping with a non-determinism exception; you'd also see duplicated log lines if you forgot `CreateReplaySafeLogger`.

**Q3. Why not Service Bus + a worker for this?**
A: This is a stateful, human-in-the-loop saga with a long timer — Service Bus would mean owning the state machine, idempotency, retry, and a separate scheduler. Durable gives all of that and reads linearly. Service Bus is the right tool for high-throughput stateless messaging or buffering between systems — and an activity can publish to it to hand off external work.
- *Follow-up: throughput ceiling?* Durable's default backend is Azure Storage — fine for our volume, not for millions of msg/sec; that's when you reach for Service Bus or the Netherite/MSSQL backend. See [[M10-reliability-integrations]].

**Q4. Explain the passwordless data path.**
A: App Service has a system-assigned managed identity (`main.bicep:69`); the SQL connection string is `Authentication=Active Directory Default` with no secret (`main.bicep:88-90`); the server is Entra-only (`main.bicep:150`); the identity gets a contained DB user via `CREATE USER ... FROM EXTERNAL PROVIDER` (`deploy.sh:48`). Azure mints short-lived tokens — nothing to rotate or leak.
- *Follow-up: what if you needed Key Vault?* Same identity pattern — grant the MI a Key Vault access policy and read secrets with `DefaultAzureCredential`; still no stored secret.

**Q5. What broke in deployment and how is it guarded now?**
A: F1 cold start + EF create/seed exceeded the 230s container-start limit and crash-looped; raised `WEBSITES_CONTAINER_START_TIME_LIMIT` to 900 and moved SQLite to ephemeral `/tmp` to dodge a persisted-rebuild crash (`main.bicep:81-90`). The deploy now health-gates on `/health` and fails if it doesn't 200 within ~10 min (`deploy.sh:80-92`).
- *Follow-up: real fix vs band-aid?* The band-aid is the time limit; the real fix for prod is B1+/always-on (no cold start) and Azure SQL instead of in-container SQLite — both are one parameter flip away (`main.bicep:24, 61`). See [[M9-cicd-prod]].

---

*See also: [[M9-cicd-prod]] — health gate, zip deploy, `func publish`, post-deploy e2e. [[M10-reliability-integrations]] — Stripe deposit idempotency, Twilio/SendGrid from activities, retry policies.*
