# Azure Functions & Durable Functions — project notes & interview prep

Audience: Senior Full Stack Cloud Developer candidate (.NET/Azure role).  
Grounded in `functions/BookingWorkflow.cs`, `functions/Program.cs`, and `.claude/skills/run-hfc-demo/SKILL.md`.

---

## What it is

**Azure Functions** is a serverless compute platform: you write trigger-bound methods (.NET, Node, Python, …) and the host scales them from zero to N instances on demand. Billing is per invocation + execution time (Consumption plan), with no infrastructure to manage.

**Durable Functions** is a stateful orchestration extension on top of Azure Functions. It lets you write multi-step, long-running workflows as ordinary `async` C# code while the framework handles: persisting state between steps, replaying the orchestrator after restarts, reliable retries of activities, durable timers that can sleep for days, and external-event signalling from outside the process. The storage backend (Azure Storage queues + tables, or SQL/Netherite alternatives) holds the full event history; the orchestrator function itself is *stateless executable code* — it is replayed from that history on every checkpoint.

The demo uses the **isolated worker model** (SDK packages under `Microsoft.Azure.Functions.Worker.*`) rather than the legacy in-process model. In isolated mode the Functions host and your .NET code run as separate processes communicating over gRPC, so you can target any .NET version, pick your own DI container, and upgrade either side independently.

---

## How it's used in the HFC demo

### Post-booking lifecycle

Every time a booking is created via the HFC scheduling API, the client can kick off a Durable orchestration via:

```
POST /api/bookings/{brandId}/{appointmentId}/workflow?timeoutSeconds=60
```

This calls `StartBookingWorkflow` (`functions/BookingWorkflow.cs` line 96), which schedules a new instance of `BookingOrchestrator` and returns HTTP 202 with a `CreateCheckStatusResponse` payload.

The orchestration flow inside `BookingOrchestrator` (line 26):

```
ConfirmBooking (activity)
  │
  ├─ durable timer: 2 s (demo) / hours in prod
  │
SendReminder (activity)
  │
  ├─ Task.WhenAny(
  │     WaitForExternalEvent<double>("DepositPaid"),
  │     CreateTimer(deadline)          ← durable timer = input.TimeoutSeconds from now
  │  )
  │
  ├─ winner == paid  →  FinalizeBooking (activity)  → return "finalized"
  └─ winner == timer →  ExpireBooking  (activity)  → return "expired"
```

### Human-interaction pattern

`context.WaitForExternalEvent<double>("DepositPaid")` (line 45) suspends the orchestration until an external HTTP caller POSTs to the `SendEventPostUri` returned at start. The payload (a `double` representing dollars paid) is typed directly on the task. If the payment never arrives, the parallel durable timer fires and the `Task.WhenAny` resolves on the timeout branch instead.

This is the canonical Durable Functions *human-interaction pattern*: a real-world action (a person paying a deposit) gates a long-running workflow without holding any thread open.

### Orchestrator vs activity vs client

| Role | Type | Trigger | Rules |
|---|---|---|---|
| `BookingOrchestrator` | Orchestrator | `[OrchestrationTrigger]` | Must be deterministic — no I/O, no `DateTime.UtcNow`, no `Guid.NewGuid`. |
| `ConfirmBooking`, `SendReminder`, `FinalizeBooking`, `ExpireBooking` | Activity | `[ActivityTrigger]` | Side-effecting work (send emails, update DB). Scheduled by the orchestrator; safe to retry. |
| `StartBookingWorkflow` | HTTP starter / client | `[HttpTrigger]` + `[DurableClient]` | Uses `DurableTaskClient` to schedule instances, query status, raise events. |

### Verified live in Azure

Deployed to `hfcdemo-func-pkz2lysbqoabq.azurewebsites.net` (Consumption plan, centralus). Smoke-tested:

- `Running → DepositPaid (POST SendEventPostUri) → runtimeStatus: Completed, output: "finalized"`
- `Running → timeout fires (no event) → runtimeStatus: Completed, output: "expired"`

---

## Why we chose it (and alternatives)

### Durable Functions vs `IHostedService` / `Task.Delay`

