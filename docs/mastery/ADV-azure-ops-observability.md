# ADV — Azure Operations, Observability & Scaling

> Mastery doc for the HFC Senior Full Stack Cloud Developer interview.
> Anchor files: `infra/main.bicep`, `infra/deploy.sh`, `.github/workflows/keep-warm.yml`, `.github/workflows/post-deploy-e2e.yml`, `.github/workflows/ci.yml`, `api/Program.cs`.
> Cross-links: [[M9-cicd-prod]] (the gates that decide what ships), [[M8-azure-durable]] (the Azure topology this runs on).
> **File:line citations are exact — quote them, don't paraphrase numbers.** Every claim is tagged **[DEMO-PROVEN]** (in the repo right now) or **[PROD-GUIDANCE]** (what you'd add for HFC at scale, not in the demo).

---

## 0. The honesty line up front (read this first)

Two things in this topic are easy to over-claim in an interview. State them straight:

1. **The demo wires Application Insights but does not build dashboards, alerts, autoscale, or deployment slots.** The Bicep provisions Log Analytics + App Insights and injects the connection string into both the API and the Function App. That is real infrastructure-as-code. Everything past "the telemetry pipe exists" (KQL queries, alert rules, action groups, autoscale rules, slot swaps) is **[PROD-GUIDANCE]** — I can design and defend it, but it is not running in the repo.

2. **The `/health` gate is not a real health check.** The deploy script polls `GET /health` and treats 200 as "alive" (`infra/deploy.sh:98-111`). But there is **no `/health` route in the API** — `grep -rn '"/health"' api/` returns nothing, and there is no `AddHealthChecks()`/`MapHealthChecks()` anywhere. `/health` returns 200 because of the SPA catch-all `app.MapFallbackToFile("index.html")` (`api/Program.cs:100`). So the gate actually proves *"the container booted and ASP.NET Core is serving static files"* — a **liveness** signal, not a **readiness** signal. It does **not** prove the DB seeded or the read model built. Saying this out loud is the senior move; pretending `/health` is a deep probe is the junior one.

If you internalize those two, the rest is upside.

---

## 1. Mental model

Observability is **three signals + one through-line**:

| Signal | Question it answers | Azure home | Demo status |
|--------|--------------------|------------|-------------|
| **Metrics** | "Is it healthy *in aggregate*?" (p95 latency, RPS, CPU, error rate) | App Insights metrics / Live Metrics | telemetry flows; no dashboards |
| **Logs** | "What exactly happened on *this* request?" | Log Analytics (KQL) | workspace provisioned, 30-day retention |
| **Traces** | "How did one request fan out across API → Function → SQL?" | App Insights distributed tracing | auto-collected once the SDK is added |
| **Through-line** | "Tie all three to *one* request / *one* tenant" | **correlation ID** (`operation_Id`) + a tenant dimension | the seam exists (`TenantContext`); not yet emitted as a telemetry property |

The senior framing: **metrics tell you something is wrong, traces tell you where, logs tell you why.** Correlation ID is what lets you pivot from a metric spike to the exact failing trace to the exact log line — without it, a distributed bug is un-debuggable (failure mode in §11).

The **operational** side adds three more concerns: keep it warm (cold start), scale it out (autoscale), and ship it without dropping a franchisee mid-booking (deployment slots). The demo solves cold-start the cheap way and *documents* the production way — that contrast is the whole interview.

---

## 2. Application Insights — what the demo actually wires [DEMO-PROVEN]

The observability backbone is provisioned in Bicep. Log Analytics first, then App Insights pointed at it (workspace-based mode, the current default):

```bicep
// infra/main.bicep:60-77
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id      // workspace-based AI — logs land in Log Analytics
  }
}
```

The connection string is injected into **both** compute resources — API and Function App — so a single App Insights resource correlates the whole `booking → orchestration` flow:

```bicep
// infra/main.bicep:103 (API)
{ name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
// infra/main.bicep:159 (Function App)
{ name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
```

Why one App Insights for both: the deposit saga starts in the API and runs in a Durable Function ([[M8-azure-durable]]). With a shared App Insights, the `operation_Id` propagates across the HTTP → durable boundary and you get **one end-to-end distributed trace** instead of two disconnected ones.

