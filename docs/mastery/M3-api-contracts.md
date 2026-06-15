# M3 — API Contracts (OpenAPI 3 / Swagger)

> Mastery doc for the HFC Senior Full Stack Cloud Developer interview.
> Everything below is grounded in real files in the hfc-demo. File:line references
> are quoted, not invented. Cross-links: [[M2-aspnetcore-backend]], [[M7-bi-readmodels]].

---

## 1. Mental model

An API contract is the **shape promise** between a producer and its consumers. There
are two ways to establish it:

- **Contract-first**: humans agree the shapes first (a frozen document), then every
  team builds *to the document*, not to each other's running code.
- **Code-first**: you write the C# handlers and let a tool (Swashbuckle) *derive* an
  OpenAPI spec from the code. The code is the source of truth; the spec is a byproduct.

The hfc-demo runs **both at once, on purpose**:

1. A human-authored **frozen contract** (`docs/dashboard/CONTRACT.md`) locks the DTO
   shapes so three worktrees (alpha/bravo/charlie) can build in parallel.
2. A **code-first OpenAPI** spec is generated at runtime by Swashbuckle and served at
   `/swagger`, so the spec stays honest to what the API actually returns and can drive
   client codegen.

The frozen doc is the *negotiated* contract (design intent, additive versioning,
provenance rules). The Swagger spec is the *mechanical* contract (what the wire shapes
literally are right now). A senior engineer keeps these two in agreement.

The core discipline that makes parallel teams possible is one sentence in the contract:

> "**Build to this contract, not to each other.**"
> — `docs/dashboard/CONTRACT.md:5-6`

---

## 2. Contract-first / frozen-DTO discipline

### Why a frozen CONTRACT.md exists

The file opens by declaring itself the *coordination spine*:

> "This file is the coordination spine for the parallel dashboard build across the
> **alpha / bravo / charlie** worktrees. Alpha builds the read model to this schema,
> Bravo builds APIs to these DTOs, Charlie builds the UI to these DTOs."
> — `docs/dashboard/CONTRACT.md:3-6`

That is the whole point of contract-first: it **decouples teams in time**. Charlie (the
Angular UI) does not have to wait for Bravo (the API) to be running. The contract spells
this out as an explicit workflow:

> "**Bravo** may stub the read model (in-memory rows shaped like §1) until Alpha
> lands, then wire to `territory_period_summary`."
> "**Charlie** builds against fixture JSON copied verbatim from §2, then swaps the
> `api.service` base to live Bravo endpoints."
> — `docs/dashboard/CONTRACT.md:204-207`

So the contract is not bureaucracy — it is *literally* the thing that lets the UI ship
fixtures-first and the API ship a stub-first, then both converge with zero rework
because they were both built against the same byte-for-byte JSON in §2.

### What a frozen DTO looks like

The DTOs are pinned as concrete JSON examples, not prose. For example the territory
list item:

```json
{ "territoryId":1, "territoryName":"Orange County North",
  "brandId":1, "brandName":"Budget Blinds", "regionId":1, "regionName":"West",
  "franchiseeName":"Example Franchisee", "openDate":"2022-04-01",
  "tenureBand":"mature", "archetype":"project_installation", "status":"open" }
```
— `docs/dashboard/CONTRACT.md:104-108`

Freezing means: those field names, casing (camelCase), and types are a promise. Charlie
can write `territory.compositeHealthScore` against the corporate DTO
(`docs/dashboard/CONTRACT.md:126`) before any C# exists, and it will line up.

### The change-control rule

A frozen contract is only frozen if changes are *governed*. The rule is stated twice:

> "Any change here is a cross-stream event: edit this file, bump the version, and ping
> the other leads before diverging."
> — `docs/dashboard/CONTRACT.md:6-7`

> "**Contract changes** = edit this file, bump version, ping the other two leads."
> — `docs/dashboard/CONTRACT.md:203`

This is the equivalent of an OpenAPI spec living under version control with PR review —
the document is the gate, and the version bump is the audit trail.

---

## 3. Additive versioning (v1.1 / v1.2)

The single most important contract rule here is: **add fields/endpoints, never change
or remove existing shapes.** The changelog header states it as a hard invariant:

