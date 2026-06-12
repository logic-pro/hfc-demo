# Azure Hosting & DevOps — project notes & interview prep

Audience: Senior Full Stack Cloud Developer candidate (.NET/Azure). Every claim
below is grounded in files you can open: `infra/main.bicep`, `infra/deploy.sh`,
`DEPLOY.md`, and `.claude/skills/run-hfc-demo/SKILL.md`.

---

## What it is

Azure App Service is a fully managed PaaS for running web apps and APIs without
managing VMs or container orchestration. You pick a plan (tier + compute), deploy
your code, and Azure handles OS patching, TLS termination, auto-scaling (on paid
tiers), load balancing, and health monitoring. Azure Functions (Consumption plan)
extends this to event-driven, serverless compute billed per execution.

Bicep is Microsoft's first-class infrastructure-as-code DSL that compiles to ARM
JSON. It gives you strong typing, modularisation, conditional resources, and
what-if dry-runs while remaining tightly integrated with Azure RBAC and resource
providers.

Application Insights (backed by Log Analytics) is the Azure-native APM: it
correlates HTTP traces, dependency calls, custom metrics, and exceptions under a
single operation ID, giving you distributed tracing across App Service and
Functions without changing application code beyond wiring the connection string.

---

## How it's used in the HFC demo

### Topology

```
Browser
  │ HTTPS (same origin — no CORS)
  ▼
App Service  hfcdemo-api-pkz2lysbqoabq.azurewebsites.net
  Angular SPA  (served from api/wwwroot via MapFallbackToFile)
  ASP.NET Core 9 API
  Plan: F1 Free, Linux, DOTNETCORE|9.0
  Identity: SystemAssigned managed identity
  /home/hfc-demo.db  (SQLite — persistent across restarts)
  │ starts orchestrations
  ▼
Function App  hfcdemo-func-pkz2lysbqoabq.azurewebsites.net
  Durable Functions, dotnet-isolated, Consumption (Y1 Dynamic)
  Identity: SystemAssigned managed identity
  │
  ▼
Storage account  (AzureWebJobsStorage — required by Durable Functions)

Both sites → Application Insights  hfcdemo-ai
             Log Analytics workspace  hfcdemo-logs  (PerGB2018, 30-day retention)

Optional (deploySql=true):
  Azure SQL serverless GP_S_Gen5_1, auto-pause 60 min, Entra-only auth
```

Source: `infra/main.bicep` lines 38-178.

### SPA serving — same-origin from App Service

`deploy.sh` (lines 56-59) builds the Angular production bundle with
`window.__API_BASE__=''` (empty string = same origin), copies the output into
`api/wwwroot/`, then zip-deploys the API project which includes `wwwroot` in the
publish output. ASP.NET Core's `MapFallbackToFile("index.html")` serves the SPA;
all `/api/*` routes are handled by controllers. Both SPA and API share one
hostname — no CORS required.

### Bicep structure

`infra/main.bicep` illustrates the key Bicep constructs an interviewer will probe:

- **Parameters with decorators** (`@description`, `@minLength`, `@maxLength`) and
  defaults (`resourceGroup().location`).
- **Variables** (`var suffix = uniqueString(resourceGroup().id)`) for stable,
  collision-resistant names.
- **`environment()` function** — resolves cloud-specific suffixes at compile time:
  `environment().suffixes.sqlServerHostname` and `environment().suffixes.storage`
  keep the template portable across Azure Commercial, Government, and China clouds.
- **Conditional resources** (`if (deploySql)`) — the SQL server, database, and
  firewall rule are omitted entirely when `deploySql=false`, keeping the default
  deployment free.
- **Resource dependencies** — implicit (Bicep infers them from property
  references, e.g., `appInsights.properties.ConnectionString` inside `api`
  settings means the API resource won't be created before App Insights).
- **`listKeys()`** — fetches the storage account key inline to wire
  `AzureWebJobsStorage` without a separate script step.
- **Outputs** — `apiHostName`, `funcHostName`, `sqlServerFqdn`,
  `apiPrincipalId`, `funcPrincipalId` are captured by `deploy.sh` via
  `az deployment group create --query properties.outputs`.

### Deployment pipeline (`infra/deploy.sh`)

1. Verify `az login` and capture signed-in user's Entra object ID / UPN (the SQL
   Entra admin — no SQL password ever created).
2. `az group create` — idempotent; no-ops if the RG already exists.
3. `az deployment group create` with the Bicep template and parameters — returns
   the output block as JSON; `deploy.sh` extracts hostnames with `python3 -c`.
