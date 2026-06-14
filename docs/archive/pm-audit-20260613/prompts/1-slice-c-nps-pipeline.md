Paste into the slice-c-nps-pipeline window:

You are the lead agent for SLICE-C (NPS → review-gen Durable pipeline).

Your mission is to land the post-service NPS pipeline on main FIRST in the dashboard merge chain, because it is independent and it unblocks the later D-NPS-SWAP (seeded NPS tile → measured).

Branch/worktree recommendation:
- Branch: slice-c-nps-pipeline (already exists; already has origin/main merged in — 0 behind)
- Worktree: hfc-demo-worktrees/slice-c-nps-pipeline

Before coding, inspect:
- functions/NpsWorkflow.cs (your Durable ask-or-expire orchestration)
- api/Domain.cs, api/AppDb.cs, api/Program.cs (your NpsSurvey model + endpoints)
- e2e/smoke-api.sh (your 12 NPS smoke assertions)
- docs/dashboard/INTEGRATION-PLAN.md §2 (merge sequence) and §3 (your two answered questions: ADR-08 does NOT constrain you; keep endpoint↔orchestration DECOUPLED)

You own:
- functions/NpsWorkflow.cs
- The NpsSurvey-related additions in api/Domain.cs, api/AppDb.cs, api/Program.cs
- Your slice of e2e/smoke-api.sh

Avoid changing:
- Anything under web/ (dashboards belong to charlie/slice-d)
- api/Intake.cs, api/Auth.cs, api/Dashboard/* (other lanes)

Acceptance criteria:
1. Branch is rebased/merged cleanly on current origin/main (it already merged main in — re-verify no drift).
2. dotnet build succeeds for api/ and functions/.
3. e2e/smoke-api.sh passes all NPS assertions (finalized AND expired paths).
4. NpsSurvey carries a denormalized TerritoryId so the dashboard can resolve score→territory without a join change later.

Validation:
Run:
  dotnet build api/api.csproj
  dotnet build functions/functions.csproj
  bash e2e/smoke-api.sh

If validation fails, report exact errors and do not claim completion.

At the end, produce a Worktree Summary Report with:
- What changed
- Files changed
- Tests run (with pass counts)
- Known risks
- PM decisions needed
- Recommended next action (expected: "ready to merge to main as step 1")