> "**Changelog (all additive — no shape breaks):**"
> — `docs/dashboard/CONTRACT.md:13`

Two real version bumps demonstrate the two flavors of additive change:

**v1.1 — a new endpoint (additive at the API surface):**

> "`v1.1` (bravo, §2) — add `GET /api/dashboard/map`."
> — `docs/dashboard/CONTRACT.md:14`

The endpoint section explains *why it had to be a new endpoint instead of widening the
existing one*:

> "Separate from `/api/territories` because the registry item carries no score and the
> map needs no franchisee/openDate."
> — `docs/dashboard/CONTRACT.md:161-162`

> "`/api/territories` stays byte-for-byte identical, so existing fixtures are
> unaffected."
> — `docs/dashboard/CONTRACT.md:176-177`

That phrase — **byte-for-byte identical** — is the additive test. Bravo *could* have
bolted `lat`/`lng`/`compositeScore` onto the territory item, but that would have
changed a shape Charlie's fixtures already depended on. A new lean DTO at a new route
is the non-breaking move.

**v1.2 — a new column / field (additive at the read-model layer):**

> "`v1.2` (alpha, §1) — add `franchisee_slug` column to `territory_period_summary`
> (operational slug denormalized beside the numeric `franchisee_id`) so Bravo's RBAC
> franchisee lens can match Slice A's token claim (a slug) to read-model rows."
> — `docs/dashboard/CONTRACT.md:15-17`

The column row itself:

> "`franchisee_slug (TEXT)` operational slug (v1.2) — Bravo maps token-claim slug ->
> numeric franchisee_id for the RBAC franchisee lens"
> — `docs/dashboard/CONTRACT.md:54`

This field exists to bridge identity to data: the verified token claim is a *slug*, the
read-model rows key on a *numeric id*, and v1.2 adds the slug beside the id so the
franchisee RBAC lens (see `api/Program.cs:77-83`) can resolve one to the other. Adding
a nullable/extra column is additive — old consumers ignore it; the new RBAC path reads
it.

### Why additive is the law for HFC

> "**Demo now / real later:** every seeded metric must be *swappable* to measured with
> a data-source change only — no shape changes. If a task forces a shape change to
> support Track 2, it belongs in Track 2."
> — `docs/dashboard/CONTRACT.md:208-210`

NPS is the canonical example — it flips provenance without a shape change:

> "NPS flips `seeded → measured` when Slice C (NPS pipeline) merges — a one-line
> data-source change (issue D-NPS-SWAP), NOT a blocker."
> — `docs/dashboard/CONTRACT.md:39-40`

This is exactly the discipline a franchisor needs: **franchisee integrations and
partner clients can't break** when corporate evolves the data plane behind the API.

---

## 4. The HFC tie-in: franchisee integrations can't break

HFC is multi-brand, multi-tenant. The dashboard is consumed by:

- the internal Angular SPA (Charlie's UI),
- the franchisee lens (a scoped view of a single franchisee's territories), and
- realistically, downstream partner/franchisee systems that will read the corporate
  roll-up over time.

Every metric in the DTO carries provenance so consumers can trust-but-verify:

> "Provenance | **Every metric carries `provenanceType` + `asOfDate` +
> `refreshStatus`** | The star feature — turns the data gap into a feature"
> — `docs/dashboard/CONTRACT.md:29`

And the RBAC scope is enforced **before** the query, not in the DTO:

> "RBAC | **Two lenses: `corporate` (all) + `franchisee` (own)**, scope = a filter
> applied pre-query"
> — `docs/dashboard/CONTRACT.md:30`

The contract decoupling means: when alpha changes how `gross_revenue` is sourced
(seeded → real royalty feed), the API DTO field `system_revenue_ltm`
(`docs/dashboard/CONTRACT.md:120`) keeps its name, unit (`dollars`), and
`provenanceType` field — only the `provenanceType` *value* flips from `"seeded"` to
`"measured"`. No franchisee client redeploys. That is the business value of a frozen,
additive contract.

---

## 5. OpenAPI / Swagger in the code (code-first plane)

The runtime spec is wired in `api/Program.cs`. Three registrations turn the minimal-API
endpoints into a browsable, codegen-able OpenAPI document:

```csharp
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
```
— `api/Program.cs:30-31`

```csharp
app.UseSwagger();
app.UseSwaggerUI();
```
— `api/Program.cs:37-38`

What each piece does:

- `AddEndpointsApiExplorer()` (`Program.cs:30`) — registers the metadata provider that
  lets **minimal APIs** (the `app.MapCatalog()`, `app.MapDashboard()`, etc. at
  `Program.cs:91-96`) be discovered by the API Explorer. Controllers get this for free;
  minimal APIs need it explicitly. Without it, the generated spec is empty.
- `AddSwaggerGen()` (`Program.cs:31`) — Swashbuckle's generator that walks the
  discovered endpoints + their response/parameter types and emits the OpenAPI 3 JSON
  document.
- `UseSwagger()` (`Program.cs:37`) — serves the generated spec at
  `/swagger/v1/swagger.json`.
- `UseSwaggerUI()` (`Program.cs:38`) — serves the interactive Swagger UI page at
  `/swagger`.

Note the SPA fallback is explicitly written to **not** swallow Swagger:

> "SPA fallback: any non-API, non-file route serves index.html ... Excludes /api and
> /swagger."
> — `api/Program.cs:98-99`

### OpenAPI as the client codegen source

The generated `swagger.json` is the machine-readable contract. It is the input you feed
to a codegen tool (`nswag`, `openapi-generator`, `swagger-codegen`) to produce a typed
TypeScript client for the Angular SPA or a typed C#/Java client for a partner. This is
the *mechanical* counterpart to the *negotiated* JSON in CONTRACT.md §2 — and in a
mature setup you'd add a CI check that the generated spec hasn't drifted from the frozen
contract.

---

## 6. Error contracts: ProblemDetails / RFC 7807

A complete API contract covers **failure shapes**, not just success shapes. RFC 7807
(`application/problem+json`) is the standard error body:

```json
{
  "type": "https://httpstatuses.io/400",
  "title": "Bad Request",
  "status": 400,
  "detail": "The 'period' query parameter must be a 6-digit YYYYMM value.",
  "instance": "/api/dashboard/corporate"
}
```

This gives consumers a *stable, typed* error shape — `type`, `title`, `status`,
`detail`, `instance` — that a franchisee client can branch on, instead of parsing a
free-text 500 page.

### KNOWN GAP (teach this honestly)

**The hfc-demo does not yet register a global ProblemDetails handler.** Look at
`api/Program.cs` end-to-end: there is no `AddProblemDetails()` in the service
registrations (around `Program.cs:30-33`) and no `UseExceptionHandler(...)` in the
middleware pipeline (around `Program.cs:35-45`). The app is also running in
**Development**, where ASP.NET Core's developer exception page is active.

**Consequence / failure mode:** an unhandled exception — including a model-binding /
validation failure surfaced as a 400 — can return the **developer exception page with a
.NET stack trace** instead of a clean `problem+json` body. That is:

1. an **information leak** (internal types, file paths, framework versions), and
2. a **contract violation** (the error shape isn't the typed RFC 7807 body a franchisee
   integration expects).

**The right fix** (be ready to say this exactly):

```csharp
// in service registration (near Program.cs:30)
builder.Services.AddProblemDetails();

// in the pipeline, FIRST, before other middleware (near Program.cs:35)
app.UseExceptionHandler();      // converts unhandled exceptions -> problem+json
app.UseStatusCodePages();       // optional: problem+json for bare 4xx/5xx too
```

`AddProblemDetails()` registers the `IProblemDetailsService`; `UseExceptionHandler()`
(with no args, in .NET 8/9) catches unhandled exceptions and renders them as RFC 7807
via that service. You'd also scope the developer exception page to Development only
(`if (app.Environment.IsDevelopment())`) so a stack trace can *never* reach production.
For validation specifically, minimal-API validation problems should be emitted as
`ValidationProblem` (HTTP 400 with a `errors` dictionary), which is the RFC 7807
extension for field-level errors.

Saying "we currently leak stack traces because there's no global handler, and the fix is
`AddProblemDetails` + `UseExceptionHandler` plus gating the dev page to Development" is a
*senior* answer — it shows you read the pipeline and know the standard remedy.

---

## 7. Trade-offs: contract-first vs code-first

| Dimension | Contract-first (CONTRACT.md) | Code-first (Swashbuckle) |
|---|---|---|
| Source of truth | Human-negotiated document | The C# handlers |
| Enables parallel teams | Yes — stub/fixture before code exists (`CONTRACT.md:204-207`) | No — consumers need running code or a published spec |
| Drift risk | Doc can lag behind code | Spec always matches code, but design is unreviewed |
| Versioning discipline | Explicit, governed (`CONTRACT.md:13`, `:203`) | Whatever the code happens to do |
| Best for | Cross-team / cross-org contracts (HFC franchisee integrations) | Solo/internal APIs, fast iteration |
| Codegen | Hand-shaped, then verified against generated spec | Generate clients directly from `swagger.json` |

The hfc-demo's stance: **contract-first for the negotiated shapes** (because three lanes
+ future franchisee clients depend on them), **code-first generation on top** (so the
served spec stays honest and can drive codegen). The danger to manage is *drift* between
the two — the discipline answer is a CI gate comparing generated spec ↔ frozen contract.

---

## 8. Failure modes (and the fix)

1. **A breaking DTO change.** Bravo renames `compositeHealthScore` → `healthScore`, or
   removes `franchiseeName` from the territory item (`CONTRACT.md:106`). Charlie's
   fixtures + a live franchisee client both break silently (undefined fields, blank
   tiles). *Fix:* additive only — add the new field, deprecate the old one for a
   version, bump the contract version, ping leads (`CONTRACT.md:203`). The v1.1 map
   endpoint is the model: new DTO at a new route, `/api/territories` left
   "byte-for-byte identical" (`CONTRACT.md:176-177`).

2. **Leaked stack traces on 400s.** No `AddProblemDetails`/`UseExceptionHandler` in
   `Program.cs:30-45` + Development env → dev exception page + stack trace instead of
   `problem+json`. Info leak + error-contract violation. *Fix:* §6 above.

3. **Spec ↔ contract drift.** Code-first spec evolves but CONTRACT.md doesn't (or vice
   versa) → codegen produces a client that doesn't match the negotiated shapes. *Fix:*
   CI check diffing generated `swagger.json` against the frozen DTOs; treat divergence
   as a build failure.

