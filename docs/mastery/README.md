# HFC Role Mastery — Technical Interview Study Set

Study-grade docs for the **Senior Full Stack Cloud Developer** role, grounded in this repo
(`hfc-demo`). Every claim maps to real code you can open and defend. Depth over breadth.

## How to use this
- Read the module deep-dives in order for a full pass; hit the **cheat sheet** for day-of recall.
- Each module ends with **flashcards** (spaced repetition) + **mock Q&A with follow-ups** (rehearsal).
- The interviewer probes where multi-tenant franchise platforms *break* — those are starred ⭐.

## The 10 modules
| # | Module | Anchor files in this repo |
|---|--------|---------------------------|
| ⭐ M1 | [Multi-tenant SaaS architecture](M1-multitenancy.md) | `api/Auth.cs`, `api/AppDb.cs` |
| M2 | [ASP.NET Core 9 backend](M2-aspnetcore-backend.md) | `api/Program.cs`, `api/Endpoints/*` |
| M3 | [API contracts (OpenAPI/ProblemDetails)](M3-api-contracts.md) | `docs/dashboard/CONTRACT.md`, Swagger |
| ⭐ M4 | [Data modeling (EF Core + hierarchy)](M4-data-modeling-efcore.md) | `api/AppDb.cs`, `api/Domain.cs`, `api/ReadModel.cs` |
| ⭐ M5 | [RBAC: brand→region→territory](M5-rbac-hierarchy.md) | `api/Auth.cs`, `api/Dashboard/DashboardScope.cs` |
| M6 | [Angular 20 SPA + view-models](M6-angular-spa.md) | `web/src/app/*` (interceptor, login, dashboard) |
| ⭐ M7 | [BI read models + provenance](M7-bi-readmodels.md) | `api/Rollup.cs`, `api/ReadModel.cs`, `api/Dashboard/*` |
| ⭐ M8 | [Azure delivery + Durable Functions](M8-azure-durable.md) | `functions/*`, `infra/main.bicep`, `infra/deploy.sh` |
| M9 | [CI/CD + production readiness](M9-cicd-prod.md) | `.github/workflows/*`, `infra/deploy.sh` |
| ⭐ M10 | [Reliability + integrations (concurrency, idempotency, Stripe/Twilio)](M10-reliability-integrations.md) | `api/Endpoints/BookingEndpoints.cs` |

## The six questions interviewers always ask (master cold)
1. How do you guarantee tenant A never sees tenant B's rows? → M1, M4
2. A region manager sees their region's territories but not others — model the claim + query. → M5
3. Why not query operational tables for the dashboard? → M7
4. Why Durable Functions over a chained queue? → M8
5. Booking → deposit: how is it idempotent + crash-safe? → M10, M8
6. How do you evolve the API without breaking franchisee integrations? → M3

See also: [CHEATSHEET.md](CHEATSHEET.md) (one-page fast recall).
