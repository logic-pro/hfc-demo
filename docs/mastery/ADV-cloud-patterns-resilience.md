# ADV — Cloud-Native Patterns & Resilience

> **Scope:** the cross-cutting cloud-engineering layer that sits *over* every other
> module — config & process discipline (12-factor), resilience (Polly), idempotency
> at scale, caching, secrets, tracing, scaling/cost, and the OWASP risks that matter
> for a multi-tenant API. Where the hfc-demo *proves* a pattern, it is cited at
> `file:line`. Where a pattern is standard cloud knowledge the role expects but the
> demo does not (yet) implement, it is **labelled `[role-knowledge]`** so nothing here
> is undefendable bluffing.
>
> Cross-links: [[M10-reliability-integrations]] (concurrency + idempotency deep dive),
> [[M1-multitenancy]] (the tenant boundary that defends IDOR).

---

## 1. Mental model — the resilience/cloud layer in one frame

A cloud app is a set of **stateless processes** that **fail partially and constantly**.
Every cross-cutting pattern here exists to answer one of four questions:

| Question | Pattern family | Demo anchor |
|---|---|---|
| How do I configure & restart a process anywhere? | **12-factor** (config in env, stateless) | `infra/main.bicep:102-116` appSettings |
| What happens when a *dependency* is slow or down? | **Resilience** (retry/jitter, breaker, timeout, bulkhead, fallback) | `[role-knowledge]` — Polly is the next layer over [[M10-reliability-integrations]] |
| What happens when *my own* request is retried? | **Idempotency** | `BookingEndpoints.cs:74-97` deposit + optimistic concurrency `:35-72` |
| How do I serve scale/cost without melting the DB? | **Caching + read model** | `Program.cs:54` `Rollup.Recompute` materialized read model |
| Who can see whose data, and is the secret safe? | **Security** (IDOR, headers, validation, secrets) | EF query filter `AppDb.cs:46-55`; managed identity `main.bicep:91` |

The senior signal is **knowing the trade-off and the failure mode of each**, not
just naming the pattern. That is the structure of every section below.

---

## 2. The 12-factor app — config in env, stateless processes

**Mental model.** The same build artifact runs in dev, CI, and prod; only the
*environment* differs. Config that varies between deploys (connection strings,
keys, feature flags) lives in the environment, never in the bundle. Processes are
**stateless and disposable** — any instance can serve any request, and killing one
loses nothing.

**Demo proof — config via env (factor III).** The API reads its connection string
from configuration, with a code default only for zero-setup local runs:

```csharp
// api/Program.cs:8-11
var conn = builder.Configuration.GetConnectionString("Default")
           ?? "Data Source=hfc-demo.db";
```

In Azure that value is injected as an **app setting** — there is no DB string baked
into the image:

```bicep
// infra/main.bicep:113-115 — same artifact, env decides SQL vs SQLite
{ name: 'ConnectionStrings__Default', value: deploySql
    ? 'Server=tcp:...;Authentication=Active Directory Default;Encrypt=True;'
    : 'Data Source=/tmp/hfc-demo.db' }
```

`ConnectionStrings__Default` (double-underscore) is the .NET convention that maps an
env var onto the `ConnectionStrings:Default` config key — so the *same* `GetConnectionString("Default")`
line resolves it. `ASPNETCORE_ENVIRONMENT` (`main.bicep:105`) is the other classic
env-driven knob: it flips dev-login on, dev exception pages on, etc.

**Demo proof — disposable / stateless processes (factor VI, IX).** The SQLite path
deliberately points at `/tmp`, which Azure wipes on every container start:

```
// infra/main.bicep:110-112 (comment)
// an EPHEMERAL file under /tmp. /tmp is wiped on each container start, so every
// boot reseeds a clean DB
```

That is the *opposite* of session state on disk — the process carries nothing
between boots; truth lives in the DB (or, in prod, Azure SQL). The seed/rollup is
**idempotent on startup** (`Program.cs:50-56`) precisely so a fresh process can
rebuild deterministically.

**HFC tie-in.** Statelessness is what lets HFC scale-out (§7): if the API kept a
tenant's session in memory, you could not put a load balancer in front of N
instances. Because the tenant is re-derived from the **verified token claim every
request** (see [[M1-multitenancy]]), any instance handles any tenant.

**Trade-off / failure mode.** Config-in-env is great until a secret leaks into a
log or a `.env` committed to git (§6). The mitigation is factor-III done properly:
secrets come from **Key Vault via managed identity**, not from a checked-in file (§6).

