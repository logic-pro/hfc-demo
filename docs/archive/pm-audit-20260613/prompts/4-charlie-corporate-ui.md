Paste into the charlie window:

You are the lead agent for CHARLIE (franchisor/CEO "Operations Command Center" exec dashboard — the showcase UI).

Your mission is to land the franchisor exec dashboard on main at route /corporate, flip it
from fixtures to live Bravo data (D17), and absorb the four best ideas from the retiring
corporate/ design slice. You are the BASE for the franchisor frontend; the corporate/ slice
is harvested into you, then deleted.

Branch/worktree recommendation:
- Branch: charlie (rebase onto origin/main AFTER bravo lands, so /api/dashboard/* is live)
- Worktree: hfc-demo-worktrees/charlie

Before coding, inspect:
- web/src/app/dashboard/* (your components: kpi-tile, territory-map, scorecard, watchlist, provenance; plus ui/ primitives and dashboard.fixtures.ts)
- web/src/app/dashboard/dashboard-data.service.ts (your fixtures→live seam)
- docs/dashboard/INTEGRATION-PLAN.md §1 Fork 2 "best of both" (the four grafts) and §3 (your answered question: no DTO drift, clean flip)
- The corporate/ slice on branch feat/corporate-readmodel-design — specifically web/src/app/corporate/utils/number-format.util.ts and tenant.interceptor.ts changes (the grafts below)

You own:
- web/src/app/dashboard/** (your franchisor UI)
- The /corporate route registration
- The fixtures→live data swap in dashboard-data.service.ts

SHARED-SHELL RULE (read carefully — this is the #1 merge risk):
charlie and slice-d BOTH edit web/src/app/app.ts, app.routes.ts, app.config.ts, styles.css,
and dashboard.models.ts. To avoid a guaranteed conflict, the shell is owned by WHOEVER MERGES
FIRST. Per the merge order charlie merges BEFORE slice-d, so:
- YOU define the unified shell with three routes: /booking (untouched), /corporate (you), /dashboard (slice-d, placeholder import is fine).
- Keep your models in a charlie-namespaced file or clearly-sectioned dashboard.models.ts so slice-d can add its operator models without colliding.
- slice-d will rebase onto your shell, not the other way around.

Grafts to absorb from the corporate/ slice (then it gets retired):
1. Read-down auth seam: in web/src/app/tenant.interceptor.ts, SKIP the franchisee token for /api/dashboard/* (corporate endpoints are cross-franchisee) and give the dashboard a corporate-scoped credential. Do this AS PART of D17, not after.
2. Null-safe formatting: adopt the corporate util's `null → 'Unavailable'` guard in ui/health.ts formatValue (yours renders NaN/0 for missing live values).
3. D16 unavailable+gap state: where a financial is genuinely unsourced, degrade to the dashed "unavailable + gap-note" treatment (e.g. "Requires completed_job.invoiceAmount + territory.royalty_rate") instead of a fake number. Keep clearly-labeled Illustrative numbers where that is the intent.

Avoid changing:
- web/src/app/dashboard/ ... wait — that IS yours; instead avoid: api/* (backend lanes), the /booking flow, and slice-d's operator components.
- Do NOT add coords to the §2 D9 list item shape; consume Bravo's /api/dashboard/map for geometry.

Acceptance criteria:
1. /corporate renders the full drill path (hero tiles → health map → scorecard → distribution → table) against LIVE Bravo data.
2. The three grafts are in (auth-seam skip, null-safe format, unavailable+gap state).
3. A franchisee token cannot load /api/dashboard/corporate (interceptor skip + Bravo RBAC both enforce — verify).
4. Unified shell exposes /booking, /corporate, /dashboard without breaking /booking.
5. ng build succeeds; /booking still renders (visual check for Tailwind/global bleed).

Validation:
Run:
  (cd web && npm ci && npm run build)
  node e2e/drive.mjs           # or your dashboard drive script — screenshot /corporate
  # manually load /booking and confirm no visual regression

If validation fails, report exact errors and do not claim completion.

At the end, produce a Worktree Summary Report with:
- What changed (esp. the shell unification and the three grafts)
- Files changed
- Tests/build run
- Known risks (shell collision with slice-d; Tailwind global bleed)
- PM decisions needed
- Recommended next action (expected: "ready to merge as step 4; corporate/ slice can be retired")
