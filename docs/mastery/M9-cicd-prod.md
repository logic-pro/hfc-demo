# M9 — CI/CD + Production Readiness

> Anchor files: `.github/workflows/ci.yml`, `.github/workflows/post-deploy-e2e.yml`, `.github/workflows/screenshots.yml`, `e2e/smoke-api.sh`, `infra/deploy.sh`
> Cross-link: [[M8-azure-durable]] (the deploy itself — Bicep, App Service, Durable Functions, managed identity)

This module is about the *machinery that decides what is allowed to merge and ship*, and how we prove a deployment is actually alive — not just that the build compiled on someone's laptop.

---

## 1. Mental model

There are **two distinct gates**, and conflating them is the classic CI/CD mistake:

| Gate | Trigger | Runs against | Question it answers |
|------|---------|--------------|---------------------|
| **Pre-merge CI** (`ci.yml`) | every `pull_request` + `push` to `main` | a *fresh, clean runner* | "Does this change integrate cleanly — build, test, SPA, smoke — on a machine that has none of my local state?" |
| **Post-deploy E2E** (`post-deploy-e2e.yml`) | `workflow_dispatch` (manual / chained from `infra/deploy.sh`) | the **live deployed URL** | "Is the thing we actually shipped serving real traffic correctly through a real browser?" |

The mental shift to internalize: **CI is not a convenience that runs your tests for you. CI is the authority.** It is the *only* environment whose green light is trusted, because it is the only environment that is clean, reproducible, and identical for every contributor. Your laptop is a liar — it has a warm SQLite file, cached `node_modules`, a `.NET` SDK pinned to whatever you happened to install, and uncommitted files. CI has none of that.

Pipeline shape end to end:

```
PR opened ──► ci.yml (build API · build Functions · test · build SPA · smoke)
                   │ green?
                   ▼
            branch protection + auto-merge ──► merge to main
                                                     │
                                          YOU run infra/deploy.sh (your Azure creds)
                                                     │ Bicep ► zip-deploy API+SPA ► publish Functions
                                                     ▼
                                          /health gate (60×10s) must return 200
                                                     │
                                          deploy.sh dispatches post-deploy-e2e.yml
                                                     ▼
                                   Playwright + smoke against the LIVE url ──► screenshots artifact
```

---

## 2. The pre-merge pipeline (`ci.yml`) — the single green gate

One job, `build-test`, named **`build · test · web · smoke`** (`ci.yml:18-19`). Its whole reason to exist is stated at the top of the file:

> ```yaml
> # Green-gate: a PR cannot merge red. Builds the API, the Durable Functions
> # project, runs the test suite, AOT-builds the Angular SPA, and smoke-tests the
> # running API's tenancy / concurrency / idempotency guarantees. Any non-zero
> # step fails the job.
> ```
> — `ci.yml:3-6`

Triggers on both PR and push to main, and cancels superseded runs to save minutes:

> ```yaml
> on:
>   pull_request:
>   push:
>     branches: [main]
> concurrency:
>   group: ci-${{ github.ref }}
>   cancel-in-progress: true
> ```
> — `ci.yml:7-15`

The four real pieces of work, in order:

1. **Build API** — `dotnet build api/api.csproj -c Release --nologo` (`ci.yml:31-32`)
2. **Build Functions** — `dotnet build functions/functions.csproj -c Release --nologo` (`ci.yml:34-35`). The Durable Functions project ([[M8-azure-durable]]) is compiled *in the same gate* so a contract change in the API that breaks the orchestrator reddens the PR.
3. **Test** — `dotnet test tests/HfcDemo.Tests.csproj -c Release --nologo` (`ci.yml:37-38`)
4. **Build SPA (AOT)** — `npm ci && npm run build` in `web/`, on Node 20 with npm cache keyed to `web/package-lock.json` (`ci.yml:41-52`). AOT (ahead-of-time) build is the *production* Angular build — it catches template type errors that `ng serve` would let slide.

Then the **smoke step**, which is the cleverest part of the gate. It boots the *real* API and runs the curl suite against it:

> ```yaml
> - name: Smoke-test API
>   env:
>     ASPNETCORE_ENVIRONMENT: Development
>   run: |
>     rm -f api/hfc-demo.db
>     dotnet run --project api/api.csproj -c Release --no-launch-profile \
>       --urls http://localhost:5180 &
>     API_PID=$!
>     # Wait up to ~60s for the API to come up (untenanted /api/brands).
>     for i in $(seq 1 60); do
>       if curl -sf http://localhost:5180/api/brands >/dev/null 2>&1; then
>         echo "API is up after ${i}s"; break
>       fi
>       if ! kill -0 "$API_PID" 2>/dev/null; then
>         echo "API process exited before becoming ready"; exit 1
>       fi
>       sleep 1
>     done
>     set +e
>     API_BASE=http://localhost:5180 ./e2e/smoke-api.sh
>     rc=$?
>     set -e
>     kill "$API_PID" 2>/dev/null || true
>     exit $rc
> ```
> — `ci.yml:59-83`

Two details worth being able to defend cold:

- **`ASPNETCORE_ENVIRONMENT: Development` is mandatory** because the smoke script logs in via `/api/dev/token`, which is gated to Development and *never ships to prod* (`ci.yml:55-58`). This is the dev-login stand-in for B2C/Entra — see `smoke-api.sh:14-16`.
- **`rm -f api/hfc-demo.db`** guarantees a clean schema: a fresh runner has no DB, so EF `EnsureCreated()` builds the full schema from scratch; the `rm` is belt-and-suspenders against a cached file (`ci.yml:56-58`).
- The readiness loop also watches the PID (`kill -0`) so a crash-on-boot fails *fast* instead of timing out for 60s.

### What the smoke actually asserts (`e2e/smoke-api.sh`)

This is not a "200 OK and move on" smoke. It asserts the platform's *correctness invariants* — the things HFC cares about most. `chk` exits non-zero on the first mismatch (`smoke-api.sh:11`):

- **Multi-tenancy / isolation** — same-brand sibling franchisee cannot book Irvine's slot: `"other franchisee can't book this slot -> 404"` (`smoke-api.sh:50`); and sees zero of its appointments: `"other franchisee sees 0 of budget-blinds-irvine's appointments"` (`smoke-api.sh:63`).
- **Optimistic concurrency** — double-booking the same slot returns 409: `"re-book same slot -> 409"` (`smoke-api.sh:47`).
- **Idempotency** — replaying a deposit with the same `Idempotency-Key` does not double-charge (`smoke-api.sh:52-56`), and a *missing* key is a 400 (`smoke-api.sh:59`).
- **Fail-closed auth + RBAC** — no token → 401 (`smoke-api.sh:34`); franchisee hitting corporate watchlist/map → 403 (`smoke-api.sh:100-101`); cross-tenant territory read → 403 (`smoke-api.sh:116, 128`); unknown id → 404, never another tenant's row (`smoke-api.sh:104`).

So the green gate is literally enforcing the contracts taught in M1/M5/M10. **A PR cannot turn an isolation leak green.**

---

## 3. CI as the SOLE merge authority — the lesson

> **local-green ≠ integrated-green.**

The painful, recurring failure: a contributor runs the tests locally, sees green, merges (or worse, an agent merges its own branch), and `main` goes red minutes later. *Why?* Because "green locally" is green against **your machine's accumulated state**:

- a warm `hfc-demo.db` with seed rows a fresh runner won't have;
- a `web/node_modules` from three branches ago that still resolves an import you deleted;
- an SDK version difference (`9.x` is pinned in CI, `ci.yml:29`; your box may differ);
- uncommitted files that make the build pass *for you* and nobody else.

CI removes every one of those variables by starting from `actions/checkout@v5` on a blank `ubuntu-latest`. That is *the entire point*. So the policy is: **nothing merges unless `ci.yml` is green, and CI's green is the only green that counts.** Humans (and agents) do not get to vouch "it works on mine." If you didn't push it and let the clean runner build it, it doesn't exist.

This is why the smoke runs in CI and not just locally: the most expensive bugs (tenant leaks, double-charges) are exactly the ones that *look* fine locally because your single-user test session never exercises the cross-tenant path. CI runs the multi-franchisee smoke every time.