4. Build Angular SPA (`npm ci && ng build --configuration production`), copy into
   `api/wwwroot/`.
5. `dotnet publish` the API, zip the publish folder (`zip` or `python3
   shutil.make_archive` fallback), `az webapp deploy --type zip`.
6. `func azure functionapp publish` pushes the Durable Functions app.

The script is idempotent: re-running updates resources in place (Bicep is
declarative; zip deploy replaces the slot). Full teardown:
`az group delete -n hfc-demo-rg --yes`.

### App Insights / observability

Both the API and the Function App receive `APPLICATIONINSIGHTS_CONNECTION_STRING`
via `appSettings` in the Bicep (lines 77, 127). The Application Insights resource
is workspace-based (linked to the Log Analytics workspace via `WorkspaceResourceId:
logs.id`), which means raw telemetry lands in the Log Analytics KQL tables
(`requests`, `dependencies`, `exceptions`, `traces`, `customMetrics`) for ad-hoc
querying. At the AI layer you get the pre-aggregated Metrics blade and the
end-to-end transaction search with correlation IDs across App Service and
Functions.

### Managed identity for SQL (optional path)

When `deploySql=true`, the API's connection string uses
`Authentication=Active Directory Default` — no password, no client secret in
config. The App Service's system-assigned managed identity (`api.identity.type =
'SystemAssigned'`) gets a SQL login via a one-time `CREATE USER … FROM EXTERNAL
PROVIDER` / `ALTER ROLE` grant (Bicep cannot perform data-plane SQL grants; this is
the one manual step). `deploy.sh` prints the exact SQL block with the app name
filled in (`DEPLOY.md` lines 32-44).

---

## Why we chose it (and alternatives)

### App Service vs Container Apps vs AKS

For a demo that must run on a free Azure subscription, App Service F1 is the
correct choice: no compute cost, no container registry, no cluster management. The
trade-off is the F1 tier's constraints — no custom domains (HTTPS only on
`.azurewebsites.net`), no always-on (the worker spins down after ~20 min idle,
causing a cold-start on the next request), and shared compute. B1 eliminates
cold-start (always-on) for ~$13/month.

Container Apps would be appropriate once you need per-revision traffic splitting or
KEDA-based autoscaling without managing Kubernetes. AKS is the right choice when
you need full Kubernetes control (custom ingress controllers, pod autoscaling
policies, multi-cluster federation) — excessive for a demo.

### SPA serving: App Service vs Static Web Apps — and why we pivoted

The original architecture (still visible in `DEPLOY.md` line 15 and the Bicep
comment at line 169) used Azure Static Web Apps (Free tier) for the Angular SPA.
The pivot happened because the `StaticSitesClient` binary used by the SWA CLI to
upload build artifacts was blocked by a network proxy in the build environment:
the binary obtained a DeploymentId then died with "An unknown exception has
occurred"; `az rest` to `management.azure.com` also returned a mangled proxy 400.
The fix: serve the SPA from the App Service itself by building same-origin and
copying to `wwwroot`. This uses the working zip-deploy path, eliminates CORS
entirely, and is one fewer resource to manage. On an unproxied machine the SWA
path works and is a legitimate architecture choice.

### F1 vs B1

F1 is free but has no always-on, meaning the worker process shuts down after ~20
minutes of inactivity. The next request incurs a cold start (5-30 s for a .NET app).
For a demo this is acceptable; the Bicep comment (line 61) explicitly notes
"bump to B1 for always-on / no cold start."

### Bicep vs Terraform vs ARM JSON

Bicep compiles to ARM JSON and is the Azure-native choice: it has first-class VS
Code tooling, `az bicep build` for local validation, `az deployment group
what-if` for dry-runs, and no state file to manage (ARM is the source of truth).
Terraform is the right choice when you need a multi-cloud IaC layer or already
have Terraform state and modules standardised across the org. ARM JSON is raw Bicep
output — no one authors it by hand; it exists for compatibility.

### centralus — region choice

Free Azure subscriptions have region-specific App Service F1 quota limits, and
those limits can be 0. During deployment, eastus2, eastus, and westus2 all returned
`SubscriptionIsOverQuotaForSku` with "Total VMs: 0" for the F1 Linux SKU. centralus
had quota. This was not a spending-limit issue; it was a per-region quota allocation
for free subscriptions. The `LOCATION=centralus` default in `deploy.sh` (line 17)
encodes this lesson.

---

## Core concepts to nail

### App Service plans and tiers

An App Service plan is the compute unit — it defines OS, region, VM size, and
scaling rules. All apps on a plan share its resources. Key tiers:

| Tier | SKU | Always-on | Custom domain | Slots | Use case |
|------|-----|-----------|---------------|-------|----------|
| Free | F1 | No | No | No | Demo / dev |
| Basic | B1 | Yes | Yes | No | Single-env prod |
| Standard | S1 | Yes | Yes | 5 | Staging + prod |
| Premium | P1v3 | Yes | Yes | 20 | High-traffic |

The HFC demo uses F1 for the API plan and Y1 (Consumption / Dynamic) for
Functions. Functions cannot share an F1 plan — Consumption is a separate,
per-execution-billed plan type (`sku: { name: 'Y1', tier: 'Dynamic' }`).

### Deployment slots

Slots (Standard and above) let you deploy to a staging slot, run smoke tests, then
perform a swap — the swap exchanges the production and staging hostnames
atomically, with no downtime. The previous production slot is immediately available
for rollback. The HFC demo uses F1 (no slots), but the pattern to articulate in an
interview: build → deploy to staging slot → integration tests → `az webapp
deployment slot swap`.

### `/home` persistence

On Linux App Service, `/home` is a network-mounted SMB share that persists across
restarts and scaling events. The HFC demo uses `/home/hfc-demo.db` as the SQLite
file path (Bicep line 83: `'Data Source=/home/hfc-demo.db'`). This works for a
single-instance demo; it breaks under horizontal scaling because SQLite is not
network-safe for concurrent writers. For scale-out, switch to Azure SQL (the
`deploySql=true` path) or Azure Database for PostgreSQL.

### Bicep: params / resources / outputs / modules / conditionals

- **Parameters**: typed, decorated, with defaults. `deploySql bool = false` is the
  feature flag; `namePrefix` has `@minLength(3) @maxLength(11)` guards.
- **Variables**: `uniqueString(resourceGroup().id)` produces a stable 13-char hash
  — deterministic for a given RG, so re-deploying doesn't rename resources.
- **Resources**: declared with `resource <sym> '<type>@<api-version>' = { ... }`.
  Child resources use `parent: <sym>` (`sqlDb` / `sqlFirewall` parent `sqlServer`).
- **Conditional resources**: `= if (deploySql) { ... }` — the resource is not
  provisioned at all when false.
- **`environment()` function**: returns cloud-environment metadata at compile time;
  used for `suffixes.sqlServerHostname` (`.database.windows.net`) and
  `suffixes.storage` (`.core.windows.net`).
- **Outputs**: typed values returned after deployment; consumed by shell scripts or
  downstream pipelines.
- **Modules**: not used in this single-file template but the pattern is
  `module <sym> '<path>.bicep' = { params: { ... } }`.

### what-if validation

`az deployment group what-if -g <rg> --template-file infra/main.bicep` shows
a colour-coded diff of what will be created, modified, or deleted — without
applying anything. Essential before running a destructive change in production.
`az bicep build --file infra/main.bicep --outfile /tmp/main.json` validates syntax
and produces the ARM JSON (`SKILL.md` line 117).

### Managed identity for deploy (and for SQL)

System-assigned managed identity (`identity: { type: 'SystemAssigned' }`) gives
each Azure resource an Entra service principal tied to its lifecycle. No client
secret to rotate. For SQL: the API authenticates with
`Authentication=Active Directory Default`, which picks up the managed identity
credential automatically (via the Azure SDK's `DefaultAzureCredential` chain). For
deployment: `az webapp deploy` authenticates with your personal Entra token from
`az login`; in CI, a federated credential / service principal replaces it.

### App Insights: logs vs metrics vs traces vs correlation

| Concept | What it is | Where in Azure |
|---------|------------|----------------|
| Traces | `ILogger` output, custom events | `traces` table in Log Analytics |
| Requests | Incoming HTTP calls, duration, result code | `requests` table |
| Dependencies | Outbound SQL/HTTP calls, duration | `dependencies` table |
| Exceptions | Unhandled exceptions with stack | `exceptions` table |
| Metrics | Aggregated numeric values (CPU, req/s, custom) | Metrics blade + `customMetrics` |
| Correlation | `operation_Id` propagated via W3C traceparent header across App Service and Functions | Transaction Search / App Map |

All land in the Log Analytics workspace (`hfcdemo-logs`) and are queryable with KQL.

### IaC idempotency

Bicep / ARM deployments are idempotent: running the same template twice produces
the same state. Resources that already exist are compared against the desired state;
only diffs are applied. The script uses `az group create` (no-ops if the RG
exists) and `az deployment group create` (incremental mode by default).

### Resource providers

Before the first deployment on a fresh subscription, the relevant namespaces must
be registered: `Microsoft.Web`, `Microsoft.Sql`, `Microsoft.Storage`,
`Microsoft.Insights`, `Microsoft.OperationalInsights`. Registration is
asynchronous (typically 1-2 minutes). `az provider register --namespace Microsoft.Web`.

---

## Gotchas we actually hit

**1. Free-subscription App Service quota is region-specific, not account-wide.**
Deploying an F1 Linux plan failed with `SubscriptionIsOverQuotaForSku` in eastus2,
eastus, AND westus2 — all returned "Total VMs: 0." centralus had quota. This is a
per-region free-tier allocation, not a spending limit. The diagnostic command:
`az appservice plan create -g <rg> -n probe --sku F1 --is-linux -l <region>` — if
it fails immediately, that region has no quota.

**2. Azure Static Web Apps CLI upload blocked by network proxy.**
The `StaticSitesClient` binary (invoked by `swa deploy`) exits with "An unknown
exception has occurred" after obtaining a DeploymentId. `az rest` to
`management.azure.com` returns a mangled proxy 400. The workaround: drop SWA, serve
the Angular SPA from the API App Service via `wwwroot` + `MapFallbackToFile`.
On an unproxied machine (typical CI runner) SWA works fine.

**3. `zip` not installed; fell back to `python3 shutil.make_archive`.**
`deploy.sh` (lines 67-68) tests for `zip` first and falls back to
`python3 -c "import shutil;shutil.make_archive(...)"`. This is the portable
pattern for environments where you cannot `apt-get install zip`.

**4. Resource provider registration delay.**
On a fresh subscription, `az deployment group create` fails with
`MissingSubscriptionRegistration` if the relevant namespaces aren't registered.
The fix: `az provider register --namespace Microsoft.Web` (and similarly for
`.Sql`, `.Storage`, `.Insights`, `.OperationalInsights`). Wait ~2 minutes and
re-run.

**5. Functions cannot share an F1 plan.**
Consumption Functions require a `Y1 Dynamic` plan. Attempting to put a Function
App on an F1 `serverfarms` resource fails. The Bicep provisions two separate plan
resources (`plan` for F1 App Service, `funcPlan` for Y1 Dynamic).

**6. Managed-identity SQL grant is a data-plane operation; Bicep can't do it.**
`CREATE USER … FROM EXTERNAL PROVIDER` must be run once by the Entra admin against
the SQL database. `deploy.sh` detects a non-empty `sqlServerFqdn` output and
prints the exact SQL block. No Bicep change can automate this without a deployment
script or Azure SQL Action.

---

## Interview Q&A

**Q: Walk me through how you'd do a zero-downtime deployment on App Service.**

A: Use deployment slots (Standard plan or above). Deploy the new build to the
staging slot while production continues serving traffic. Run smoke tests or
integration tests against the staging slot's URL. Then
`az webapp deployment slot swap --slot staging --target-slot production` — Azure
atomically flips the routing. The previous production build is now in the staging
slot, available for immediate rollback with another swap. The HFC demo runs on F1
(no slots) for cost, but I'd add a `--sku S1` parameter and a staging slot resource
in the Bicep for a real workload.

**Q: Bicep vs Terraform — how do you choose?**

A: Bicep is the right choice for Azure-only shops: it's the native DSL, no state
file to manage, first-class `what-if` support, and tight integration with Azure
RBAC and policy. Terraform is right when you need one IaC tool across multiple
clouds (AWS, GCP, Azure), already have Terraform modules and state management
standardised, or need providers that don't exist in Bicep. In the HFC demo I chose
Bicep because the entire stack is Azure and I wanted `az deployment group what-if`
for safe iterative deployments.

**Q: How does managed identity remove secrets from your config?**

A: System-assigned managed identity gives the App Service an Entra service
principal with no client secret. The runtime picks up the identity automatically
via `DefaultAzureCredential` (in the Azure SDK) or via
`Authentication=Active Directory Default` in the SQL connection string. There are
no passwords in `appSettings`, no key rotation scheduled, and the identity is
deleted automatically when the resource is deleted. In the Bicep I declare
`identity: { type: 'SystemAssigned' }` on both the API and Function App; the
principal IDs are emitted as outputs so a post-deploy script can grant
SQL / Key Vault / Storage roles.

**Q: You hit `SubscriptionIsOverQuotaForSku` on F1. How did you debug it?**

A: The error message said "Total VMs: 0," which I initially misread as a spending
limit issue. It's actually a per-region free-tier quota. I probed regions by
attempting a throwaway plan create (`az appservice plan create -g probe-rg -n probe
--sku F1 --is-linux -l <region>`) until one succeeded. centralus had quota;
eastus2, eastus, and westus2 all had quota=0. I encoded that as
`LOCATION=${LOCATION:-centralus}` in `deploy.sh` with a comment explaining it's
not a spending limit.

**Q: How does App Insights correlate a request across App Service and Functions?**

A: Both resources share the same `APPLICATIONINSIGHTS_CONNECTION_STRING`. When the
API starts an HTTP call that triggers a Durable Function, the SDK propagates a W3C
`traceparent` header. App Insights reads that header and assigns the same
`operation_Id` to the spans on both sides. In the portal, Transaction Search or
the App Map shows the full call chain — API request → dependency call to Functions
→ orchestration activities — under one operation ID. The Log Analytics KQL tables
(`requests`, `dependencies`, `traces`) all carry `operation_Id` for cross-table
joins.

**Q: What is Bicep's `what-if` and when would you use it?**

A: `az deployment group what-if -g <rg> --template-file main.bicep` runs a
server-side comparison of the desired state against the current ARM state and
returns a colour-coded diff (create / modify / delete / no-change) without making
any changes. I use it before every deployment that touches existing resources —
especially to confirm a parameter change (like flipping `deploySql` from false to
true) adds the expected new resources and doesn't accidentally delete or modify
something unintended. It's the Bicep equivalent of `terraform plan`.

**Q: Why does `/home` persistence matter on App Service, and what are its limits?**

A: On Linux App Service, `/home` is a shared network mount (SMB) that persists
across worker restarts, slot swaps, and platform upgrades — unlike the container's
ephemeral local filesystem. The HFC demo stores its SQLite file at
`/home/hfc-demo.db` so the database survives a cold start. The limit: the `/home`
share is per-app-service, but all instances of a scaled-out app share the same
mount. SQLite is not designed for concurrent writers over a network share, so this
pattern breaks at scale-out. The solution is to switch to a proper Azure-managed
database (the `deploySql=true` path in the Bicep).

**Q: How does the Consumption plan for Functions differ from the App Service F1
plan, and why can't they share compute?**

A: F1 is a fixed shared-compute plan: one or more apps run on a shared VM; you pay
nothing but the worker is always provisioned (even if idle). Consumption (Y1
Dynamic) is a serverless plan: Azure allocates compute per invocation, billing per
execution and GB-seconds, and scales to zero when idle. Functions on a Consumption
plan cannot run on an F1 `serverfarms` resource because Consumption requires
Dynamic allocation infrastructure. In the Bicep I provision two `serverfarms`
resources: one `F1 / Free` for the API and one `Y1 / Dynamic` for Functions.

**Q: Walk me through the zip deploy process.**

A: `dotnet publish` compiles and stages the application output (binaries, static
assets including `wwwroot`) to a folder. That folder is zipped (using `zip` or
`python3 shutil.make_archive` as a fallback). `az webapp deploy -g <rg> -n
<app-name> --src-path api.zip --type zip` uploads the archive; App Service
extracts it into the app's content root (`/home/site/wwwroot` on Linux) and
restarts the worker. For Functions, `func azure functionapp publish` does its own
build and push via the Core Tools, which handles the Functions-specific deployment
packaging. Both paths use the App Service Kudu deployment engine under the hood.

**Q: How would you add CI/CD to this project?**

A: In GitHub Actions (or Azure DevOps): on push to `main`, the pipeline would (1)
run `dotnet test` and `ng test --watch=false`, (2) `dotnet publish` the API and
build the Angular bundle into `wwwroot`, (3) zip the publish output, (4) use `az
webapp deploy` with a service principal or federated credential (OIDC), and (5)
`func azure functionapp publish` for Functions. For zero-downtime, add a staging
slot: deploy to staging, run smoke tests against the staging URL, then swap to
production. Secrets are stored in GitHub Actions secrets or Azure Key Vault,
referenced via managed identity — no client secrets in YAML files.