**Interview defense.**
- *"Where does config live in your app?"* → "Env-injected app settings; code reads
  `IConfiguration`. `main.bicep:102-116` is the source of truth for prod settings,
  and the connection string is one of them — the artifact is config-free."
- *"Is your API stateless?"* → "Yes — tenant is re-resolved from the JWT claim each
  request (`Program.cs:62-69`), nothing tenant-specific is held in memory, so I can
  scale-out behind a load balancer with no sticky sessions."

---

## 3. Resilience with Polly — the dependency-failure toolkit

> **`[role-knowledge]`** — the demo's deposit is currently a stub (no live Stripe;
> see [[M10-reliability-integrations]] §5.1), so Polly is not wired *yet*. This is
> the exact code I would add when integrating Stripe/Twilio/SendGrid. The pattern
> is standard `Microsoft.Extensions.Http.Resilience` / Polly v8 idiom.

**Mental model.** A remote call can **fail transiently** (retry it), **fail
persistently** (stop hammering it — open a breaker), **hang** (time it out), or
**saturate you** (bulkhead-isolate it). Polly composes these as a *resilience
pipeline* wrapped around `HttpClient` via `IHttpClientFactory`, so the policy is
declarative and lives next to DI, not scattered through call sites.

### Idiomatic Polly v8 (`AddResilienceHandler`)

```csharp
// [role-knowledge] Program.cs — typed client for Stripe with a full pipeline
builder.Services.AddHttpClient<StripeClient>(c =>
{
    c.BaseAddress = new Uri("https://api.stripe.com");
})
.AddResilienceHandler("stripe", b =>
{
    // 1) TIMEOUT (inner, per-try) — never let one call hang a thread.
    b.AddTimeout(TimeSpan.FromSeconds(5));

    // 2) RETRY with exponential backoff + JITTER — survive blips without a storm.
    b.AddRetry(new HttpRetryStrategyOptions
    {
        MaxRetryAttempts = 3,
        BackoffType      = DelayBackoffType.Exponential,
        UseJitter        = true,                       // de-correlate clients
        Delay            = TimeSpan.FromMilliseconds(200),
        // Only retry what's safe: transient 5xx/408/timeout. Crucially, the
        // deposit call carries an Idempotency-Key, so a retry is safe (§4).
        ShouldHandle = args => ValueTask.FromResult(
            args.Outcome.Result is { StatusCode: >= System.Net.HttpStatusCode.InternalServerError }
            || args.Outcome.Exception is HttpRequestException or TimeoutRejectedException)
    });

    // 3) CIRCUIT BREAKER — after sustained failure, fail fast for a cooldown so a
    //    dying dependency isn't drowned in retries (and we shed load instantly).
    b.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
    {
        FailureRatio     = 0.5,                  // 50% of calls failing...
        MinimumThroughput = 10,                  // ...over >=10 calls in...
        SamplingDuration = TimeSpan.FromSeconds(30),
        BreakDuration    = TimeSpan.FromSeconds(15)
    });

    // 4) TOTAL TIMEOUT (outer) — bound the whole retry sequence end-to-end.
    b.AddTimeout(TimeSpan.FromSeconds(20));
});
```

**Bulkhead & fallback** (the two people forget):

```csharp
// BULKHEAD — cap concurrent Stripe calls so a Stripe slowdown can't starve the
// thread pool that also serves bookings. (Polly v8: concurrency limiter.)
b.AddConcurrencyLimiter(permitLimit: 20, queueLimit: 10);

// FALLBACK — when the breaker is open, degrade gracefully instead of 500-ing.
b.AddFallback(new FallbackStrategyOptions<HttpResponseMessage>
{
    ShouldHandle = new PredicateBuilder<HttpResponseMessage>()
        .Handle<BrokenCircuitException>(),
    FallbackAction = _ => Outcome.FromResultAsValueTask(
        new HttpResponseMessage(HttpStatusCode.Accepted)) // queue for later, ack now
});
```

### Order matters (outer → inner)

`Fallback → Total-Timeout → Retry → Circuit-Breaker → Per-try-Timeout → call`.
Retry must be *outside* the per-try timeout (so each attempt is bounded) but the
breaker sits *inside* retry so the breaker counts each attempt. The total timeout
caps the whole thing so a 3× retry can't exceed your own request SLA.

**Trade-off — retry vs circuit-breaker.** They are *complementary opposites*. Retry
assumes the failure is **transient and isolated** → try again. The breaker assumes
the failure is **systemic** → stop trying. Retry *alone* against a down dependency
is harmful (it amplifies load); the breaker is what makes aggressive retry safe by
cutting it off once failures correlate. **You need both**, composed.

