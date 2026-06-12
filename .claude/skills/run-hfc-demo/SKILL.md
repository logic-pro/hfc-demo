---
name: run-hfc-demo
description: Build, run, drive, and screenshot the HFC multi-tenant scheduling demo (ASP.NET Core API + Angular SPA + Azure Durable Functions). Use when asked to run, start, launch, build, test, smoke-test, screenshot, or deploy the HFC demo / hfc-demo app, or to drive its booking/deposit/orchestration flows.
---

# Run the HFC scheduling demo

A multi-tenant franchise-scheduling demo on the role's stack: **ASP.NET Core 9 API
+ EF Core (SQLite local) + Angular 20 SPA + Azure Durable Functions**, with Bicep
IaC. It showcases tenant isolation (EF global query filter), double-booking
prevention (optimistic concurrency → 409), payment idempotency (`Idempotency-Key`),
and a crash-safe post-booking orchestration.

**All paths below are relative to `hfc-demo/`.** The three pieces run as separate
processes; drivers live in [e2e/](../../e2e/). Verified on Linux/WSL2, .NET 9,
Node 24.

## Prerequisites (exact, what was installed here)

```bash
# .NET 9 SDK, Node 24, Azure CLI, Docker already present.
npm i -g azure-functions-core-tools@4 azurite     # Durable Functions local host + storage emulator
cd hfc-demo && npm i -D playwright                 # e2e driver dependency (repo-root package.json)
npx playwright install chromium                    # browser binary
```

Chromium needs OS libs that normally require `sudo apt-get`. **Without root**, the
4 missing libs were extracted from `.deb`s into a local dir (see Gotchas); the e2e
commands below prefix `LD_LIBRARY_PATH` accordingly.

## Run — API (port 5180)

```bash
cd hfc-demo/api
dotnet build
rm -f hfc-demo.db hfc-demo.db-wal hfc-demo.db-shm   # start from a clean seeded DB
dotnet run --no-build --no-launch-profile --urls http://localhost:5180
```

Swagger at `http://localhost:5180/swagger`. The DB auto-seeds 8 brands + territories
+ open slots on first boot.

## Run — Angular SPA (port 4200)

```bash
cd hfc-demo/web
npx ng serve --port 4200          # dev server; SPA calls the API on :5180 (CORS open)
```

Open `http://localhost:4200`, pick a brand chip (sets the tenant), book a slot, pay
the deposit.

## Drive + screenshot (agent path — the e2e driver)

With API (:5180) and `ng serve` (:4200) both up, this drives a real flow
(select brand → book → pay deposit) and writes PNGs:

```bash
cd hfc-demo
LD_LIBRARY_PATH=/tmp/chromedeps/root/usr/lib/x86_64-linux-gnu \
  node e2e/drive.mjs "Budget Blinds" /tmp/hfc-shots
```

Output: `/tmp/hfc-shots/hfc-1-schedule.png` and `hfc-2-booked-paid.png`. Pass any
brand name as arg 1 to demo a different tenant. Exit 0 = clean; exit 2 = browser
console errors (it prints them).

## Verify the API guarantees (smoke test)

```bash
cd hfc-demo && ./e2e/smoke-api.sh      # asserts 8 brands, 400 gating, 409 double-book,
                                       # idempotent deposit, cross-tenant isolation
```

## Run — Azure Durable Functions (ports 10000-10002 + 7071)

The post-booking orchestration: confirm → reminder → await `DepositPaid` event OR
durable-timer timeout → finalize/expire.

```bash
# 1. storage emulator
azurite --silent --location /tmp/azurite --blobPort 10000 --queuePort 10001 --tablePort 10002 &
# 2. functions host (from the functions/ dir)
cd hfc-demo && func start --port 7071
```

Drive it — start an orchestration, then either raise the deposit event or let it
time out. The start response returns `StatusQueryGetUri` / `SendEventPostUri` (with
the required auth `code`) — use those, not hand-built URLs:

```bash
F=http://localhost:7071
RESP=$(curl -s -X POST "$F/api/bookings/budget-blinds/2/workflow?timeoutSeconds=60")
STATUS=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['StatusQueryGetUri'])")
EVENT=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['SendEventPostUri'].replace('{eventName}','DepositPaid'))")
curl -s -X POST "$EVENT" -H 'Content-Type: application/json' -d '5000'   # pay -> finalizes
curl -s "$STATUS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['runtimeStatus'],d.get('output'))"
# Completed finalized   (or, with a short timeoutSeconds and no event raised: Completed expired)
```

## Deploy to Azure — DONE (live)

Deployed to the free subscription `logic.pro@consultant.com`, RG `hfc-demo-rg`,
region **centralus**, via [infra/deploy.sh](../../infra/deploy.sh):

- **App (SPA + API):** https://hfcdemo-api-pkz2lysbqoabq.azurewebsites.net (Swagger at `/swagger`)
- **Durable Functions:** https://hfcdemo-func-pkz2lysbqoabq.azurewebsites.net