### What App Insights auto-collects (once the SDK is registered)

The connection string alone makes the App Service's built-in agent collect *some* telemetry, but the rich, in-process telemetry needs the SDK. **[PROD-GUIDANCE]** — the demo's `Program.cs` does **not** call `AddApplicationInsightsTelemetry()` (verified: no `ApplicationInsights` reference in any `.cs`). To get the full picture you'd add:

```csharp
// Program.cs — NOT in the demo; this is what you'd add
builder.Services.AddApplicationInsightsTelemetry();   // request + dependency + exception auto-collection
```

That single line auto-collects, with zero per-call code:
- **Request telemetry** — every HTTP request: URL, status, duration, success/fail.
- **Dependency telemetry** — outbound calls (SQL via EF, HttpClient to Stripe/Twilio, Service Bus) with timing — this is how you catch "the API is slow because *SQL* is slow."
- **Exception telemetry** — unhandled exceptions with stack traces, auto-linked to the request that threw them.
- **Distributed tracing** — W3C `traceparent` propagation across API → Function → SQL.

### Live Metrics [PROD-GUIDANCE]

Live Metrics Stream is the sub-second, no-sampling view (incoming RPS, failures/sec, CPU, sampled live request/dependency/exception items) you watch *during a deploy or incident*. It's free, ephemeral (not retained), and enabled automatically with the SDK. Interview line: **"Live Metrics is for the deploy window; Log Analytics is for the post-mortem."**

---

## 3. Correlation IDs & distributed tracing — the HFC tie-in

A franchisee books a job. That one click becomes: `POST /api/appointments` → deposit intent → a Durable orchestration that waits, reminds, and confirms ([[M8-azure-durable]]). When the franchisee calls support saying "my booking vanished," you need to follow *that one booking* across all of it.

- **W3C correlation** ties it together: App Insights stamps each telemetry item with `operation_Id` (the trace) and `operation_ParentId` (the span). Because the API and Function share one App Insights (§2), the `operation_Id` survives the HTTP→durable hop and you get one waterfall.
- **The missing dimension is tenant.** The demo already resolves a verified tenant per request into `TenantContext` (`api/Program.cs:64-69`). To make observability *per-tenant* — which is what a multi-brand franchisor actually needs — you add a telemetry initializer that stamps `brand`/`franchisee_id` onto every item:

```csharp
// [PROD-GUIDANCE] — turns "errors" into "errors for brand X"
public class TenantTelemetryInitializer : ITelemetryInitializer {
    public void Initialize(ITelemetry t) {
        if (t is ISupportProperties p && _tenant.BrandSlug is { } b)
            p.Properties["brand"] = b;
    }
}
```

That one initializer is what makes the "errors by tenant" KQL in §4 possible. Without it, every error is anonymous and you can't tell a brand-wide outage from one noisy franchisee. **Tie-in:** per-tenant observability is a hard requirement for HFC because one brand's incident must not be diagnosed by sifting another brand's logs.

---

## 4. Log Analytics + KQL [PROD-GUIDANCE]

App Insights telemetry lands in the Log Analytics workspace (`infra/main.bicep:75`, `WorkspaceResourceId: logs.id`), retained **30 days** (`main.bicep:66`). KQL is how you interrogate it.

**Sample query — "errors by tenant" (last 24h):** (requires the §3 tenant initializer)

```kql
requests
| where timestamp > ago(24h)
| where success == false
| extend brand = tostring(customDimensions["brand"])
| summarize errors = count(),
            sampleTrace = any(operation_Id)
    by brand, name, resultCode
| sort by errors desc
```

Reading it: filter to failed requests in the window, pull the `brand` custom dimension, group by brand + endpoint + status, and carry one `operation_Id` per group so you can pivot straight to the failing distributed trace. Adjacent must-knows:

```kql
// p95 latency per endpoint — is anything slow?
requests
| where timestamp > ago(1h)
| summarize p95 = percentile(duration, 95), count() by name
| sort by p95 desc

// slow dependencies — is SQL or Stripe the bottleneck?
dependencies
| where timestamp > ago(1h)
| summarize p95 = percentile(duration, 95) by target, type
| sort by p95 desc

// exceptions joined to the request that threw them
exceptions
| where timestamp > ago(24h)
| join kind=inner (requests) on operation_Id
| project timestamp, problemId, name, operation_Id
```