**Failure mode — the retry storm.** Retry *without* backoff+jitter is the classic
self-inflicted outage: the dependency hiccups, every client retries simultaneously,
the synchronized wave of retries keeps it down (a "thundering herd"). `UseJitter =
true` de-correlates clients; exponential backoff spreads them in time; the breaker
caps total volume. Also: **only retry idempotent operations** — a non-idempotent
POST retried 3× can triple-charge. That is exactly why the deposit carries an
Idempotency-Key (§4) — it makes the retry safe.

**HFC tie-in.** HFC's roadmap is Stripe deposits + Twilio/SendGrid reminders via
Durable Functions ([[M10-reliability-integrations]] §5). Those are *exactly* the
calls that need this: a payment API and an SMS API both have transient blips and
rate limits. Durable Functions' built-in `RetryOptions` covers the orchestration
layer; Polly covers any direct `HttpClient` call.

**Interview defense.**
- *"Retry or circuit breaker — which?"* → "Both, composed. Retry handles transient
  blips; the breaker stops the retry from becoming a DoS when the failure is
  systemic. The breaker is what makes retry safe."
- *"How do you avoid a retry storm?"* → "Exponential backoff with jitter to
  de-correlate clients, a max-attempt cap, a breaker to bound total volume, and
  retry *only* idempotent ops — our deposit's Idempotency-Key is what makes the
  retry safe to begin with."
- *"Where would this live?"* → "On the typed `HttpClient` via
  `AddResilienceHandler` in DI, so the policy is declarative and one place, not
  copy-pasted at every call site."

---

## 4. Idempotency at scale

**Mental model.** On an unreliable network, the client *cannot tell* a lost response
from a lost request — so it retries. An idempotent endpoint guarantees that **N
identical requests have the same effect as one**. There are two flavours in the
demo, both proven.

### 4a. Request idempotency — the deposit (`BookingEndpoints.cs:74-97`)

```csharp
// BookingEndpoints.cs:79-90
if (!http.Headers.TryGetValue("Idempotency-Key", out var key) || string.IsNullOrWhiteSpace(key))
    return Results.Problem(statusCode: 400, title: "Missing Idempotency-Key header.");

var appt = await db.Appointments.FirstOrDefaultAsync(a => a.Id == id);
if (appt is null) return Results.NotFound();   // not found OR not this tenant's

if (appt.DepositKey is not null)               // already paid
    // Same key => safe retry; different key => the deposit is already settled.
    return Results.Ok(/* the already-applied result */);
```

The stored `DepositKey` is the dedupe record: the first call writes it; any replay
**reads back the settled result** instead of charging again. The header is
*required* (`:79-80`) — no key, no charge. (See [[M10-reliability-integrations]] §3
for the natural-key-vs-idempotency-key trade-off.)

### 4b. Optimistic concurrency — the *other* anti-double class (`BookingEndpoints.cs:35-72`)

Idempotency dedupes *the same* request; optimistic concurrency arbitrates *two
different* racing requests for the same slot. `Slot.Version` is a concurrency token
(`AppDb.cs:58`); the loser of a race gets a `DbUpdateConcurrencyException` →
**409** (`BookingEndpoints.cs:61-64`). Together they cover both "retry" and "race".

### 4c. Webhook idempotency `[role-knowledge]`

When Stripe/Twilio call *us* back, the same rules apply in reverse — **webhooks are
delivered at-least-once**, so the handler must be idempotent:

```csharp
// [role-knowledge] webhook handler sketch
var eventId = stripeEvent.Id;                 // Stripe's idempotent event id
if (await db.ProcessedEvents.AnyAsync(e => e.Id == eventId))
    return Results.Ok();                      // already handled — ack, do nothing
// ...apply effect + record eventId in the SAME transaction...
```

Record the provider's event id and short-circuit duplicates — the *consumer-side*
mirror of our `DepositKey`. Always verify the webhook **signature** first (it is an
unauthenticated public endpoint).

**Failure mode.** Without idempotency, a client timeout + retry on the deposit
double-charges; a duplicated Stripe webhook double-credits. The whole point is that
the **happy path and the retry path produce identical state**.

**HFC tie-in.** A franchise customer being charged twice for a deposit is a refund,
a support ticket, and a trust hit — idempotency is money-correctness, not a nicety.

---

## 5. Caching — IMemoryCache, Redis, cache-aside, and the read model

**Mental model.** A cache trades **freshness for latency/cost**: serve a slightly
stale answer fast instead of recomputing the true answer slowly. Three layers
matter here.