---

## 4. Branch protection + auto-merge (and the "strict" relaxation)

The intended GitHub config that makes `ci.yml` *binding*:

- **Branch protection on `main`** requiring the `build · test · web · smoke` status check to pass before merge.
- **Auto-merge enabled** on the PR: you approve once, and GitHub merges automatically the instant CI goes green — no babysitting the tab.

### Why we relaxed "Require branches to be up to date before merging" (strict mode)

"Strict" status checks mean a PR must be rebased onto the *current* tip of `main` before its green check is accepted. On a busy shared trunk that gives you the strongest guarantee — every merge was tested against exactly what it's landing on. But it also serializes everything: each merge invalidates every other open PR's check, forcing a re-run, and you get the "update branch → wait for CI → someone else merged → update again" treadmill.

For a **user-owned demo repo** with effectively one merge driver and low concurrent-PR pressure, that treadmill is pure cost with almost no risk: there isn't a fleet of PRs racing into `main`, so the window where a non-strict merge could integrate against stale code is tiny. We **relaxed strict** so a green PR auto-merges immediately instead of re-running CI against a `main` that nobody else just moved. The required *check* stays; only the *up-to-date* requirement is dropped. (Note the `push: branches: [main]` trigger at `ci.yml:9-10` — even with strict off, CI re-runs *on* `main` after the merge, so a bad non-strict interleave still reddens the trunk and is caught immediately rather than silently.)

### Trade-offs: how do you serialize merges?

| Strategy | What it guarantees | Cost | Best when |
|----------|--------------------|------|-----------|
| **Merge queue** | Each PR is tested *as if merged*, in order, batched | Infra/setup; queue latency | High PR volume, many contributors racing trunk |
| **Strict + auto-merge** | Every merge was green against the exact current `main` | CI re-run treadmill; serializes | Medium volume, strong correctness need |
| **Non-strict + auto-merge** (← this repo) | PR green on a recent `main`; post-merge CI catches drift | Small stale-integration window | Low volume / single driver / demo |
| **PM-conducted merges** (manual) | A human conductor rebases & lands each branch one at a time, runs the gate, merges only green | Human bottleneck; doesn't scale | Multi-worktree agent fleets where intent-level conflict resolution is needed |

The PM-conducted model is what the *worktree* setup uses when several agent lanes converge: a single conductor rebases each ready branch onto current `main`, resolves conflicts by *intent* (additive union, never revert the foundation), runs `ci.yml`'s gate, and merges only on green. It's the "merge queue, but a human/agent is the queue" — appropriate when conflicts need judgment, not just a green checkmark.

---

## 5. Post-deploy integration testing (`post-deploy-e2e.yml`)

CI proves the code integrates. It does **not** prove the *deployment* works — App Service config, managed-identity SQL login, same-origin SPA serving, cold start. That's a separate gate that runs Playwright in a real Chromium against the **live URL**:

> ```yaml
> # Integration test the LIVE deployment with Playwright + the API smoke suite.
> # This is the "run tests after a successful deploy" gate: point it at the deployed
> # URL and it drives the real app in a real Chromium, asserts, and uploads screenshots.
> ```
> — `post-deploy-e2e.yml:3-5`

It is `workflow_dispatch` with a `base_url` input (`post-deploy-e2e.yml:12-18`), so it can be run three ways — manually from the Actions tab, via `gh workflow run`, or **chained from the deploy script** (`post-deploy-e2e.yml:7-11`). The job:

1. **Waits for health** — polls `$BASE/health` up to 30× / 5s, fails the gate if it never returns 200 (`post-deploy-e2e.yml:37-43`).
2. **Re-runs the API smoke against the live deploy** — the *same* `e2e/smoke-api.sh`, now pointed at production: `API_BASE="$BASE" bash e2e/smoke-api.sh` (`post-deploy-e2e.yml:45-46`). So tenant isolation / concurrency / idempotency are re-asserted against the real Azure SQL, not the CI's SQLite.
3. **Runs the Playwright drivers** — every `e2e/drive-*.mjs` (`drive-dashboard`, `drive-franchisee`, `drive-intake`) against the live SPA+API, *failing the gate on any driver error* (`post-deploy-e2e.yml:48-57`):
   > ```yaml
   > WEB_URL="$BASE" API_BASE="$BASE" node "$d" "" /tmp/hfc-shots || { echo "::error::$d failed"; fail=1; }
   > ...
   > exit $fail   # a driver error fails the gate (real integration assertion)
   > ```
   > — `post-deploy-e2e.yml:54, 57`
