Paste into the slice-d-franchisee-dashboard window (covers D-NPS-SWAP then Slice D):

You are the lead agent for the slice-d-franchisee-dashboard worktree (franchisee OPERATIONS dashboard,
operator view — distinct from charlie's /corporate CEO dashboard). You also run D-NPS-SWAP.

Hold the MERGE LOCK before each push (docs/dashboard/prompts/0-MERGE-CONDUCTOR.md).

=== Task A — D-NPS-SWAP (merge #5, needs slice-c + alpha already on main) ===
Flip nps_score in the rollup from seeded to measured: source GET /api/nps grouped by the denormalized
TerritoryId (no join, no shape change). Update the metric's provenanceType seeded → measured. Re-run the
rollup and confirm the corporate dashboard NPS tiles relabel from "Illustrative" to "Measured".
This is a ~one-line data-source change in alpha's Rollup.cs thanks to provenance — keep the shape identical.

=== Task B — Land Slice D (merge #6, needs charlie's shell on main) ===
Merge slice-d into main at the /dashboard route (franchisee operator view). Your branch is PRE-Slice-A and
ships its OWN web/src/main.ts + web/src/app/shell.ts — do NOT reintroduce a competing shell/bootstrap.
Reconcile INTO the single shell charlie landed (the /dashboard route already reserved there).

Specifics:
- Tailwind v4: scope your @import so it cannot bleed into /booking or charlie's scoped /corporate CSS.
  Verify /booking visually after merge.
- Seed.cs: manually merge ON TOP of alpha's + Slice A's seed — boot and confirm BOTH booking slots AND
  dashboard demo data seed (don't clobber either).
- api/Program.cs: keep your GET /api/dashboard additive; confirm a franchisee token CANNOT reach
  /api/dashboard/corporate (that stays corporate-scoped).

Before coding, inspect: web/src/app/dashboard/* (your ops components), web/src/app/shell.ts + main.ts
(to retire in favor of charlie's shell), api/DashboardReadModel.cs, api/Program.cs, api/Seed.cs,
web/src/styles.css + .postcssrc.json (Tailwind scoping), web/src/app/app.routes.ts (the /dashboard route).

You own: web/src/app/dashboard/* (ops), api/DashboardReadModel.cs + GET /api/dashboard, your seed rows.
Avoid: web/src/app/dashboard/* ON charlie's side (/corporate components), the shell bootstrap (use charlie's).

Acceptance criteria:
1. (A) rollup NPS = measured; corporate tiles relabel Illustrative→Measured. (B) /dashboard renders ops view.
2. AOT build green (cd web && npm run build); /booking AND /corporate visually intact (no Tailwind bleed).
3. Boot + reseed: booking slots AND dashboard demo data both present.
4. Franchisee token → /api/dashboard/corporate is denied.
5. Screenshot e2e (e2e/drive-dashboard.mjs) passes.

Validation:
  git fetch && git rebase origin/main
  dotnet build ./api/api.csproj && (cd web && npm run build)
  (boot, reseed, run e2e/drive-dashboard.mjs) ; verify /booking + /corporate unaffected

If validation fails, report exact errors and do not claim completion.

Final Worktree Summary Report (one per merge): what changed, files changed, NPS relabel proof,
seed proof (slots + demo data), Tailwind-bleed check, cross-scope 403 proof, screenshot result, merged SHAs.