### 5a. The read model = a materialized cache (BUILT)

The demo's strongest caching story is the **corporate read model**. Instead of the
CEO dashboard running expensive cross-tenant aggregations live on every page load,
a rollup pre-computes `territory_period_summary` + `watchlist_flag` once:

```csharp
// api/Program.cs:54 (inside the startup scope)
Rollup.Recompute(db);          // materialize the read model from operational tables
```

This is **CQRS read-side / materialized view** — conceptually a cache whose
invalidation policy is "recompute on the rollup clock" ([[M7-bi-readmodels]]).
Reads hit a flat, indexed table, not a live join across tenants. (See §7 for why
this is also the scaling/cost win.)

### 5b. IMemoryCache vs Redis `[role-knowledge]`

| | `IMemoryCache` (in-process) | Redis / distributed cache |
|---|---|---|
| Scope | one instance's heap | shared across all instances |
| Latency | nanoseconds | network hop (~ms) |
| Survives restart? | no | yes |
| Multi-instance correctness | **breaks** — each instance has its own copy | consistent |
| When | single instance, cheap-to-recompute, per-request memo | scale-out, session/shared state, cross-instance invalidation |

**Cache-aside (lazy) pattern** — the default:

```csharp
// [role-knowledge]
var brands = await cache.GetOrCreateAsync("brands", async e =>
{
    e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
    return await db.Brands.ToListAsync();
});
// on write: cache.Remove("brands"); — invalidate, let the next read repopulate
```

**Tenant-key your cache.** In a multi-tenant API the cache key **must** include the
tenant (`$"slots:{tenant.FranchiseeId}"`) or you leak one tenant's data to another
through the cache — an IDOR-via-cache bug (§6).

**Failure mode — cache stampede.** When a hot key expires, every concurrent request
misses at once and all hammer the DB to repopulate — the cache *amplified* load
instead of shielding it. Mitigations: a per-key lock / `GetOrCreate` single-flight
so only one caller recomputes, slightly randomized TTLs to avoid synchronized
expiry, and stale-while-revalidate.

**Failure mode — multi-instance in-memory.** `IMemoryCache` on a 3-instance
scale-out means three *divergent* caches and three *different* invalidation moments
— a write on instance A doesn't clear the stale entry on B. That is the precise
point where you graduate to Redis.

**Trade-off — invalidation.** "There are only two hard things… cache invalidation."
TTL is simple but serves stale data up to the TTL; explicit invalidation is fresh
but you must hit *every* place that writes the underlying data. The read model
sidesteps the hardest version by recomputing wholesale on a known clock.

**Interview defense.**
- *"IMemoryCache or Redis?"* → "Single instance and cheap recompute → IMemoryCache.
  The moment I scale-out or need shared/surviving state, Redis — otherwise each
  instance has a divergent cache and invalidation is per-instance."
- *"Is your dashboard cached?"* → "Effectively yes — the read model *is* a
  materialized cache (`Program.cs:54`), recomputed on the rollup clock so the CEO
  view never runs a live cross-tenant aggregation."

---

## 6. Secrets — Key Vault + managed identity (the demo is passwordless)

**Mental model.** The most-stolen secret is the one that doesn't exist. **Managed
identity** removes the credential entirely: Azure issues the App Service an identity,
and downstream resources (SQL, Key Vault) trust *that identity* — there is no
password to rotate, leak, or commit.

**Demo proof — passwordless, cited.**

```bicep
// infra/main.bicep:91 — the API gets a system-assigned identity
identity: { type: 'SystemAssigned' } // managed identity — zero secrets in config
```

```bicep
// infra/main.bicep:113-114 — SQL connection uses the identity, NOT a password
'Server=tcp:...;Authentication=Active Directory Default;Encrypt=True;'
```

And the SQL server itself is **Entra-only — no SQL passwords exist**:

```bicep
// infra/main.bicep:175
azureADOnlyAuthentication: true // no SQL passwords — Entra only
```

The deploy script grants the API's *identity* a DB login by name, with least
privilege (reader+writer, not admin):

```bash
# infra/deploy.sh:51-53
CREATE USER [hfcdemo-api-...] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [hfcdemo-api-...];
ALTER ROLE db_datawriter ADD MEMBER [hfcdemo-api-...];
```

Note `deploy.sh:29` — even the *human* SQL admin is the signed-in Entra user, not a
shared password. The connection string in `main.bicep:114` contains **no
credential** — that is the whole point: nothing secret to leak.