Interview line: **"KQL is the difference between 'the site is slow' and 'budget-blinds checkout p95 is 4s because the deposit dependency to Stripe is timing out, here's the trace.'"**

---

## 5. Alerts & action groups [PROD-GUIDANCE]

An **alert rule** = signal + condition + window + frequency. An **action group** = who/what gets notified (email, SMS, webhook, Logic App, auto-runbook). They're decoupled so one action group ("on-call") serves many rules.

What I'd alert on for HFC, and why each:

| Alert | Signal | Condition (example) | Why |
|-------|--------|---------------------|-----|
| Availability | App Insights availability test on `/health` | < 100% over 5 min | the franchisee-facing app is down |
| Error rate | `requests \| failed` | > 5% over 5 min | regression or dependency outage |
| Latency | request p95 | > 2s over 10 min | UX degradation before it becomes an outage |
| Dependency failures | `dependencies \| failed` to Stripe/SQL | > N over 5 min | upstream is failing us |
| Saga stalls | custom metric: orchestrations stuck in "waiting deposit" | > threshold | [[M8-azure-durable]] back-pressure |

**Bicep sketch** (not in demo):

```bicep
// [PROD-GUIDANCE]
resource onCall 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'hfc-oncall'
  properties: {
    groupShortName: 'oncall'
    emailReceivers: [{ name: 'eng', emailAddress: 'oncall@hfc.example' }]
  }
}
resource errRate 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'api-error-rate'
  properties: {
    severity: 1
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    scopes: [ api.id ]
    criteria: { /* Http5xx > threshold */ }
    actions: [{ actionGroupId: onCall.id }]
  }
}
```

**Trade-off — alert fatigue (failure mode, §11):** too-tight thresholds page on every blip; on-call learns to ignore the pager; a real outage gets missed. Senior practice: alert on **symptoms users feel** (availability, error rate, latency), not every internal metric; use sustained windows (5–10 min, not 1 data point); set severities; and route low-sev to a digest, not the pager.

---

## 6. Autoscale [PROD-GUIDANCE]