4. **Uploads screenshots** as an artifact (`if: always()`, 14-day retention) so the run is *reviewable*, pass or fail (`post-deploy-e2e.yml:59-66`).

### `screenshots.yml` — the reviewable-artifact sibling

A near-twin that exists for a different reason: producing PNGs you can *look at*, on demand or whenever the app/drivers change (`push` to `main` on `e2e/**`, `web/**`, `api/**` — `screenshots.yml:8-12`). Two hard-won lessons are baked into its comments:

- **Why CI and not local:** "a real Chromium (with system libs) only exists on a CI runner, not in the local agent sandbox" (`screenshots.yml:5-7`) — it installs `--with-deps chromium` for `libnspr4`, `libnss3`, etc. (`screenshots.yml:29-33`).
- **Why same-origin:** it builds the SPA, copies it into `api/wwwroot`, and serves both from `:5180` because "Cross-origin :4200->:5180 was timing the drivers out; same-origin removes that failure mode entirely" (`screenshots.yml:38-45`). This mirrors exactly what `deploy.sh` does for production (step 4 below), so the screenshots reflect the real serving topology.

---

## 6. The deploy itself + DB migrations (`infra/deploy.sh`)

> **Claude can't `az login` for you** — *you* run `deploy.sh` with your Azure credentials (`deploy.sh:3-8`). This is intentional: the deploy needs an interactive human identity, and the SQL admin is bound to the signed-in user (Entra-only auth, no passwords — `deploy.sh:25-28`).

Sequence (the Bicep/App Service detail lives in [[M8-azure-durable]]):

1. SQL admin = signed-in Entra user; no SQL passwords anywhere (`deploy.sh:25-28`).
2. `az deployment group create` provisions ~10 resources from `main.bicep` (`deploy.sh:31-37`).
3. Grant the API's **managed identity** a SQL login via `CREATE USER ... FROM EXTERNAL PROVIDER` + `db_datareader`/`db_datawriter` (`deploy.sh:46-52`) — passwordless app→DB auth.
4. Build SPA **same-origin** and bundle into `api/wwwroot` so one App Service serves SPA *and* API (`deploy.sh:54-60`). Note `window.__API_BASE__=''` (`deploy.sh:57`) — empty base = same origin.
5. `dotnet publish` → zip → `az webapp deploy` (`deploy.sh:62-69`).
6. `func azure functionapp publish` for the Durable Functions (`deploy.sh:71-73`).
7. **Post-deploy health gate** — polls `/health` 60× / 10s; **`exit 1` if it never hits 200** (`deploy.sh:75-93`). "Don't declare success until the API answers /health" (`deploy.sh:75`).
8. **Self-verify** — if `gh` is authed, dispatches `post-deploy-e2e.yml` against the live host so *every deploy auto-verifies itself* (`deploy.sh:95-106`).

### DB migrations on deploy

In this demo the schema is created by **EF `EnsureCreated()`** on first boot against a fresh DB — visible in CI where `rm -f api/hfc-demo.db` then a clean run rebuilds the whole schema (`ci.yml:56-58`). That's appropriate for a demo, **not for production with real data** (`EnsureCreated` cannot evolve an existing schema and skips the migrations history table).

The production-grade answer to give in the interview: switch to **EF Core migrations** and apply them as an explicit, idempotent step in the deploy *before* the app starts taking traffic — either `dotnet ef database update` / a generated idempotent SQL script run as a deploy step, or a one-shot migrations job. Critical constraints for a live tenant DB: migrations must be **forward-only and backward-compatible** (expand-then-contract — add nullable column, backfill, deploy code, then later drop the old column) so the *old* app version keeps working during the rollout, and so a slot swap (next section) can roll back without a schema mismatch. The app's managed identity needs DDL rights only for the migration step, or you run migrations as the admin identity, not the runtime identity.