**Key Vault `[role-knowledge]`.** For app secrets that *do* exist (a Stripe API key,
a Twilio token), the same managed identity reads them from Key Vault at runtime:
`builder.Configuration.AddAzureKeyVault(vaultUri, new DefaultAzureCredential())`.
`DefaultAzureCredential` is the same chain `Authentication=Active Directory Default`
uses — locally it's your dev login, in Azure it's the managed identity. The secret
never enters source, the image, or an env file checked into git.

**Failure mode — secret leak.** A Stripe key in `appsettings.json` committed to a
repo is a breach; so is one echoed into Application Insights logs. Defenses: managed
identity (no secret), Key Vault for the unavoidable ones, never log secret values,
and `.gitignore` + secret scanning on the repo.

**HFC tie-in.** A multi-brand franchisor handling card deposits cannot afford a
leaked payment key — passwordless-by-default is the posture, and the demo already
ships it for the DB connection.

---

## 7. Scaling & cost — scale-out + the read model

**Mental model.** Cloud scaling is **horizontal (scale-out)** first: add identical
stateless instances behind a load balancer, not a bigger box. This only works
*because* of §2 (stateless processes). Cost discipline is the dual: don't pay for
capacity or queries you don't need.

**Demo proof — cost-aware infra.**
- Serverless SQL that **auto-pauses** after idle: `main.bicep:187`
  `autoPauseDelay: 60` — you pay near-zero when nobody's using it.
- Consumption (Y1 Dynamic) Functions: `main.bicep:137` — pay per execution.
- F1/Free default plan, with a documented path to B1 for Always-On
  (`main.bicep:33-34`, `deploy.sh:20-22`) — the cold-start vs cost trade-off is
  made explicit, and a keep-warm cron avoids paying for Always-On (`deploy.sh:66`).

**Demo proof — the read model as the scaling lever.** The corporate dashboard could
do a live cross-tenant aggregation on every load; instead it reads a pre-materialized
table (`Program.cs:54`, [[M7-bi-readmodels]]). That converts an O(rows) query per
request into an O(1) indexed lookup — the read model is *both* the cache (§5) *and*
the thing that lets the read plane scale independently of the write plane (CQRS).

**Trade-off.** Scale-out needs statelessness and externalized cache/state (§5b →
Redis). Serverless/auto-pause saves money but adds **cold starts** — the demo
documents exactly this (F1 cold-starts after ~20min; `deploy.sh:63-66`) and the
mitigation (Basic+ with Always-On, or a keep-warm ping).

**HFC tie-in.** As HFC adds brands and territories, the corporate roll-up grows. The
read model means the CEO view stays fast and cheap regardless of operational volume,
because the expensive work happens once on the rollup clock, not per page view.

---

## 8. Security — OWASP risks for a multi-tenant API

**Mental model.** For a multi-tenant SaaS, the #1 OWASP API risk is **Broken Object
Level Authorization (BOLA / IDOR)**: a user passes an id that isn't theirs and the
API serves it. The defense is to make "is this row mine?" *unbypassable*, not a
per-handler `if`.

### 8a. IDOR — and how the EF query filter defends it (BUILT)

The classic IDOR is `GET /api/appointments/42` returning *another tenant's*
appointment because the handler trusted the id. In the demo that **cannot happen**,
because every tenant-owned entity has a global query filter keyed on the verified
tenant:

```csharp
// api/AppDb.cs:46-55
b.Entity<Territory>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<Slot>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<Appointment>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<NpsSurvey>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
b.Entity<MonthlyReport>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
```

So `db.Appointments.FirstOrDefaultAsync(a => a.Id == id)` (`BookingEndpoints.cs:82`)
is *already* tenant-scoped — a cross-tenant id returns `null` → **404**. The code
comments say it outright: `// not found OR not this tenant's` (`:41`, `:83`). And the
tenant is **never** a client header — it's the verified token claim, **fail-closed**
(no claim → null → no rows; `Auth.cs:59`, [[M1-multitenancy]] §3-4). The defense is
*structural*: every developer gets it by default, you can't forget the `WHERE`.

### 8b. Security headers `[role-knowledge — in flight]`

The roadmap calls for hardening headers (`docs/ROADMAP.md:9`); they are **not yet in
`Program.cs`**. The standard set:

```csharp
// [role-knowledge] middleware to add
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";          // no MIME sniffing
    h["X-Frame-Options"] = "DENY";                    // clickjacking
    h["Referrer-Policy"] = "no-referrer";
    h["Content-Security-Policy"] = "default-src 'self'";
    await next();
});
app.UseHsts();   // Strict-Transport-Security (prod)
```