A naive approach: start a background `Task` in a hosted service, `await Task.Delay(TimeSpan.FromHours(24))`, then send the reminder. This dies the moment the process restarts, a new version deploys, or the Consumption plan scales to zero — which is exactly the scenario in cloud-native hosting. You'd need to re-invent state persistence, crash recovery, and distributed locking to replace what Durable gives you for free.

Durable Functions survive restarts and deploys because all state lives in the storage backend, not in process memory. The orchestrator code is replayed from the event history on the next available worker — no manual recovery needed.

### Durable Functions vs Logic Apps

Logic Apps is a low-code visual workflow designer backed by the same Durable engine. It's appropriate when non-developers need to own the workflow or when you're integrating a large number of connectors out of the box. For a code-first team, Durable Functions gives full testability (unit-testable activities, mock orchestration context), type-safety, git-diff-friendly changes, and no vendor lock on the designer format.

### Isolated worker vs in-process

In-process model (legacy, .NET Framework / .NET 6): your code runs inside the Functions host process. Simple setup but: tied to the host's .NET version, conflicts with host's DI container, and is now deprecated — Microsoft is dropping it in the next major host version.

Isolated worker: separate process, full control over .NET version, DI, middleware pipeline. The `Program.cs` here is three lines:

```csharp
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();
builder.Build().Run();
```

`ConfigureFunctionsWebApplication()` wires ASP.NET Core–style middleware (request pipeline) into the Functions host, enabling things like custom middleware for auth, logging, or model binding — not available in-process.

### Consumption hosting

The Functions app is deployed on a Consumption plan (effectively free at demo scale). Workers spin up per-trigger-event, bill per-100ms execution, and scale to zero between invocations. Durable timers sleeping for hours do not hold a worker alive — the timer state is a single record in Azure Storage; the worker only wakes for the next event.

---

## Core concepts to nail

### Orchestrator determinism and replay

The orchestrator function will be re-executed from the top — potentially dozens of times — as each activity completes or event arrives. The Durable framework replays it against the recorded event history, fast-forwarding awaited tasks that already completed so the function reaches the same `await` point it was at before. This is efficient and invisible to the developer *only if the code is deterministic*.

**Do not use in an orchestrator:**
- `DateTime.UtcNow` — returns a different value on replay. Use `context.CurrentUtcDateTime` (line 36, 43).
- `Guid.NewGuid()` — different on every replay. Use `context.NewGuid()`.
- `Random`, environment reads, direct HTTP calls, direct DB calls, `Thread.Sleep`.
- Non-deterministic branching based on wall-clock time or external state.

`context.CreateReplaySafeLogger` (line 31) suppresses log output during replay passes so you don't get duplicate log entries for every step.

### Durable timer + `Task.WhenAny` timeout pattern

```csharp
using var cts = new CancellationTokenSource();
var deadline = context.CurrentUtcDateTime.AddSeconds(input.TimeoutSeconds);
Task timeout  = context.CreateTimer(deadline, cts.Token);
Task<double> paid = context.WaitForExternalEvent<double>("DepositPaid");

var winner = await Task.WhenAny(paid, timeout);
if (winner == paid)
{
    cts.Cancel();           // cancel the pending timer to avoid a ghost checkpoint
    await context.CallActivityAsync(nameof(FinalizeBooking), input);
    return "finalized";
}
await context.CallActivityAsync(nameof(ExpireBooking), input);
return "expired";
```

Key points:
- `CreateTimer` schedules a durable timer in Azure Storage — it does not hold a thread.
- `WaitForExternalEvent` returns a `Task<T>` that completes when the named event is raised via the management HTTP API.
- `Task.WhenAny` lets both race; the losing task is cancelled via `CancellationTokenSource`.
- Cancelling the timer when it loses prevents a dangling timer checkpoint that would wake a second time.

### External events / human interaction

Raise an event from outside:

```bash
curl -X POST "$SendEventPostUri" \
  -H 'Content-Type: application/json' \
  -d '5000'
```

`SendEventPostUri` is returned in the 202 response body from `CreateCheckStatusResponse`. It already contains the required `code` auth parameter and the `instanceId`. The event name in the URI becomes the string passed to `WaitForExternalEvent`. The body is deserialized to the generic type (`double` here).

### Fan-out / fan-in

