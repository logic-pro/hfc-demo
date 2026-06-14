Paste into the charlie window:

You are the lead agent for the charlie worktree (Angular showcase UI — the corporate dashboard).

Mission: reconcile charlie into main as the franchisor dashboard at /corporate, collapse to ONE app
shell, graft the best-of-both auth/null-safety bits, and flip the dashboard to live bravo data (D17).
You are merge #4 (after bravo). You OWN the single app shell after this lands.

Branch: charlie  Worktree: hfc-demo-worktrees/charlie

Hold the MERGE LOCK before you push (docs/dashboard/prompts/0-MERGE-CONDUCTOR.md). Bravo MUST be merged first.

THE CONFLICT: your branch is PRE-Slice-A and restructures the shell (app.ts split into booking/ + dashboard/,
plus index.html / styles.css). main also has a corporate/ Angular area. Collapse to ONE shell with three routes:
  /booking  (untouched)   /corporate (your dashboard)   /dashboard (Slice-D placeholder for now)
Retire main's competing web/src/app/corporate/ components. Do NOT create a second bootstrap/shell.

Grafts (do these AS PART OF D17, not after):
(a) Auth seam: in tenant.interceptor.ts, SKIP the franchisee token for bravo's real prefixes
    (/api/dashboard/, and dashboard /api/territories*); give DashboardDataService live mode a
    corporate-scoped credential.
(b) Make formatValue null-safe (null → 'Unavailable').
(c) Extend D16 so a genuinely unsourced metric degrades to the dashed "unavailable + gap" state
    instead of rendering a fake number.

Then flip __DASHBOARD_LIVE__ true and assert exactly ONE live call per endpoint, each matching dashboard.models.ts.

Before coding, inspect: web/src/app/app.routes.ts, app.ts, app.config.ts, index.html, styles.css,
web/src/app/dashboard/* (your components + dashboard-data.service.ts + dashboard.models.ts),
web/src/app/booking/*, and main's web/src/app/corporate/ (to retire).

You own: the app shell + routes, web/src/app/dashboard/*, web/src/app/booking/* (move only, don't rewrite logic).
Avoid: api/* (backend is frozen by now), and the /dashboard route's contents (slice-d lands there next).

Acceptance criteria:
1. Rebase onto origin/main; ONE shell, three routes; main's corporate/ retired.
2. AOT build green: (cd web && npm run build).
3. Live mode: one call per endpoint, shapes match dashboard.models.ts; null metric shows dashed unavailable+gap.
4. /booking still renders unchanged (no CSS bleed from Tailwind/your styles).

Validation:
  git fetch && git rebase origin/main
  (cd web && npm run build)
  (serve) verify /corporate live + /booking visually unchanged

If validation fails, report exact errors and do not claim completion.

Final Worktree Summary Report: what changed, files changed, AOT result, per-endpoint live-call check,
/booking regression check, merged SHA, next action (D-NPS-SWAP, then slice-d into /dashboard).