Verified live: `API_BASE=https://hfcdemo-api-pkz2lysbqoabq.azurewebsites.net ./e2e/smoke-api.sh`
→ 7/7; cloud orchestration `Running → DepositPaid → finalized`; SPA screenshotted.

Re-deploy / deploy fresh (needs your `az login`):

```bash
az login
az bicep build --file infra/main.bicep --outfile /tmp/main.json   # validate
LOCATION=centralus ./infra/deploy.sh                               # provision + push API(+SPA) + Functions
```

`deploy.sh` builds the Angular prod bundle **same-origin**, copies it into
`api/wwwroot`, and the API App Service serves both SPA and API from one origin.
Pass `deploySql=true` to the bicep for the Azure SQL + managed-identity pass (it
prints the one-time SQL `CREATE USER … FROM EXTERNAL PROVIDER` grant). Cost:
effectively $0 on free tiers — see [DEPLOY.md](../../DEPLOY.md).

## Gotchas (things that actually bit, in this container)

- **`dotnet run` ignores `--urls` / `ASPNETCORE_URLS`** if `Properties/launchSettings.json`
  has an `applicationUrl` (it booted on 5171, not the port I asked for). Use
  `--no-launch-profile` to force the URL.
- **Two API instances over one SQLite file → `SQLite Error 10: disk I/O error`** on
  `EnsureCreated`/WAL. The first instance wasn't actually killed (see next). Always
  confirm nothing is on :5180 before launching, and delete stale `-wal`/`-shm` files.
- **`pkill -f api.dll` misses the server** — the running process is named `api`, not
  `api.dll`. Kill by PID (`ss -ltnp | grep :5180`) or `pkill -9 -x api`.
- **Playwright Chromium fails with `libnspr4.so: cannot open shared object file`** and
  `playwright install-deps` needs sudo (unavailable). Fix without root:
  ```bash
  mkdir -p /tmp/chromedeps && cd /tmp/chromedeps
  apt-get download libnss3 libnspr4 libasound2t64     # download individually; libasound2 has no candidate
  for d in *.deb; do dpkg-deb -x "$d" root; done
  # then prefix runs with: LD_LIBRARY_PATH=/tmp/chromedeps/root/usr/lib/x86_64-linux-gnu
  ```
  Launch the browser with `--no-sandbox` (the driver already does).
- **`ng serve` snapshots `public/` at startup** — adding `public/api-base.js` after
  the server is running 404s (and the `<script>` in index.html logs a MIME error).
  Restart `ng serve` after creating it.
- **Durable management endpoints need the `code` query param.** Don't hand-build
  `/runtime/webhooks/durabletask/...` URLs — use the URIs returned by the start call.
- **Functions start response JSON is PascalCase** (`Id`, `StatusQueryGetUri`), not
  camelCase.
- **`@angular/cli@18` rejects Node 24** ("not supported"). Scaffold with `@angular/cli@20`.
- **Telemetry packages** the Functions template adds (Azure Monitor / OpenTelemetry)
  try to export at startup with no connection string — removed from `functions.csproj`
  for clean local runs; wired in Azure via `APPLICATIONINSIGHTS_CONNECTION_STRING`.
- **Free-subscription App Service quota is region-specific and often 0.** Deploying
  an F1 plan failed with `SubscriptionIsOverQuotaForSku` / "Total VMs: 0" in
  eastus2, eastus, AND westus2 — but **centralus had quota**. It was *not* a
  spending-limit issue. If a deploy hits this, probe regions:
  `az appservice plan create -g <rg> -n probe --sku F1 --is-linux -l <region>`.
- **Azure Static Web Apps CLI upload was blocked by a network proxy** in this
  environment (the `StaticSitesClient` binary runs and gets a DeploymentId, then
  dies with "An unknown exception has occurred"; `az rest` to management.azure.com
  also returned a mangled proxy 400). Workaround used: **serve the SPA from the API
  App Service** (build same-origin → copy to `api/wwwroot` → `MapFallbackToFile`),
  which uses the working zip-deploy path and needs no SWA. From an unproxied
  machine the SWA path in git history also works.
- **`zip` isn't installed here** — build the deploy zip with
  `python3 -c "import shutil;shutil.make_archive('api/api','zip','api/publish')"`.
- **Fresh subscriptions need resource providers registered** (Microsoft.Web, .Sql,
  .Storage, .Insights, .OperationalInsights) — `az provider register --namespace …`;
  takes a couple minutes before the first deploy.

## Troubleshooting

- API `disk I/O error` on start → another process holds `hfc-demo.db`; kill it
  (`pkill -9 -x api`) and `rm -f hfc-demo.db*`.
- `func start` shows no functions → run it from `hfc-demo/functions/` (or repo root;
  it auto-discovers the csproj), and make sure Azurite is up first.
- e2e exits 2 with a `404 api-base.js` console error → restart `ng serve` (see Gotchas).
- SPA loads but brand list is empty → the API isn't on :5180, or you opened the
  prod build without `api-base.js` pointing at a reachable API.
