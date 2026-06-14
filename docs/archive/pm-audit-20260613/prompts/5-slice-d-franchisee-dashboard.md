Paste into the slice-d-franchisee-dashboard window:

You are the lead agent for SLICE-D (franchisee OPERATIONS dashboard — the operator view).

Your mission is to land the franchisee operator dashboard on main at route /dashboard,
on LIVE data, with the deposit action wired — merging LAST in the dashboard chain and
rebasing onto charlie's already-merged unified shell. You are distinct from charlie's
franchisor /corporate dashboard; both ship, both coexist, different scope.

Branch/worktree recommendation:
- Branch: slice-d-franchisee-dashboard (rebase onto origin/main AFTER charlie merges)
- Worktree: hfc-demo-worktrees/slice-d-franchisee-dashboard

Before coding, inspect:
- web/src/app/dashboard/dashboard-page.component.ts and components/* (your operator UI — note these are *.component.ts, charlie's are not)
- web/src/app/dashboard/dashboard-api.service.ts, dashboard.mock.ts, API-CONTRACT.md
- docs/dashboard/INTEGRATION-PLAN.md §1 Fork 2 (the three-route shell), §3 (your answered questions), §4 (Tailwind + Seed.cs gates)

You own:
- The franchisee operator components and dashboard-page.component.ts
- The /dashboard route's operator behavior and the deposit action wiring
- Your slice of the seed demo data (franchisee-scoped)

SHARED-SHELL RULE (read carefully — this is the #1 merge risk):
charlie merges BEFORE you and OWNS the unified shell. By the time you rebase, main already has:
web/src/app/app.ts, app.routes.ts, app.config.ts, styles.css with three routes
(/booking, /corporate, /dashboard) and a sectioned dashboard.models.ts.
- Do NOT re-write the shell. ADD your operator route behavior into the existing /dashboard slot.
- ADD your operator models into the existing dashboard.models.ts section, do not replace it.
- Resolve the Seed.cs three-way merge (Slice A Franchisee seed + alpha's 24-territory rows + your operator demo data) by ADDING, not overwriting.

Avoid changing:
- web/src/app/dashboard/ charlie components, ui/ primitives, or the /corporate route
- api/Dashboard/* (bravo) and the corporate read-down endpoints
- The /booking flow

Acceptance criteria:
1. /dashboard renders the franchisee operator view on LIVE data (USE_MOCK=false), franchisee-scoped via Slice A's token claim.
2. The deposit action works end-to-end from the dashboard.
3. Honest metrics: ship deposit-volume with "revenue unavailable" rather than a misleading revenue proxy (per §3 decision); funnel stages derived from columns is OK for the demo.
4. Tailwind @import is scoped so it does NOT bleed into /booking (per §4 gate) — visual-check /booking.
5. ng build succeeds; /booking, /corporate, AND /dashboard all render.

Validation:
Run:
  (cd web && npm ci && npm run build)
  node e2e/drive.mjs           # screenshot /dashboard and confirm /booking + /corporate intact
  bash e2e/smoke-api.sh        # if you touched seed/backend

If validation fails, report exact errors and do not claim completion.

At the end, produce a Worktree Summary Report with:
- What changed
- Files changed (call out every shared-shell file you touched and how you avoided clobbering charlie)
- Tests/build run
- Known risks (Tailwind bleed; Seed.cs three-way merge)
- PM decisions needed
- Recommended next action (expected: "ready to merge as the final dashboard step")
