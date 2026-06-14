# HFC demo — interview prep & docs

Study material for the Home Franchise Concepts (.NET/Azure/Angular) interview,
grounded in the actual deployed demo. Each tech doc follows the same shape:
*what it is → how we use it here → why we chose it → core concepts → real gotchas
→ interview Q&A.*

## Start here
- **[ROADMAP.md](../ROADMAP.md)** — the reviewed feature roadmap **and** the
  deadline-driven 1-week demo plan (§0).
- **[decisions.md](decisions.md)** — ADRs: *why* every technical choice was made,
  with the trade-off and what would make us revisit. Read this before the interview.

## Per-technology (in [tech/](tech/))
| Doc | Covers |
|---|---|
| [aspnet-core.md](tech/aspnet-core.md) | Minimal APIs, middleware pipeline, DI lifetimes, results, SPA hosting |
| [ef-core.md](tech/ef-core.md) | Query filters, optimistic concurrency, EnsureCreated vs migrations, projections |
| [angular.md](tech/angular.md) | Standalone components, signals, RxJS, functional interceptors, control flow |
| [durable-functions.md](tech/durable-functions.md) | Orchestrator/activity, determinism & replay, timers, external events |
| [azure-hosting-and-devops.md](tech/azure-hosting-and-devops.md) | App Service, Bicep, deploy, App Insights, the real deploy gotchas |
| [azure-sql-identity-and-auth.md](tech/azure-sql-identity-and-auth.md) | Azure SQL serverless, managed identity, Entra/AD B2C, OAuth/OIDC |
| [multitenancy-concurrency-idempotency.md](tech/multitenancy-concurrency-idempotency.md) | The cross-cutting correctness patterns (most-probed) |

## Architecture (in [architecture/](architecture/))
- [enterprise-jmfamily.md](architecture/enterprise-jmfamily.md) — how this scales to
  the JM Family conglomerate (federated platform, org-hierarchy/closure-table, CDP,
  event bus). The "architect at enterprise scale" talking point.

## How to study
1. Drill [decisions.md](decisions.md) — be able to give the *trade-off* for every choice.
2. One tech doc per session; cover the answer, say it aloud, check the Q&A.
3. Rehearse the 5-min demo script in [ROADMAP §0](../ROADMAP.md).
4. Pre-load the two questions you *know* are coming: "the tenant header is insecure"
   (→ token claim, [decisions ADR-05](decisions.md)) and "how would you scale this to
   the whole enterprise" (→ [enterprise-jmfamily.md](architecture/enterprise-jmfamily.md)).
