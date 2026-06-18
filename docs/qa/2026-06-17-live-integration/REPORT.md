# Live Integration Test Report — hfcdemo-api

**Target:** https://hfcdemo-api-pkz2lysbqoabq.azurewebsites.net (Azure App Service, rg `hfc-demo-rg`)
**Date:** 2026-06-17
**Method:** API smoke + RBAC drivers (curl/fetch) and browser UI drivers (Playwright/Chromium) run against the **live** deployment.

> The app was found **stopped** (`403 — This web app is stopped`). It was started with `az webapp start`, warmed up, then tested. Left running afterward per request.

---

## Result at a glance

| Layer | Suite | Checks | Result |
|---|---|---|---|
| API | `e2e/smoke-api.sh` | 78 | ✅ 78/78 |
| API | `e2e/drive-rbac.mjs` | 25 | ✅ 25/25 |
| UI (browser) | `e2e/drive-intake.mjs` | flow | ✅ pass |
| UI (browser) | `e2e/drive-dashboard.mjs` | flow | ✅ pass |
| UI (browser) | `e2e/drive-franchisee.mjs` | flow | ✅ pass |

**103 explicit API assertions passed, 0 failed. 3 UI user-flows passed.** No defects found.

---

## What was tested (coverage)

### ✅ API surface — comprehensive
- **Auth gating** — every protected route returns `401` with no token (fail-closed at the edge).
- **Multi-tenant isolation** — a same-brand sibling franchisee gets `404` booking another's slot and sees `0` of its appointments/NPS rows (write + read isolation).
- **Optimistic concurrency** — re-booking a taken slot → `409`.
- **Idempotency** — deposit retried with the same `Idempotency-Key` does not double-charge; missing key → `400`.
- **Input validation** — negative/zero amounts, missing fields, bad periods/pagination → `400`, errors as `application/problem+json` (not HTML).
- **4-tier RBAC read-down** — network (49 territories) ⊃ brand (8) ⊃ region (23) ⊃ franchisee (1); cross-scope reads `403`; booking-only personas fail-closed to 0.
- **Reporting** — catalog/query metrics+dimensions+periods, provenance carried to columns, scoped echo per tier.
- **Saved reports** — full CRUD + read-down library (network sees brand-owned; other brands `404`; delete permissions enforced).

### ✅ UI flows — three core surfaces (see screenshots below)
- **Intake → booking** (franchisee scope)
- **Executive dashboard + RBAC scope narrowing** (network → brand)
- **Operator/franchisee dashboard** (KPIs, deposit empty-states, detail drawer, mobile)

### ⚠️ NOT covered by this run (honest gaps)
- **Reporting / back-office UI** — tested at the **API level only**; there is no browser driver for the reporting UI in `e2e/`. (Older `backoffice-*.png` screenshots in `/tmp` are from prior sessions, not this run.)
- **`e2e/drive.mjs`** — not run; it's an older superset of the intake booking+deposit flow already covered by `drive-intake.mjs`.
- **.NET integration tests** (`tests/*.cs` — Tenancy/Concurrency/RollupIdempotency/Provenance) — these run against an in-memory app factory, **not** the live deploy, so they were out of scope here.
- **Negative/error UI states, cross-browser (Firefox/WebKit), load/perf, accessibility audit** — not in scope.
- **Twilio/SendGrid/Stripe live side-effects** — not exercised against real third parties.

---

## Evidence — screenshots (this run, 2026-06-17 ~18:30)

### Intake → AI draft → booking
Franchisee "Carolina Light & Shade" signs in, the intake panel drafts a service from free text (local heuristic, 45% conf), and books appointment **#1392** with a $50 deposit CTA.

![Intake draft](shots/intake-1-draft.png)
![Intake booked](shots/intake-2-booked.png)

### Executive dashboard + RBAC scope narrowing
CEO (network scope): 8 KPI tiles, `FRANCHISOR NETWORK · PORTFOLIO VIEW`, **49** active territories, 8-brand comparison. Re-signing as "Budget Blinds" narrows the same UI to **8** territories (`BUDGET BLINDS · BRAND VIEW`) — RBAC enforced in the UI, not just the API.

![Dashboard desktop (network)](shots/dashboard-1-desktop.png)
![Dashboard brand scope](shots/dashboard-4-brand-scope.png)
![Dashboard mobile](shots/dashboard-3-mobile.png)

### Operator / franchisee dashboard
5 KPI tiles, delta glyph/sign agree on all chips, deposit empty-states stay honest (neutral, no false red), headings legible, detail drawer with 30 action rows. (40 benign CSP font-load console warnings filtered.)

![Franchisee desktop](shots/franchisee-1-desktop.png)
![Franchisee drawer](shots/franchisee-2-drawer.png)
![Franchisee mobile](shots/franchisee-3-mobile.png)

---

## Notes
- **Test data left behind:** the smoke run wrote real rows to the live demo DB under `budget-blinds-irvine` (a "Smoke" appointment + deposit, an NPS response). No automated cleanup is wired for this deployment.
- **To extend coverage:** add a reporting-UI browser driver, and run the .NET test project (`dotnet test tests/`) against a local instance for the rollup/provenance edge cases.

## How to reproduce
```bash
cd hfc-demo
export BASE=https://hfcdemo-api-pkz2lysbqoabq.azurewebsites.net
API_BASE=$BASE ./e2e/smoke-api.sh
BASE=$BASE node e2e/drive-rbac.mjs
BASE=$BASE node e2e/drive-intake.mjs
BASE=$BASE node e2e/drive-dashboard.mjs
BASE=$BASE node e2e/drive-franchisee.mjs
```