`httpsOnly: true` and `minTlsVersion: '1.2'` are **already enforced** at the platform
(`main.bicep:94, 98`), so TLS is covered; the app-level headers are the gap.

### 8c. ProblemDetails / no leaked stack traces `[role-knowledge — in flight]`

The demo runs in Development (`main.bicep:105`) and has **no** `AddProblemDetails()`
/ `UseExceptionHandler()` (confirmed absent in `Program.cs`; see [[M3-api-contracts]]
§6). An unhandled exception today would render a dev exception page — an info-leak.
Fix is two lines: `builder.Services.AddProblemDetails();` + `app.UseExceptionHandler();`
(first in the pipeline) → RFC 7807 `application/problem+json`, no stack traces.
(Note the *handled* errors already use ProblemDetails correctly — the missing-key
400 at `BookingEndpoints.cs:80` is `Results.Problem(...)`.)

### 8d. Server-side validation + secrets-never-in-bundle

- **Validation is server-side, always.** The deposit *requires* the Idempotency-Key
  on the server (`BookingEndpoints.cs:79-80`); the booking checks `IsBooked` server-
  side (`:42`). Client validation is UX; the server is the trust boundary.
- **Secrets never in the bundle** — covered in §6: managed identity means there's no
  secret in config; the SPA is a public bundle so it must contain **zero** secrets
  (it talks to `/api` same-origin, `main.bicep:199-203`).

**Failure modes.** IDOR (defended by the filter); leaked stack trace (fix: §8c);
missing CSP/HSTS (fix: §8b); a secret in the JS bundle or logs (fix: §6); and the
*escape hatch* — `IgnoreQueryFilters()` or raw SQL bypasses the IDOR defense, so
those are audited ([[M1-multitenancy]] §6; the rollup is the one sanctioned use).

> **CORS caveat for the interview:** `Program.cs:31-33` uses
> `AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()` — fine for a same-origin demo,
> but in prod with credentials I'd lock the origin allow-list down. Know this; don't
> claim the demo is prod-hardened on CORS.

**Interview defense.**
- *"How do you prevent one tenant reading another's data via the id?"* → "The EF
  global query filter (`AppDb.cs:46-55`) scopes every query by the verified tenant
  claim, so a cross-tenant id returns null → 404. It's structural, not a per-handler
  check, so it can't be forgotten."
- *"What's missing security-wise?"* → "Honestly: app-level security headers
  (CSP/HSTS) and a global ProblemDetails handler — both on the roadmap. TLS/HTTPS-
  only and TLS 1.2 are already enforced at the platform (`main.bicep:94,98`)."
- *"Where could the filter be bypassed?"* → "`IgnoreQueryFilters()` and raw SQL. We
  use `IgnoreQueryFilters` deliberately and only in the corporate rollup, which is
  audited; everywhere else the filter holds."

---

## 9. Distributed tracing & correlation

**Mental model.** In a distributed system (SPA → API → Functions → SQL), a single
user action becomes many spans across processes. **Correlation** stitches them into
one trace via a propagated id, so you can answer "what did *this* request do
everywhere?"

**Demo proof.** Application Insights is wired into **both** the API and the Function
App, pointed at the same workspace:

```bicep
// infra/main.bicep:103 (API) and :159 (Function) — same connection string
{ name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
```

Because both report to the same App Insights (`main.bicep:69-77`), a Durable
orchestration started by the API is **correlated end-to-end** — App Insights ties
logs, metrics, and traces together (the bicep header comment at `:59` says exactly
this). .NET + App Insights propagate W3C `traceparent` automatically across the
`HttpClient` boundary `[role-knowledge]`.

**HFC tie-in.** When a deposit→reminder flow fails in prod, one correlated trace
shows whether it died in the API, the orchestration, Stripe, or Twilio — that is the
difference between a 5-minute and a 5-hour incident ([[M10-reliability-integrations]]).

**Failure mode.** No correlation id = log archaeology across services with no way to
join them. Mitigation: propagate `traceparent`, log a correlation/request id on
every entry, and centralize in App Insights (the demo does the centralization).

---

## 10. Demo proof — the one-screen recap