The demo runs a **single instance** — `F1` Free by default, `B1` for Always On (`main.bicep:34`, `deploy.sh:22`). Neither autoscales (Free can't; Basic is fixed-count). Autoscale starts at **Standard (S1) and up**. The Function App is Consumption (`Y1` Dynamic, `main.bicep:137`) which *auto-scales by design* — Azure adds workers per queued message with no rule to write.

For the API on a scalable plan you'd add an `autoscalesettings` resource with rules:

```bicep
// [PROD-GUIDANCE] — App Service plan scale-out
// scale OUT when avg CPU > 70% for 10 min; scale IN when < 30%.
{
  metricTrigger: { metricName: 'CpuPercentage', timeAggregation: 'Average',
                   operator: 'GreaterThan', threshold: 70,
                   timeWindow: 'PT10M', metricResourceUri: plan.id }
  scaleAction: { direction: 'Increase', type: 'ChangeCount', value: '1', cooldown: 'PT10M' }
}
```

Key decisions to defend:
- **Scale-out (more instances) vs scale-up (bigger SKU):** out for stateless web traffic (the API is stateless — tenancy is per-request, §3); up only when a single request is resource-heavy.
- **CPU vs queue depth as the trigger:** for the API, CPU/request-count tracks franchisee booking load. For the *Functions*, the natural signal is **Service Bus queue length** — scale workers to drain the deposit/reminder backlog ([[M8-azure-durable]], [[M10-reliability-integrations]]). HFC is bursty (a brand's morning booking rush), so queue-depth scaling on the saga side is what keeps reminders timely.
- **Cooldowns** prevent flapping: scale out fast (1-min eval), scale in slow (longer window) so a brief dip doesn't drop capacity right before the next burst.
- **Bound it:** min/max instance counts cap the bill — autoscale without a max is a cost incident.

---

## 7. Deployment slots & swap [PROD-GUIDANCE — and what the demo does instead]

### What the demo does today: zip-deploy, in place [DEMO-PROVEN]

`deploy.sh` builds the SPA into the API's `wwwroot`, publishes, zips, and `az webapp deploy ... --type zip`s it onto the **live** site:

```bash
# infra/deploy.sh:87
az webapp deploy -g "$RG" -n "$API_NAME" --src-path "$ROOT/api/api.zip" --type zip -o none
```

This is **not zero-downtime.** The container recycles to pick up the new bits; during recycle the site is unavailable, and on Free/Basic that recycle pays the full cold-start (DB seed + read-model rebuild). Acceptable for a demo on one instance; **not** acceptable for franchisees mid-booking.

### What you'd do for HFC: slots + swap [PROD-GUIDANCE]

Deployment slots = parallel copies of the app on the same plan (e.g. `staging`). You deploy to `staging`, let it **warm up**, run smoke against it, then **swap** — Azure flips the routing so `staging` becomes `production` with no cold start, because the swap **warms the target before routing to it** (Azure hits `/health`-style warm-up paths until the app responds, then completes the VIP swap). Roll back = swap again.

```bash
# [PROD-GUIDANCE] — requires Standard+ (slots not available on Free/Basic-B1 single slot)
az webapp deploy -g "$RG" -n "$API_NAME" --slot staging --src-path api.zip --type zip
# warm + verify staging, then:
az webapp deployment slot swap -g "$RG" -n "$API_NAME" --slot staging --target-slot production
```

**Trade-off — slots vs blue/green:**
- **Slots** are blue/green *inside one App Service plan* — cheap, fast swap, instant rollback, **shared infra** (same plan/DB). Limitation: a bad DB migration is shared by both slots, so swap doesn't save you from a destructive schema change.
- **Full blue/green** (two independent environments behind a router/Front Door) isolates infra and lets you test migrations against a green DB — more cost, more ops, true isolation.
- For HFC's single-region App Service, **slots are the right default**; reach for full blue/green only when migrations get risky or you go multi-region.

**Warm-up** is the load-bearing word: the demo's slow boot (seed + rollup, §8) is exactly why a swap *with* warm-up matters — you never route franchisee traffic to a cold instance.

---

## 8. Cold start, Always On, and the container-timeout we hit [DEMO-PROVEN]

This is the demo's signature operational war story. Walk it end to end.

**The failure mode.** On `F1`/Free, App Service unloads the container after ~20 min idle. The next request pays the full spin-up — and the demo's spin-up is heavy: on boot it seeds the DB and rebuilds the corporate read model (`api/Program.cs:48-55`, `Seed.Run` + `Rollup.Recompute`). On Free that can exceed Azure's **default 230s container-start limit**, which trips a **crash-loop** — the platform kills the "stuck" container, restarts it, it starts seeding again, gets killed again. The first franchisee hit after idle sees a 503/timeout.

**Fix #1 — give boot enough headroom:**

```bicep
// infra/main.bicep:106-108
// Cold start + EF create/seed on F1 can exceed the default 230s container
// start limit and trip a crash-loop; give it generous headroom.
{ name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '900' }   // 15 min
```

**Fix #2 — don't persist the SQLite DB (avoid rebuild-on-boot crash):**

```bicep
// infra/main.bicep:111-115 — /tmp is wiped each start, so every boot reseeds a CLEAN db.
// This sidesteps the startup-rebuild crash seen against a PERSISTED (/home) SQLite db.
{ name: 'ConnectionStrings__Default', value: 'Data Source=/tmp/hfc-demo.db' }
```

**Fix #3 — the real fix is Always On, and the demo gates it correctly by tier:**

```bicep
// infra/main.bicep:40-57 — Azure REJECTS alwaysOn=true on Free/Shared, so gate on tier.
var apiAlwaysOn = apiPlanTier != 'Free' && apiPlanTier != 'Shared'
// ...
alwaysOn: apiAlwaysOn      // main.bicep:101
```

`deploy.sh` re-asserts it and **warns loudly** when it can't (instead of failing silently):

```bash
# infra/deploy.sh:62-69
Free|Shared|"")
  echo "⚠️  ... Always On is NOT available below Basic."
  echo "    => the app cold-starts after ~20min idle; the first hit can 503/timeout."
  echo "    Kill cold starts by redeploying on Basic+:   SKU=B1 ./infra/deploy.sh" ;;
*)
  az webapp config set -g "$RG" -n "$API_NAME" --always-on true -o none ;;
```

**Fix #4 — the $0 stopgap when you can't pay for Basic:** a cron pings `/health` every 10 min to keep the Free container resident:

```yaml
# .github/workflows/keep-warm.yml:14-15
schedule:
  - cron: '*/10 * * * *'   # every 10 minutes
```

The senior summary: **"Always On is the fix; the keep-warm cron is the free-tier hack; the timeout bump + ephemeral /tmp DB are what stop the cold start from crash-looping while we're on Free."** This shows you understand *why* Always On exists, not just that a checkbox exists.

---

## 9. Health checks — liveness vs readiness, and the deploy gate [DEMO-PROVEN, with the caveat from §0]

**Concepts:**
- **Liveness** — "is the process up?" If it fails, **restart** the container.
- **Readiness** — "is it able to serve traffic *right now*?" (DB reachable, migrations applied, read model built). If it fails, **stop routing** to it but don't kill it.

**What the demo's gate actually does.** After deploy, `deploy.sh` polls `/health` up to 60×10s and refuses to declare success until it's 200:

```bash
# infra/deploy.sh:98-110
for i in $(seq 1 60); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${API_HOST}/health" || echo 000)
  if [ "$code" = "200" ]; then HEALTHY=1; break; fi
  sleep 10
done
if [ "$HEALTHY" -ne 1 ]; then echo "❌ Deploy FAILED the health gate..." >&2; exit 1; fi
```

The post-deploy E2E workflow gates the same way before driving the live app (`post-deploy-e2e.yml:37-43`), and the keep-warm cron uses the same `/health` (`keep-warm.yml:34-46`). So `/health` is the **single operational liveness signal** across deploy, warm, and e2e — that part is real and well-factored.

**The caveat (say it):** there is no `/health` *route* and no `AddHealthChecks()` in the code. `/health` is 200 only because of the SPA fallback `app.MapFallbackToFile("index.html")` (`api/Program.cs:100`). So the gate proves **liveness** (container boots, static files serve) but **not readiness** (it does not check that `Seed.Run`/`Rollup.Recompute` succeeded or that the DB is reachable).

**The prod upgrade [PROD-GUIDANCE]** — make it a real readiness probe:

```csharp
// Program.cs — what you'd add for HFC
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDb>("db")                     // readiness: DB reachable + model built
    .AddCheck("rollup", () => Rollup.IsBuilt ? Healthy() : Unhealthy());
app.MapHealthChecks("/health/live",  new(){ Predicate = _ => false });        // liveness: process up
app.MapHealthChecks("/health/ready", new(){ Predicate = c => c.Tags.Contains("ready") }); // readiness
```

Then point App Service **Health Check** (a platform feature: it pings a path and pulls failing instances out of the load-balancer rotation) and the deploy gate at `/health/ready`, and Always On / keep-warm at the lightweight `/health/live`. This is also exactly the warm-up path a slot swap (§7) should hit before routing traffic.

---

## 10. Cost management & right-sizing [DEMO-PROVEN intent + PROD-GUIDANCE]

The demo is **cost-led by default** — every choice picks the cheapest viable tier and documents the cost cliff:

```bicep
// infra/main.bicep:12-14
// Cost note: defaults aim at the free/cheapest tiers (F1 plan, Consumption
// Functions, serverless SQL that auto-pauses). Azure SQL is NOT free forever ...
```

Demo-proven cost levers:
- **F1 Free plan** by default; pay for B1 only to buy Always On (`main.bicep:34`).
- **Consumption Functions** (`Y1` Dynamic, `main.bicep:137`) — scale-to-zero, pay per execution.
- **Serverless SQL that auto-pauses** after 1h idle, min 0.5 vCore (`main.bicep:187-188`) — `autoPauseDelay: 60`, `minCapacity: 0.5`.
- **30-day log retention** (`main.bicep:66`) — not 90/730; you pay per GB ingested + retained.
- **CI thrift:** `concurrency: cancel-in-progress` kills superseded runs to save minutes (`ci.yml:13-15`).

Right-sizing decisions to defend:
- **Sampling vs full telemetry (the big observability cost trade-off):** App Insights bills per GB ingested. Full telemetry on a busy multi-brand app gets expensive fast. **Adaptive sampling** (default in the SDK) keeps a statistically representative subset and preserves aggregates — cheaper, but you may not have the *exact* trace for a rare bug. Mitigation: sample requests/dependencies, but **never sample exceptions**, and use **ingestion sampling caps** as the hard budget. Interview line: *"Sample the happy path, keep every failure."*
- **Auto-pause SQL** trades a cold first-query (resume latency) for near-zero idle cost — fine for HFC dev/low-traffic territories, not for a hot region (turn it off there).
- **Autoscale max count** (§6) is a cost guardrail, not just a capacity one.
- **Reserved instances / savings plans** for steady-state prod compute once load is predictable.

---

## 11. Failure modes (name them before they name you)

| Failure | Symptom | Root cause | Fix (demo / prod) |
|---------|---------|-----------|-------------------|
| **Cold-start crash-loop** | first hit after idle 503s/times out; container restarts repeatedly | F1 has no Always On; boot seed+rollup > 230s limit | `WEBSITES_CONTAINER_START_TIME_LIMIT=900` + `/tmp` DB (demo); **Always On** on B1+ (prod); keep-warm cron ($0 stopgap) |
| **Un-debuggable distributed bug** | "booking vanished," can't trace it across API→Function | no shared App Insights / no correlation ID propagation | shared App Insights both tiers (demo Bicep); `operation_Id` + tenant initializer (prod) |
| **Anonymous errors** | can't tell brand-wide outage from one noisy franchisee | no tenant dimension on telemetry | `TenantTelemetryInitializer` → "errors by tenant" KQL (§4) |
| **Alert fatigue** | on-call ignores the pager; real outage missed | thresholds too tight, single-datapoint, no severity | symptom-based alerts, sustained windows, severities, digest routing (§5) |
| **In-place deploy outage** | franchisees hit downtime/cold-start on every ship | zip-deploy recycles the live container | deployment slots + warm-up + swap (§7) |
| **Telemetry cost blowout** | App Insights bill spikes | full, unsampled ingestion | adaptive sampling + ingestion cap; never sample exceptions (§10) |
| **False-green deploy gate** | gate passes but app can't serve data | `/health` only proves static-file serving, not readiness | real `AddHealthChecks().AddDbContextCheck` at `/health/ready` (§9) |

---

## 12. Interview defense — follow-ups & answers

**Q: Your deploy gate checks `/health` and passes. How do you know the app actually works?**
A: I don't, fully — and I'd say so. `/health` returns 200 via the SPA fallback (`Program.cs:100`); there's no health route, so it proves liveness (container boots, static files serve), not readiness. That's why the deploy *also* dispatches `post-deploy-e2e` against the live URL (`deploy.sh:114-124`) which drives real browser flows and the API smoke suite — *that's* my readiness proof today. For prod I'd add `AddHealthChecks().AddDbContextCheck` at `/health/ready` and point the gate there so the gate itself is honest.

**Q: A franchisee says a booking disappeared. Walk me through finding it.**
A: Pivot metric → trace → log. In App Insights I'd start from the failed `requests` for that endpoint/time, grab the `operation_Id`, and view the end-to-end transaction — because the API and Function share one App Insights (`main.bicep:103,159`), I see the HTTP call *and* the durable orchestration in one waterfall. The exception (auto-linked by `operation_Id`) gives the stack and the line. If I'd added the tenant initializer, I'd filter straight to that brand with the §4 "errors by tenant" KQL instead of scanning everyone's traffic.

**Q: You deploy in-place with zip. How would you make franchisee-facing deploys zero-downtime?**
A: Deployment slots. Deploy to `staging`, warm it (Azure hits a warm-up path until it responds), smoke it, then swap — the swap warms the target *before* routing, so production never sees a cold instance. Rollback is just swapping back. I'd reach for full blue/green only when a DB migration is risky, since slots share the database. The demo's slow boot (seed + rollup) is exactly why warm-up-before-swap matters here.

**Q: This is multi-brand. How do you keep one brand's incident from contaminating another's diagnosis?**
A: A telemetry initializer that stamps the verified tenant (`brand`/`franchisee_id`, already resolved into `TenantContext` at `Program.cs:64-69`) onto every telemetry item. Then every KQL query and alert can filter or group by brand — "errors by tenant," per-brand availability alerts, per-brand latency. Without that dimension errors are anonymous and you can't distinguish a platform outage from one noisy franchisee.

**Q: App Insights is getting expensive. What do you cut?**
A: Adaptive sampling on the happy path — keep a representative subset of requests/dependencies, which preserves aggregates — but **never sample exceptions**, and set an ingestion cap as the hard budget. I'd also trim Log Analytics retention to what compliance requires (demo uses 30 days, `main.bicep:66`) and move rarely-queried data to cheaper archive tiers. The rule is "sample the happy path, keep every failure."

---

## 13. Demo proof (commands that show it's real)

```bash
# Telemetry IaC: Log Analytics + App Insights + connection string in both tiers
grep -nE 'OperationalInsights|Insights/components|APPLICATIONINSIGHTS_CONNECTION_STRING' infra/main.bicep
# -> 60, 69, 103, 159

# Always-On tier gating (the real cold-start fix)
sed -n '40,57p;101p' infra/main.bicep

# Cold-start headroom + ephemeral /tmp DB (the crash-loop fixes)
sed -n '106,115p' infra/main.bicep

# The deploy health gate
sed -n '98,111p' infra/deploy.sh

# $0 keep-warm cron
sed -n '14,15p;34,46p' .github/workflows/keep-warm.yml

# PROVE the caveat: there is NO /health route and NO health-check middleware
grep -rn '"/health"' api/ ; grep -rni 'AddHealthChecks\|MapHealthChecks' api/   # both empty
grep -n 'MapFallbackToFile' api/Program.cs                                       # -> 100 (why /health is 200)
```

---

## Flashcards

1. **Q:** Which Azure observability resources does the demo's Bicep actually create? **A:** A Log Analytics workspace (`main.bicep:60`, 30-day retention) and a workspace-based App Insights component (`main.bicep:69`); the connection string is injected into both the API (`:103`) and Function App (`:159`).

2. **Q:** Why one App Insights for both API and Functions? **A:** So `operation_Id` propagates across the HTTP→durable hop and you get one end-to-end distributed trace instead of two disconnected ones.

3. **Q:** What does the demo's `/health` deploy gate actually prove? **A:** Liveness only — the container booted and ASP.NET serves static files. There's no `/health` route; it's 200 via `MapFallbackToFile("index.html")` (`Program.cs:100`). It does NOT prove readiness (DB/seed/rollup).

4. **Q:** Liveness vs readiness? **A:** Liveness = "process up?" → fail ⇒ restart. Readiness = "can serve traffic now?" (DB, migrations, read model) → fail ⇒ stop routing, don't kill.

5. **Q:** Root cause of the cold-start crash-loop we hit? **A:** F1/Free unloads after ~20min; boot seed+rollup exceeds Azure's default 230s container-start limit ⇒ platform kills+restarts repeatedly.

6. **Q:** The three demo cold-start mitigations and the real fix? **A:** Mitigations: `WEBSITES_CONTAINER_START_TIME_LIMIT=900` (`:108`), ephemeral `/tmp` SQLite (`:115`), keep-warm cron every 10 min. Real fix: **Always On** (B1+, `apiAlwaysOn`, `:57/:101`).

7. **Q:** Why is `alwaysOn` gated on tier in Bicep? **A:** Azure rejects `alwaysOn=true` on Free/Shared, so `apiAlwaysOn = tier != Free && tier != Shared` (`main.bicep:57`) prevents a deploy failure.

8. **Q:** The metric→trace→log pivot, in one line? **A:** Metrics say *something's* wrong, traces say *where*, logs say *why* — correlation ID (`operation_Id`) is the through-line that joins them.

9. **Q:** What makes "errors by tenant" possible, and what's missing in the demo? **A:** A telemetry initializer stamping the verified tenant (from `TenantContext`, `Program.cs:64`) onto every item. The demo has the tenant seam but doesn't yet emit it as a telemetry dimension.

10. **Q:** Slots+swap vs full blue/green? **A:** Slots = blue/green inside one plan: cheap, instant swap+rollback, but shared DB. Full blue/green = two isolated environments behind a router: more cost, but you can test migrations on a green DB.

11. **Q:** Why "warm-up" is the load-bearing word in a swap? **A:** Azure warms the target slot (hits a warm-up path until it responds) *before* completing the VIP swap, so production never routes to a cold instance — critical given the demo's slow boot.

12. **Q:** The App Insights cost trade-off and its rule? **A:** Adaptive sampling keeps aggregates cheap but may drop the exact rare trace. Rule: **sample the happy path, keep every failure** (never sample exceptions); cap ingestion as the hard budget.

---

## Mock Q&A

**1. "Design observability for HFC's booking flow end to end."**
Provision one workspace-based App Insights and wire its connection string into every compute tier (demo does this for API + Functions, `main.bicep:103,159`) so traces correlate across the HTTP→durable saga. Add `AddApplicationInsightsTelemetry()` for auto request/dependency/exception collection, plus a `TenantTelemetryInitializer` so every item carries `brand`. Log Analytics + KQL for post-mortems, Live Metrics for the deploy window, symptom-based alerts → an on-call action group.
*Follow-up: "How do you find one bad booking?"* → metric→trace→log via shared `operation_Id`; filter by tenant dimension.
*Follow-up: "What's not in the demo?"* → the SDK call, the initializer, dashboards, alerts — all prod-guidance; the demo only wires the pipe.

**2. "Make these deploys zero-downtime."**
Today it's in-place zip (`deploy.sh:87`) which recycles the live container. Move to deployment slots: deploy to `staging`, warm + smoke it, then `az webapp deployment slot swap`. Swap warms the target before routing; rollback = swap back. Needs Standard+. The demo's slow boot is precisely why warm-up-before-swap matters.
*Follow-up: "When blue/green instead?"* → when a migration is destructive — slots share the DB.
*Follow-up: "How do you verify staging before swap?"* → point `post-deploy-e2e.yml` at the staging hostname; it already gates on `/health` then drives real flows.

**3. "How would you autoscale this?"**
API is stateless (per-request tenancy), so scale **out** not up: an `autoscalesettings` rule, CPU > 70% over 10 min ⇒ +1, < 30% ⇒ -1, with min/max bounds and asymmetric cooldowns (out fast, in slow) to avoid flapping before the next burst. Functions already auto-scale (Consumption); for the saga side scale on **Service Bus queue depth**. Requires S1+ (demo is single-instance F1/B1).
*Follow-up: "CPU or queue?"* → CPU for the web API's booking load; queue depth for draining the reminder/deposit backlog.
*Follow-up: "What caps the bill?"* → max instance count + the autoscale-in rule.

**4. "Your `/health` gate passed but users see errors. Explain."**
`/health` is 200 via the SPA fallback (`Program.cs:100`) — liveness, not readiness. It never checks the DB or that `Seed`/`Rollup` succeeded (`Program.cs:48-55`). So a boot where static files serve but the read model failed would still pass. Fix: `AddHealthChecks().AddDbContextCheck<AppDb>()` at `/health/ready`, point the gate there, keep a light `/health/live` for Always On/keep-warm. Meanwhile the demo's real readiness proof is the post-deploy E2E suite, not the gate.
*Follow-up: "Why split live vs ready?"* → readiness pulls an instance from rotation without killing it; liveness triggers a restart. Different remediations.

**5. "App Insights is blowing the budget — cut it without going blind."**
Enable adaptive sampling on requests/dependencies (preserves aggregates), but exclude exceptions from sampling, and set an ingestion daily cap as the hard ceiling. Trim Log Analytics retention to the compliance minimum (demo: 30 days, `main.bicep:66`); archive cold data to a cheaper tier. Keep Live Metrics (free, unsampled) for incidents.
*Follow-up: "Risk of sampling?"* → you might lack the exact trace for a rare bug — accepted for the happy path, never for failures.
*Follow-up: "Other idle costs?"* → serverless SQL auto-pause (`main.bicep:187`) and Consumption Functions scale-to-zero already minimize idle spend.
