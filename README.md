# HFC Scheduling — multi-tenant demo

[![CI](https://github.com/logic-pro/hfc-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/logic-pro/hfc-demo/actions/workflows/ci.yml)

A portfolio demo built on the **Home Franchise Concepts** role stack
(ASP.NET Core / Azure / Angular). One platform serves 8 franchise brands; each
brand (tenant) sees only its own territories, slots, and appointments.

**Live on Azure:** https://hfcdemo-api-pkz2lysbqoabq.azurewebsites.net (SPA + API,
one App Service in centralus) · Durable Functions:
https://hfcdemo-func-pkz2lysbqoabq.azurewebsites.net

It's deliberately deep on three things an interviewer will probe, rather than wide:

1. **Multi-tenant isolation** — a single EF Core global query filter scopes every
   read/write to the current tenant; the tenant is resolved once in middleware.
   Fail-closed (no tenant → no rows). [api/AppDb.cs](api/AppDb.cs)
2. **Double-booking prevention** — optimistic concurrency on a slot version token;
   the losing writer gets **409**. [api/Program.cs](api/Program.cs)
3. **Idempotent payments** — a deposit carries an `Idempotency-Key`; a retried call
   never double-charges.
4. **Crash-safe orchestration** — an **Azure Durable Functions** post-booking workflow
   (confirm → reminder → await deposit *or* durable-timer timeout → finalize/expire).
   [functions/BookingWorkflow.cs](functions/BookingWorkflow.cs)

```
Angular 20 SPA ──HTTP (X-Tenant-Id)──▶ ASP.NET Core 9 API ──EF Core──▶ SQLite / Azure SQL
                                            │ starts orchestration
                                            ▼
                                   Durable Functions (confirm/reminder/await/finalize)
```

## Run it

See **[.claude/skills/run-hfc-demo/SKILL.md](.claude/skills/run-hfc-demo/SKILL.md)** —
the verified, copy-pasteable path to build, launch, drive, screenshot, and deploy
every piece. Quick start:

```bash
# API
cd api && dotnet run --no-launch-profile --urls http://localhost:5180
# SPA (new shell)
cd web && npx ng serve --port 4200
# smoke-test the API guarantees
./e2e/smoke-api.sh
```

## Layout

| Path | What |
|---|---|
| [api/](api/) | ASP.NET Core 9 + EF Core API (tenant filter, 409, idempotency) |
| [web/](web/) | Angular 20 SPA (signals, RxJS, tenant HTTP interceptor) |
| [functions/](functions/) | Durable Functions orchestration (.NET isolated) |
| [infra/](infra/) | Bicep IaC + `deploy.sh` |
| [e2e/](e2e/) | Playwright screenshot driver + API smoke test |

## Honest limitations (talk about these before you're asked)

- **Tenant comes from a header for the demo** — insecure. In production it comes from
  the authenticated token's claim; the query filter is unchanged, only the *source*
  of the tenant id moves. This is the #1 thing to volunteer.
- Row-level (shared-schema) isolation is the cheapest/least-isolated model; at HFC
  scale you'd argue **database-per-tenant + elastic pools**.
- Deposit idempotency is stored per-appointment, not in a dedicated idempotency-key
  table with the cached response.