Not used in this demo but frequently asked: schedule N activities in a `List<Task>`, await `Task.WhenAll(tasks)`. Each activity can run on a separate worker concurrently. Results are collected after all complete. The orchestrator remains the coordinator — it does not do the work itself.

### Eternal orchestrations

An orchestration that never returns: call `context.ContinueAsNew(newInput)` at the end of the loop body. This restarts the orchestrator with a clean history (no unbounded event log growth), passing new input forward. Used for polling loops, nightly batch jobs, etc.

### Storage backend

The default backend uses three Azure Storage resources:
- **Queue**: work items dispatched to activity and orchestrator workers.
- **Table**: instance state, history events, custom status.
- **Blob**: large message payloads.

Locally, Azurite emulates all three (`--blobPort 10000 --queuePort 10001 --tablePort 10002`). In Azure, the same storage account is referenced via `AzureWebJobsStorage`. The history table is the source of truth for replay; you can query it directly to debug stuck orchestrations.

### At-least-once delivery and idempotent activities

The Durable framework guarantees at-least-once execution of activities: if a worker crashes mid-activity, the activity will be rescheduled. Activities must therefore be idempotent — running them twice produces the same observable result. In the HFC demo the activities are log-only (side-effect-free in the demo sense); in production you'd use idempotency keys on outbound API calls, upserts rather than inserts, etc.

### Status query and raise-event endpoints

`CreateCheckStatusResponse` (line 108) generates a 202 with a body containing:

| Key | Purpose |
|---|---|
| `id` | The orchestration instance ID |
| `StatusQueryGetUri` | Poll for current status and output |
| `SendEventPostUri` | Raise a named external event (has `{eventName}` placeholder) |
| `TerminatePostUri` | Force-terminate the instance |
| `PurgeHistoryDeleteUri` | Delete history |

All URIs include the auth `code` query parameter automatically. Do not construct these URLs by hand.

---

## Gotchas we actually hit

### Start response JSON is PascalCase

The 202 response from `CreateCheckStatusResponse` uses PascalCase keys (`Id`, `StatusQueryGetUri`, `SendEventPostUri`) — not camelCase as you might expect from a JSON API. Parsing it with a camelCase deserializer produces null URIs silently. The SKILL.md drive script uses Python's `json.load` which is case-sensitive:

```bash
STATUS=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['StatusQueryGetUri'])")
```

### Management endpoints require the `code` query parameter

Even on `AuthorizationLevel.Anonymous` HTTP starters, the Durable management webhooks (`/runtime/webhooks/durabletask/...`) are protected by a separate system key. Constructing those URLs manually (without `code`) returns 401. Always extract and use the URIs returned by the start call — they include the correct `code` value.

### Telemetry packages removed for local runs

The Functions template adds `Microsoft.Azure.Functions.Worker.ApplicationInsights` and OpenTelemetry exporter packages. These attempt to connect to Application Insights at startup; without `APPLICATIONINSIGHTS_CONNECTION_STRING` they throw and pollute the startup log (or fail to start cleanly). The demo's `functions.csproj` has these removed. In Azure, the app setting `APPLICATIONINSIGHTS_CONNECTION_STRING` is set by Bicep and telemetry flows automatically.

### `func start` must see the csproj

Run `func start` from `hfc-demo/` (repo root) or from `hfc-demo/functions/`. The CLI auto-discovers the `.csproj`. Running from an unrelated directory finds no functions.

### Azurite must be running first

`func start` without Azurite produces cryptic Azure Storage connection errors immediately. Start Azurite first:

```bash
azurite --silent --location /tmp/azurite \
  --blobPort 10000 --queuePort 10001 --tablePort 10002 &
```

---

## Interview Q&A

**Q1: Why must an orchestrator function be deterministic, and what happens if it isn't?**

The Durable runtime replays the orchestrator from its event history every time it wakes up. It fast-forwards past steps whose results are already recorded. If the code is non-deterministic — say it calls `DateTime.UtcNow` — it may produce a different branch on replay than it did originally. The replayed state diverges from the recorded history, which causes wrong branching, skipped steps, or a `NonDeterministicOrchestrationException`. The framework cannot detect all violations automatically; some produce silent data corruption.

**Q2: Walk me through how the durable timer + `Task.WhenAny` timeout pattern works at the storage level.**