4. **Shape change smuggled in to serve Track 2.** A future-features task pressures a DTO
   change today. *Fix:* the contract pre-decided this — "If a task forces a shape change
   to support Track 2, it belongs in Track 2." (`CONTRACT.md:208-210`).

---

## 9. Interview defense (follow-ups + answers)

**Q1. Your API leaks .NET stack traces on bad requests. Why, and how do you fix it?**
Because `Program.cs` registers Swagger but has no global error contract — there's no
`AddProblemDetails()` in the service block (`Program.cs:30-33`) and no
`UseExceptionHandler()` in the pipeline (`Program.cs:35-45`), and it's running in
Development, so the developer exception page renders stack traces. Fix: add
`builder.Services.AddProblemDetails()`, add `app.UseExceptionHandler()` as the first
middleware so unhandled exceptions become RFC 7807 `problem+json`, gate the developer
exception page to `IsDevelopment()`, and emit `ValidationProblem` for 400s so field
errors are structured. The contract value is that franchisee clients get a stable,
typed error body instead of a leaky HTML page.

**Q2. You generate the spec from code AND keep a hand-written CONTRACT.md. Isn't that
redundant?** No — they serve different masters. CONTRACT.md is the *negotiated* contract
that lets alpha/bravo/charlie build in parallel before any code runs
(`CONTRACT.md:204-207`); the generated spec is the *mechanical* truth of what the wire
shapes are right now and the input to client codegen. The risk is drift, which I'd close
with a CI check that diffs the generated `swagger.json` against the frozen DTOs.

**Q3. A new feature needs lat/long on territories. Do you add it to `/api/territories`?**
No. That item is frozen and Charlie's fixtures depend on it. The demo already solved
this in v1.1: a *new* lean endpoint `GET /api/dashboard/map` carrying only what the map
needs (`CONTRACT.md:160-169`), leaving `/api/territories` "byte-for-byte identical"
(`CONTRACT.md:176-177`). Additive, not breaking.