---

## 7. Deployment slots (concept)

App Service **deployment slots** are independently-addressable copies of the app (e.g. `staging`) that share the plan. The production-readiness play:

1. Deploy the new build to a **staging slot** (warm it up — App Service can route a tiny % or you hit it directly).
2. Run `post-deploy-e2e.yml` with `base_url` = the *staging slot's* URL. The workflow already takes an arbitrary URL (`post-deploy-e2e.yml:14-18`), so this is a config change, not new code.
3. **Swap** staging↔production. The swap also *pre-warms* the new instances, which directly defuses the cold-start failure mode (next section) — the slot is already running before it receives prod traffic.
4. **Roll back = swap back** — instant, because the previous build is still sitting in the other slot.

Slots also let you bind slot-specific app settings (e.g. don't carry a staging connection string into prod on swap — mark them "deployment slot settings" so they stick to the slot). This is the missing piece between today's "deploy straight to prod then health-gate" (`deploy.sh:69, 80-93`) and a zero-downtime release: test in staging, swap when green.

---

## 8. Observability — Application Insights

Production readiness is also "when it breaks at 2am, can you see why?" The Azure answer is **Application Insights** (provisioned in Bicep — see [[M8-azure-durable]]). What it buys you and how it ties to this module:

- **Request/dependency telemetry + failures** — every HTTP request, every SQL/dependency call, with latency and result code. The `/health` endpoint the deploy gate polls (`deploy.sh:80-93`) and the e2e health wait (`post-deploy-e2e.yml:37-43`) become *trends*, not single pings.
- **Live Metrics + smart detection** — spot a cold-start latency spike or a sudden 5xx cluster right after a deploy/swap.
- **Distributed tracing across the orchestration** — correlate an API booking request → the Durable Functions deposit orchestration ([[M8-azure-durable]]) under one operation id, so an idempotency or retry bug is traceable end to end.
- **Structured logs / KQL** — query "all 409s by franchisee" or "deposits that retried" to confirm the very invariants the smoke asserts are holding *in production*, not just in CI.

The principle: the same correctness guarantees the smoke checks pre-merge (isolation, concurrency, idempotency) should be **observable in production** via App Insights. CI proves them once on clean state; App Insights proves they keep holding under real load.

---

## 9. Failure modes (and what catches them)

| Failure | Symptom | What catches it | Fix |
|---------|---------|-----------------|-----|
| **Green-locally PR that reddens `main`** | "passes on my machine," CI red | `ci.yml` on a *clean* runner; `rm -f` DB + `npm ci` remove local state (`ci.yml:48-58`) | Trust CI, not your box; never merge red |
| **Deleted import still resolves locally** | works for you, SPA build fails in CI | `npm ci` (clean install from lockfile) + AOT build (`ci.yml:48-52`) | Commit lockfile; let CI build SPA |
| **Cold start fails post-deploy checks** | first request after deploy times out; `/health` 000/503 | health gate polls 60×10s (`deploy.sh:82-92`) and e2e waits 30×5s (`post-deploy-e2e.yml:39-42`); `WEBSITES_CONTAINER_START_TIME_LIMIT=900` baked in Bicep (`deploy.sh:77-79`) | Generous warm-up window; **pre-warm via slot swap** (§7) to remove it entirely |
| **API crashes on boot in CI** | smoke hangs | PID watch `kill -0` fails fast (`ci.yml:73-75`) | Surfaces the crash in <60s |
| **Tenant-isolation regression** | cross-tenant read returns data | smoke 404/403 assertions, pre-merge *and* post-deploy (`smoke-api.sh:50, 63, 100-101, 116`) | Reddens the PR before merge |
| **Double-charge on deposit retry** | amount doubles | idempotency assertion (`smoke-api.sh:52-56`) | Reddens the PR |
| **Schema drift on prod data** | `EnsureCreated` won't evolve a live DB | nothing today (demo) | EF migrations, expand-then-contract (§6) |
| **Stale-integration window** (non-strict merge) | bad interleave on `main` | `push: [main]` CI re-run (`ci.yml:9-10`) | Re-enable strict or merge queue if PR volume rises |
| **Cross-origin driver timeouts** | Playwright drivers hang | same-origin serving in CI + deploy (`screenshots.yml:38-45`, `deploy.sh:54-60`) | Serve SPA from API `wwwroot` |

---

## 10. Interview defense — follow-ups & answers

**Q: Your CI is one job. Isn't a matrix / parallel jobs better?**
For this codebase, one serial job is *correct*: the steps are dependent (you can't smoke an API that didn't build) and the whole thing finishes fast on one runner, with `cancel-in-progress` killing superseded runs (`ci.yml:13-15`). I'd split into parallel jobs only when wall-clock becomes the bottleneck — e.g. lift the Angular build into its own job, or add an OS/runtime matrix if we shipped on multiple targets. Parallelism buys speed at the cost of more runner minutes and orchestration; I add it when the data says to, not preemptively.

**Q: Why run a curl smoke in CI when you have `dotnet test`?**
Unit/integration tests run *in-process* against test doubles; the smoke boots the **real** Kestrel host and exercises the actual HTTP edge — auth middleware, the `/api/dev/token` mint, optimistic-concurrency 409s, the `Idempotency-Key` header path. Those are integration seams that a `WebApplicationFactory` test can mock away. The smoke is the closest thing to "a real franchisee using the API" that runs on every PR, and it asserts the *business* invariants (isolation, no double-charge) that are the most expensive to get wrong (`smoke-api.sh:47, 50, 56`).

**Q: You relaxed strict branch protection — isn't that how `main` breaks?**
The required *check* is still mandatory; I only dropped "must be up to date before merge." On a single-driver demo repo the window where a non-strict merge integrates against stale code is tiny, and even if it happens, CI re-runs *on* `main` via the `push` trigger (`ci.yml:9-10`) and reddens immediately. The treadmill of strict (every other PR re-runs on each merge) costs real minutes for near-zero benefit here. If PR volume rose, I'd move straight to a **merge queue** — test-as-merged, in order — rather than back to plain strict.

**Q: A deploy "succeeded" but users see errors. How would your pipeline have caught it?**
Two ways it already does. The deploy script refuses to declare success until `/health` returns 200, polling for ten minutes and `exit 1` otherwise (`deploy.sh:80-93`) — so a dead app fails the deploy. Then it auto-dispatches `post-deploy-e2e.yml` (`deploy.sh:95-106`), which re-runs the tenant/concurrency/idempotency smoke *and* drives the SPA in a real Chromium against the live URL, failing on any driver error (`post-deploy-e2e.yml:45-57`). If something only breaks against real Azure SQL or the real browser, that gate catches it. The next hardening step is to point that gate at a **staging slot** and only swap to prod on green (§7).

**Q: Cold start keeps tripping your post-deploy health check. Fix it.**
Short term it's already mitigated: the health waits are generous (60×10s in deploy, 30×5s in e2e) and `WEBSITES_CONTAINER_START_TIME_LIMIT=900` is baked into Bicep (`deploy.sh:77-79`). The real fix is **deployment slots**: deploy to staging, let it warm, run e2e against it, then *swap* — the swap pre-warms instances so prod never serves a cold first request. Beyond that, an Always-On / minimum-instance plan keeps the app warm, and Application Insights Live Metrics tells me whether cold start is actually my latency problem or I'm chasing a ghost.

**Q: How do you ship a schema change to a live tenant database safely?**
Not `EnsureCreated` — that's the demo path. EF Core migrations, applied as an explicit idempotent deploy step before traffic flips, and authored **expand-then-contract**: add the new (nullable) column, deploy code that writes both, backfill, then a *later* migration drops the old shape. That keeps N-1 app versions working during rollout and lets a slot swap roll back without a schema mismatch. Migrations get DDL rights for that step only; the runtime managed identity stays `datareader`/`datawriter` (`deploy.sh:49-51`).

---

## Demo proof

- **The single green gate, on a clean runner:** `.github/workflows/ci.yml` — build API + Functions + test + AOT SPA + boot-and-smoke (`ci.yml:31-83`).
- **The invariants the gate enforces:** `e2e/smoke-api.sh` — 401/403/404 fail-closed RBAC, 409 concurrency, idempotent deposit (`smoke-api.sh:34, 47, 50, 56, 100-101, 116`).
- **Live-deploy integration gate:** `.github/workflows/post-deploy-e2e.yml` — health wait → smoke against live → Playwright drivers (gate-failing) → screenshots (`post-deploy-e2e.yml:37-66`).
- **Reviewable artifacts:** `.github/workflows/screenshots.yml` — same-origin Chromium PNGs (`screenshots.yml:38-76`).
- **The deploy with its own health gate + self-verify:** `infra/deploy.sh` (`deploy.sh:75-106`).

Run it yourself: open a PR and watch `build · test · web · smoke`; or locally `API_BASE=http://localhost:5180 ./e2e/smoke-api.sh` against a running API; after a deploy, `gh workflow run post-deploy-e2e.yml -f base_url=https://<app>.azurewebsites.net`.

---

## Flashcards

1. **Q:** What's the one-line lesson of M9? **A:** local-green ≠ integrated-green — CI on a clean runner is the *only* trusted green.
2. **Q:** Name the single CI job and its four+smoke steps. **A:** `build · test · web · smoke` — build API, build Functions, `dotnet test`, AOT SPA build, boot-and-smoke (`ci.yml:19, 31-83`).
3. **Q:** Why `ASPNETCORE_ENVIRONMENT=Development` in the smoke step? **A:** `/api/dev/token` (the login stand-in) is Dev-gated and never ships to prod (`ci.yml:55-58`).
4. **Q:** Why `rm -f api/hfc-demo.db` before the smoke? **A:** Force a clean schema via EF `EnsureCreated()`; belt-and-suspenders vs a cached DB (`ci.yml:56-58`).
5. **Q:** Three correctness invariants the smoke asserts. **A:** Tenant isolation (404/403), optimistic concurrency (409), idempotency (no double-charge; missing key → 400) (`smoke-api.sh:47, 50, 56, 59`).
6. **Q:** Pre-merge gate vs post-deploy gate — what does each test? **A:** Pre-merge: code integrates on a clean runner. Post-deploy: the *live* deployment serves correctly through a real browser.
7. **Q:** Why did we relax "strict" branch protection? **A:** Single-driver demo repo: tiny stale-integration window, and post-merge `push` CI catches drift — strict's re-run treadmill wasn't worth it (`ci.yml:9-10`).
8. **Q:** Four merge strategies, ranked by volume. **A:** Non-strict+auto-merge (low) → strict+auto-merge (medium) → merge queue (high) → PM-conducted (agent fleets needing intent-level conflict resolution).
9. **Q:** What does `deploy.sh` do before declaring success? **A:** Polls `/health` 60×10s; `exit 1` if never 200 (`deploy.sh:80-93`).
10. **Q:** How does every deploy verify itself? **A:** `deploy.sh` dispatches `post-deploy-e2e.yml` against the live host via `gh workflow run` (`deploy.sh:95-106`).
11. **Q:** Why is the SPA served same-origin from `api/wwwroot`? **A:** Cross-origin (:4200→:5180) timed out Playwright drivers; same-origin removes that failure mode (`screenshots.yml:38-45`, `deploy.sh:54-60`).
12. **Q:** Production DB migration approach (vs the demo)? **A:** EF Core migrations, expand-then-contract, applied as an idempotent pre-traffic step — not `EnsureCreated` (§6).
13. **Q:** What do deployment slots give you? **A:** Deploy→test→swap zero-downtime release, pre-warmed instances (kills cold start), instant rollback by swapping back.

## Mock Q&A

**1. "Walk me through what happens from PR to production."**
PR triggers `ci.yml` — one clean-runner job builds the API and Functions, runs tests, AOT-builds the SPA, then boots the real API and runs `smoke-api.sh` asserting isolation/concurrency/idempotency (`ci.yml:31-83`). Branch protection requires that check; auto-merge lands it on green. Then *I* run `infra/deploy.sh` with my Azure creds — Bicep provisions, SPA bundles same-origin into the API, zip-deploy, publish Functions, then a `/health` gate that fails the deploy if it never returns 200 (`deploy.sh:80-93`), and it auto-dispatches `post-deploy-e2e.yml` to drive the live app in Chromium (`deploy.sh:95-106`).
*Follow-up: "Where's the human in that loop?"* — One approval to enable auto-merge pre-merge, and the deploy itself (Azure creds are mine, not the agent's — `deploy.sh:3-8`). Everything else is gated by machines.

**2. "An agent merged its own branch and `main` went red. What went wrong and how do you prevent it?"**
It trusted local-green. The branch built on a machine with warm state — a seeded DB, stale `node_modules`, maybe uncommitted files — none of which exist on a fresh runner. Prevention is policy: nothing merges without the `build · test · web · smoke` check green, and CI's green is the *only* authority (`ci.yml:18-19`). The clean checkout + `npm ci` + `rm -f` DB strip exactly the local state that made it lie (`ci.yml:48-58`).
*Follow-up: "And if it still slips through?"* — The `push: [main]` trigger re-runs CI on the trunk itself (`ci.yml:9-10`), so a bad interleave reddens `main` immediately and visibly rather than silently shipping.

**3. "Your post-deploy check fails intermittently right after deploy. Diagnose."**
Almost certainly cold start — the first request after a fresh deploy pays JIT + DB-connection warm-up. The gates already tolerate it (health waits 60×10s in deploy, 30×5s in e2e — `deploy.sh:82-92`, `post-deploy-e2e.yml:39-42`) and `WEBSITES_CONTAINER_START_TIME_LIMIT=900` is set in Bicep (`deploy.sh:77-79`). The proper fix is deployment slots: warm the staging slot, run e2e against it, then swap so prod never serves cold. I'd confirm the diagnosis in App Insights Live Metrics before assuming.
*Follow-up: "Slots cost money and complexity — justify it."* — They're the difference between "deploy straight to prod and hope" and zero-downtime with instant rollback (swap back). For a real franchise platform taking bookings, a botched deploy = lost revenue and double-charges; the slot is cheap insurance and it doubles as the pre-warm that fixes the cold-start flake.

**4. "How do you evolve the database when real franchisee data is live?"**
Move off `EnsureCreated` (fine for the demo's fresh-DB-per-boot — `ci.yml:56-58`) to EF Core migrations, applied as an explicit idempotent deploy step before traffic flips. Author expand-then-contract so N-1 app versions keep working mid-rollout and a slot swap can roll back without a schema mismatch: add nullable column → deploy dual-writing code → backfill → later migration drops the old column.
*Follow-up: "Who has rights to run the DDL?"* — The runtime managed identity stays `datareader`/`datawriter` only (`deploy.sh:49-51`); the migration step runs with elevated/admin rights scoped to that step, so the live app never has DDL permissions.

**5. "Why two near-identical Playwright workflows (`post-deploy-e2e` and `screenshots`)?"**
Different jobs. `post-deploy-e2e` is a **gate against the live URL** — any driver failure fails the run (`post-deploy-e2e.yml:57`) — it's pass/fail integration verification of a deployment. `screenshots` is a **reviewable-artifact producer** that stands up its own API+SPA same-origin and uploads PNGs even on failure, so a human can *look* at the three surfaces (`screenshots.yml:38-76`); it runs on push when the app changes. One asserts, one shows.
*Follow-up: "Why can't you just take those screenshots locally?"* — A real Chromium with system libs (`libnspr4`, `libnss3`, …) only exists on a CI runner, not the local agent sandbox (`screenshots.yml:5-7, 29-33`).

---

*See also:* [[M8-azure-durable]] for the Bicep/App Service/managed-identity/Durable-Functions detail behind `deploy.sh`, and [[M10-reliability-integrations]] for the concurrency/idempotency code the smoke asserts.