`context.CreateTimer(deadline, token)` writes a timer record into Azure Storage (a queue message with a visibility delay). The orchestrator checkpoints and the worker is released — no thread is held. When the deadline arrives, the storage queue makes the timer message visible, a worker picks it up, and replays the orchestrator. Meanwhile `WaitForExternalEvent` records a "waiting for event" entry in the history table. If the external event arrives first, a different worker replays with the event in history and the `Task.WhenAny` resolves on the paid branch. The losing task is cancelled via `CancellationTokenSource` to clean up its pending timer record.

**Q3: How do you raise an external event and what does the orchestrator receive?**

POST to the `SendEventPostUri` from the 202 start response (replace `{eventName}` with the event name). The body is any JSON-serializable value. The runtime stores the event in the orchestration history. On the next replay, `WaitForExternalEvent<T>` finds the matching event in history and returns its deserialized value — in the HFC demo, `double` (deposit amount in dollars).

**Q4: Why can't you use `DateTime.UtcNow` in an orchestrator? What do you use instead?**

`DateTime.UtcNow` returns the real wall-clock time, which changes between the original execution and any replay. The orchestrator must produce identical branching on every replay. `context.CurrentUtcDateTime` returns the timestamp recorded in the orchestration history for the current step — it is the same value on every replay of that step.

**Q5: Durable Functions vs a background hosted service — when does the hosted service lose?**

A hosted service (`IHostedService`, `BackgroundService`) keeps workflow state in process memory. It is destroyed when: the process is restarted (deploy, crash, scale-in, idle timeout on Consumption). Long `Task.Delay` calls do not survive. You'd need external storage, distributed locks, and crash-recovery logic — essentially re-implementing what Durable provides. Durable Functions is the right tool for any workflow that spans more than a single request lifetime or must survive infrastructure events.

**Q6: How does a Durable orchestration survive a deploy?**

It doesn't need to restart from scratch. All state (step history, timer records, pending event subscriptions) lives in Azure Storage. After the new code is deployed, the next time a worker picks up a checkpoint message, it replays the new orchestrator code against the old history. This is why backward-compatible orchestrator changes are critical during rolling deploys: old history + new code must produce the same step sequence up to the current position.

**Q7: What is fan-out/fan-in and how do you implement it?**

Fan-out: schedule multiple activities concurrently, each representing a unit of parallel work.

```csharp
var tasks = items.Select(item =>
    context.CallActivityAsync<Result>(nameof(ProcessItem), item)).ToList();
var results = await Task.WhenAll(tasks);
```

The Durable runtime dispatches each activity to an available worker (possibly on different instances). Fan-in: `Task.WhenAll` resumes the orchestrator only after all activities complete. This is the primary way to parallelize work without managing threads.

**Q8: What is an eternal orchestration and when do you use it?**

An orchestration that calls `context.ContinueAsNew(newInput)` instead of returning. This atomically restarts the orchestrator with a fresh, empty history — preventing the event log from growing unboundedly over thousands of loop iterations. Use it for monitoring loops ("check this external API every hour"), nightly processing jobs, or any workflow that must run indefinitely without accumulating history.

**Q9: How do you guarantee at-least-once activity execution, and why must activities be idempotent?**

The Durable framework delivers activity work items via Azure Storage queues with a visibility timeout. If the worker crashes before acknowledging completion, the message becomes visible again and is redelivered to another worker. This guarantees the activity runs at least once but not exactly once. Therefore activities must be written to tolerate duplicate execution: upsert instead of insert, use idempotency keys on outbound HTTP calls, make email sends conditional on a "not-already-sent" flag, etc.

**Q10: What does `CreateCheckStatusResponse` give you and why use it instead of hand-building URLs?**

It returns an HTTP 202 with a JSON body containing pre-signed management URIs (`StatusQueryGetUri`, `SendEventPostUri`, `TerminatePostUri`, `PurgeHistoryDeleteUri`). Each URI is fully qualified — including the correct system-key `code` query parameter that authenticates management endpoint calls. Hand-building `/runtime/webhooks/durabletask/...` URLs without the correct `code` returns 401. Using `CreateCheckStatusResponse` also decouples your client from the internal URI structure, which can change across Durable versions.