**Q4. How does adding `franchisee_slug` (v1.2) not break existing consumers?** It's an
extra column/field added beside `franchisee_id` (`CONTRACT.md:54`). Old consumers that
never asked for it are unaffected; the new RBAC franchisee lens
(`Program.cs:77-83`) reads it to map a token-claim slug to a numeric id. Adding a field
is additive by definition — the no-shape-break rule (`CONTRACT.md:13`).

---

## 10. Demo proof

Run the API and open Swagger:

```bash
# from the api/ project
dotnet run
# then browse to:
#   http://localhost:5000/swagger        (interactive UI — UseSwaggerUI, Program.cs:38)
#   http://localhost:5000/swagger/v1/swagger.json   (the spec — UseSwagger, Program.cs:37)
```

What to point at live:
- The Swagger UI lists the endpoints composed at `Program.cs:91-96` (catalog, booking,
  intake, dashboard, nps, franchisee dashboard).
- The `swagger.json` is the machine-readable contract you'd feed to codegen.
- Then *demonstrate the gap honestly*: send a malformed request to a dashboard endpoint
  and show that, without `UseExceptionHandler`, the response is a dev exception page /
  stack trace rather than `problem+json` — and state the fix from §6.

---

## Flashcards

1. **Q:** What single sentence in CONTRACT.md enables parallel teams?
   **A:** "Build to this contract, not to each other." (`CONTRACT.md:5-6`)

2. **Q:** What does `AddEndpointsApiExplorer()` do and why is it needed for minimal APIs?
   **A:** Registers the metadata provider that lets minimal-API endpoints be discovered
   by the API Explorer so Swashbuckle can include them; controllers get it free, minimal
   APIs need it explicitly (`Program.cs:30`).

3. **Q:** Difference between `UseSwagger()` and `UseSwaggerUI()`?
   **A:** `UseSwagger()` serves the spec JSON at `/swagger/v1/swagger.json`;
   `UseSwaggerUI()` serves the interactive HTML page at `/swagger`
   (`Program.cs:37-38`).

4. **Q:** What is the additive-versioning invariant in CONTRACT.md?
   **A:** "Changelog (all additive — no shape breaks)." Add fields/endpoints, never
   change/remove existing shapes (`CONTRACT.md:13`).

5. **Q:** What did v1.1 add and why a new endpoint instead of widening `/api/territories`?
   **A:** Added `GET /api/dashboard/map`; a new lean DTO so `/api/territories` stays
   "byte-for-byte identical" and existing fixtures don't break (`CONTRACT.md:14`,
   `:160-177`).

6. **Q:** What did v1.2 add and what problem does it solve?
   **A:** A `franchisee_slug` column on `territory_period_summary` so the RBAC
   franchisee lens can map a token-claim slug to the numeric `franchisee_id`
   (`CONTRACT.md:15-17`, `:54`).

7. **Q:** What RFC defines the standard error body and what's its media type?
   **A:** RFC 7807, `application/problem+json`, with `type/title/status/detail/instance`.

8. **Q:** Why does the hfc-demo currently leak stack traces on 400s?
   **A:** No `AddProblemDetails()` and no `UseExceptionHandler()` in `Program.cs`
   (~`:30-45`) and it runs in Development, so the dev exception page renders stack traces.

9. **Q:** The two-line fix for the leaked stack traces?
   **A:** `builder.Services.AddProblemDetails();` + `app.UseExceptionHandler();` (first
   in pipeline), plus gate the dev exception page to `IsDevelopment()`.

10. **Q:** What is OpenAPI used for beyond docs?
    **A:** It's the client-codegen source — feed `swagger.json` to nswag/openapi-generator
    for typed TS/C# clients.

11. **Q:** Contract-first vs code-first in one line each?
    **A:** Contract-first = humans agree shapes first, teams build to the doc (enables
    parallelism); code-first = spec derived from the running code (always matches code,
    design unreviewed).

12. **Q:** How does NPS flip from seeded to measured without breaking the contract?
    **A:** A one-line data-source change (D-NPS-SWAP); the DTO shape and `provenanceType`
    field stay — only the value flips (`CONTRACT.md:39-40`).

---

## Mock Q&A

