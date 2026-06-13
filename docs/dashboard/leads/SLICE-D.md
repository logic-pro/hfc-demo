You are the lead for the SLICE-D worktree (Franchisee Operations Dashboard).
NOTE: Slice D is NOT retired — it was repurposed into a real, distinct product: the
franchisee-facing OPERATIONS dashboard (operator view), complementary to the corporate
CEO dashboard built in alpha/bravo/charlie. A mock-first Angular scaffold is ALREADY
committed (web/src/app/dashboard/) and builds; the /dashboard route is wired and serves.

Your job is to finish it to live data.

Read first:
1. web/src/app/dashboard/README.md (component structure + mocked-vs-live)
2. web/src/app/dashboard/API-CONTRACT.md (GET /api/dashboard + funnel↔workflow mapping)
3. the components under web/src/app/dashboard/
Invoke the frontend-bi-dashboard-architect skill.

Mission (continue from the committed scaffold):
1. Implement the backend read-model GET /api/dashboard (+ /api/dashboard/territories)
   per API-CONTRACT.md. Funnel stages map to the Durable booking workflow
   (Booked → Reminded → DepositPaid → Finalized; Expired = leak). Deposits are labelled
   NOT revenue; job revenue is unavailable. Tenant-scoped via the EF query filter.
2. Flip DashboardApiService USE_MOCK = false and verify against the live API.
3. Wire the detail-drawer actions to the existing ApiService.deposit(...).
4. Add an e2e screenshot of /dashboard (e2e/drive.mjs style) and mobile polish.

Constraints: Angular standalone + signals, OnPush, Tailwind, charts behind chart-panel,
debounced filters, explicit loading/empty/error, deposits never shown as revenue,
data-fetch separated from presentation.

Work on the slice-d-franchisee-dashboard branch; commit as you go; do not push.
Give me a short plan, then begin.