| Pattern | Where, in the demo | Status |
|---|---|---|
| Config in env | `Program.cs:8-11`, `main.bicep:102-116` | BUILT |
| Stateless / disposable process | `main.bicep:110-112` (`/tmp` wiped), `Program.cs:62-69` | BUILT |
| Idempotency (request) | `BookingEndpoints.cs:74-97` | BUILT |
| Optimistic concurrency | `BookingEndpoints.cs:35-72`, `AppDb.cs:58` | BUILT |
| Read model as materialized cache | `Program.cs:54`, [[M7-bi-readmodels]] | BUILT |
| Managed identity / passwordless | `main.bicep:91,113-114,175`, `deploy.sh:29,51-53` | BUILT |
| IDOR defense (query filter) | `AppDb.cs:46-55`, `BookingEndpoints.cs:41,83` | BUILT |
| TLS / HTTPS-only | `main.bicep:94,98` | BUILT |
| Distributed tracing (App Insights, both tiers) | `main.bicep:103,159` | BUILT |
| Cost: auto-pause SQL, consumption Functions | `main.bicep:137,187`, `deploy.sh:66` | BUILT |
| Polly resilience pipeline | typed `HttpClient` (Stripe/Twilio) | `[role-knowledge]` — §3 code ready |
| Security headers (CSP/HSTS) | middleware | `[role-knowledge — in flight]` `ROADMAP.md:9` |
| Global ProblemDetails handler | `Program.cs` | `[role-knowledge — in flight]` [[M3-api-contracts]] §6 |
| Redis distributed cache | scale-out | `[role-knowledge]` — single instance today |

The honesty here *is* the senior signal: I can point at what's built and name
precisely what's roadmap, with the two-line fix for each gap.

---

## Flashcards

1. **Q:** What is the core 12-factor rule the demo demonstrates for config?
   **A:** Config lives in the *environment*, not the bundle — one artifact, env decides behavior. `ConnectionStrings__Default` is an app setting (`main.bicep:113-115`); code reads `IConfiguration` (`Program.cs:8-11`).

2. **Q:** Why is the SQLite file on `/tmp` in Azure?
   **A:** To enforce a *disposable, stateless* process — `/tmp` is wiped each boot, so the process carries no state between restarts (`main.bicep:110-112`).

3. **Q:** Retry vs circuit breaker — one sentence each.
   **A:** Retry assumes a transient, isolated failure (try again); the breaker assumes a systemic failure (stop trying for a cooldown). You compose both.

4. **Q:** Three things that prevent a retry storm.
   **A:** Exponential backoff + jitter (de-correlate clients), a max-attempt cap + circuit breaker (bound volume), and retrying only idempotent ops.

5. **Q:** Correct Polly pipeline order (outer→inner)?
   **A:** Fallback → total timeout → retry → circuit breaker → per-try timeout → call.

6. **Q:** What makes the demo's deposit safe to retry?
   **A:** The required `Idempotency-Key` header; the stored `DepositKey` makes a replay read back the settled result instead of re-charging (`BookingEndpoints.cs:79-90`).