**M1. Walk me through how three teams built this dashboard in parallel without
integration hell.**
A frozen contract (`docs/dashboard/CONTRACT.md`) locks the read-model schema (§1), the
API DTOs (§2 — concrete JSON), and the rules. Alpha builds the read model to §1, Bravo
the APIs to §2, Charlie the UI to §2 — "build to this contract, not to each other"
(`CONTRACT.md:5-6`). Bravo stubs in-memory rows shaped like §1 until Alpha lands; Charlie
uses fixture JSON copied verbatim from §2 then swaps the API base
(`CONTRACT.md:204-207`). Convergence is rework-free because everyone targeted the same
byte-for-byte shapes.
*Follow-up: what stops someone quietly diverging?* The change-control rule: edit the
file, bump the version, ping the other leads (`CONTRACT.md:203`) — and the version
markers v1.1/v1.2 are the audit trail.

**M2. Show me a real non-breaking change you'd be comfortable shipping mid-flight.**
v1.1's `GET /api/dashboard/map` (`CONTRACT.md:14`, `:160-169`). The map needed lat/long
and a score to shade dots, but the frozen `/api/territories` item has neither. Instead of
mutating that item, Bravo added a separate lean endpoint, leaving `/api/territories`
"byte-for-byte identical, so existing fixtures are unaffected" (`CONTRACT.md:176-177`).
*Follow-up: when would adding a field to the existing DTO be acceptable?* When it's a
purely additive optional field that no consumer's deserializer rejects — like v1.2's
`franchisee_slug` column (`CONTRACT.md:54`). Removal or rename is never acceptable
without a version + deprecation cycle.

**M3. Your bad requests return .NET stack traces. Defend that and fix it.**
I can't defend it — it's a known gap. `Program.cs` wires Swagger (`:30-31`, `:37-38`) but
registers no error contract: no `AddProblemDetails()` (~`:30-33`) and no
`UseExceptionHandler()` (~`:35-45`), and the app runs in Development so the dev exception
page renders stack traces. That's both an info leak and an error-contract violation. Fix:
`builder.Services.AddProblemDetails()`, `app.UseExceptionHandler()` first in the pipeline
to render RFC 7807 `problem+json`, gate the dev page to `IsDevelopment()`, and emit
`ValidationProblem` for 400s.
*Follow-up: why does the error shape even matter to HFC?* Franchisee integrations branch
on a stable typed body (`type/title/status/detail`); an HTML stack-trace page breaks
their parsing and exposes internals.

**M4. You generate OpenAPI from code yet maintain a hand-written contract. Why both?**
They answer different questions. CONTRACT.md is the *negotiated* contract that lets teams
and future franchisee clients build before code runs (`CONTRACT.md:204-207`); the
generated `swagger.json` is the *mechanical* truth of the current wire shapes and the
input to client codegen. Keeping both means design is reviewed *and* the served spec is
honest.
*Follow-up: how do you stop them drifting?* A CI gate that diffs the generated spec
against the frozen DTOs and fails the build on divergence — the doc is the intent, the
spec is the enforcement.

**M5. How does the contract let a "seeded" financial metric become "real" later without
breaking clients?**
Every metric carries `provenanceType` + `asOfDate` + `refreshStatus`
(`CONTRACT.md:29`). When the data source goes from seed to a real royalty feed, the DTO
field keeps its name and unit — only the `provenanceType` *value* flips `seeded →
measured`. NPS is the template: a one-line data-source swap, "NOT a blocker"
(`CONTRACT.md:39-40`). The rule that guarantees it: seeded metrics must be swappable to
measured "with a data-source change only — no shape changes" (`CONTRACT.md:208-210`).
*Follow-up: where would a shape change for this belong instead?* Track 2 — the contract
explicitly routes shape-forcing work there (`CONTRACT.md:208-210`).

---

### See also
- [[M2-aspnetcore-backend]] — the minimal-API pipeline, tenancy seam, and middleware
  ordering that this contract layer sits on (`Program.cs:57-100`).
- [[M7-bi-readmodels]] — the `territory_period_summary` read model (CONTRACT §1) and the
  `Rollup.Recompute` projection (`Program.cs:54`) that the DTOs in §2 project from.