7. **Q:** Webhooks are delivered how, and what does that demand?
   **A:** At-least-once → the handler must be idempotent (dedupe on the provider's event id) and must verify the signature.

8. **Q:** IMemoryCache vs Redis — the deciding factor?
   **A:** Number of instances. In-memory diverges per instance on scale-out (broken invalidation); Redis is shared/consistent/survives restart.

9. **Q:** What is cache stampede and one fix?
   **A:** A hot key expires and all concurrent requests miss + hammer the DB at once. Fix: single-flight lock (`GetOrCreate`) + randomized TTLs.

10. **Q:** How is the demo passwordless?
    **A:** System-assigned managed identity (`main.bicep:91`) + `Authentication=Active Directory Default` connection string (`:114`) + Entra-only SQL (`:175`) — no password exists to leak.

11. **Q:** What OWASP risk does the EF global query filter defend, and how?
    **A:** Broken Object Level Auth (IDOR/BOLA). Every query is scoped by the verified tenant claim (`AppDb.cs:46-55`), so a cross-tenant id returns null → 404, structurally — not a per-handler check.

12. **Q:** Which two app-level hardening items are roadmap, not built?
    **A:** Security headers (CSP/HSTS) and a global ProblemDetails/UseExceptionHandler. TLS/HTTPS-only is already enforced at the platform (`main.bicep:94,98`).

---

## Mock Q&A

**Q1. "Walk me through how you'd make a payment integration resilient."**
A: Typed `HttpClient` via `IHttpClientFactory` with a Polly v8 resilience pipeline:
per-try timeout (5s) so nothing hangs; retry with exponential backoff + jitter on
transient 5xx/timeouts only; a circuit breaker so when Stripe is genuinely down we
fail fast for a cooldown instead of hammering it; a bulkhead to cap concurrent calls
so a Stripe slowdown can't starve the thread pool serving bookings; a fallback to
degrade gracefully; and an outer total-timeout bounding the whole sequence to my
SLA. Crucially the call carries an Idempotency-Key (`BookingEndpoints.cs:79`) so the
retry is *safe*.
- *Follow-up: "What if you retry a non-idempotent call?"* → Double-charge. That's the
  rule: only retry idempotent operations. The Idempotency-Key is the precondition for
  retry on a POST.
- *Follow-up: "Breaker open — what does the user see?"* → The fallback: a 202
  "queued" ack rather than a 500, and the work goes to a Durable orchestration to
  complete when Stripe recovers.

**Q2. "How does your API stop one franchisee reading another's bookings?"**
A: The tenant is the *verified token claim*, never a header (`Program.cs:62-69`,
[[M1-multitenancy]]). Every tenant-owned entity has an EF global query filter keyed
on `FranchiseeId` (`AppDb.cs:46-55`), so even `GET /api/appointments/42` with a
foreign id resolves to null → 404 (`BookingEndpoints.cs:83`). It's structural, so a
developer can't forget the `WHERE`.
- *Follow-up: "Where could that be bypassed?"* → `IgnoreQueryFilters()` and raw SQL.
  We use `IgnoreQueryFilters` only in the audited corporate rollup; nowhere in the
  request path.
- *Follow-up: "What if FranchiseeId is null?"* → Fail-closed — the filter compares
  against null, matches nothing (`Auth.cs:59`). No claim, no rows.

**Q3. "Your dashboard does a big cross-tenant aggregation — won't that be slow at scale?"**
A: It doesn't run live. A rollup materializes a read model (`Program.cs:54`,
`territory_period_summary`) on the rollup clock, so reads are an O(1) indexed lookup,
not an O(rows) join per page view. That read model is simultaneously a cache and a
CQRS read-side that scales independently of writes ([[M7-bi-readmodels]]).
- *Follow-up: "Isn't that stale?"* → Bounded staleness by design — fresh as of the
  last rollup. For the corporate KPI view that trade is correct; an operator needing
  live data reads the operational tables directly.
- *Follow-up: "Where would Redis come in?"* → When I scale the API out, per-instance
  `IMemoryCache` diverges; shared/invalidatable state moves to Redis.

**Q4. "Are there secrets in your deployment? Where?"**
A: Essentially none. The API uses a system-assigned managed identity (`main.bicep:91`)
and an AD-Default connection string (`:114`); SQL is Entra-only with no passwords
(`:175`); even the human admin is the signed-in Entra user (`deploy.sh:29`). Real
app secrets like a Stripe key would come from Key Vault via the same managed identity
at runtime, never source or the SPA bundle.
- *Follow-up: "Why managed identity over a Key Vault secret?"* → The most-stolen
  secret is the one that doesn't exist. Managed identity removes the credential
  entirely — nothing to rotate or leak. Key Vault is for secrets that *must* exist.
- *Follow-up: "What about secrets in logs?"* → Never log secret values; App Insights
  centralizes telemetry but secrets are excluded by policy.

**Q5. "What would you harden before this goes to production?"**
A: Three concrete things, all known: (1) add `AddProblemDetails()` +
`UseExceptionHandler()` so unhandled errors return RFC 7807, not dev exception pages
([[M3-api-contracts]] §6); (2) add security-header middleware — CSP, HSTS,
X-Content-Type-Options, X-Frame-Options (`ROADMAP.md:9`); (3) lock CORS down from
`AllowAnyOrigin` (`Program.cs:31-33`) to an explicit allow-list. TLS/HTTPS-only and
TLS 1.2 are already enforced at the platform (`main.bicep:94,98`).
- *Follow-up: "Why aren't those done yet?"* → It's a demo optimized to prove the
  hard architecture (multi-tenancy, concurrency, idempotency, passwordless). The
  hardening items are each a few lines and on the roadmap — and I can state exactly
  what they are, which is the point.
- *Follow-up: "Which would you do first?"* → ProblemDetails + gating the dev
  exception page, because a leaked stack trace is an active info-disclosure risk.

---

### See also
- [[M10-reliability-integrations]] — optimistic concurrency, idempotency, Stripe/Twilio roadmap (the deep dive this section builds on)
- [[M1-multitenancy]] — the verified-claim tenant boundary and query filter that defends IDOR
- [[M3-api-contracts]] — ProblemDetails / RFC 7807 (the in-flight error-contract gap)
- [[M7-bi-readmodels]] — the read model that doubles as cache + scaling lever
- [[M8-azure-durable]] / [[M9-cicd-prod]] — Durable Functions resilience + the cost/cold-start trade-offs
