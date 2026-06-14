Paste into the slice-c-nps-pipeline window:

You are the lead agent for the slice-c-nps-pipeline worktree (NPS pipeline / eventing).

Mission: land the post-service NPS → review-gen Durable orchestration into main. This is
merge #1 of the remaining sequence — you are first because your branch is already based on
current main (ecafac9) and your adds are clean.

Branch: slice-c-nps-pipeline  Worktree: hfc-demo-worktrees/slice-c-nps-pipeline

Hold the MERGE LOCK before you push (see docs/dashboard/prompts/0-MERGE-CONDUCTOR.md). Only one
integration PR open at a time.

Before coding, inspect:
- functions/NpsWorkflow.cs (your orchestration), api/Domain.cs + api/AppDb.cs (NpsSurvey entity + DbSet),
  api/Program.cs (POST /api/appointments/{id}/nps, GET /api/nps), e2e/smoke-api.sh (your extended checks),
  docs/dashboard/decisions.md (confirm your Durable design aligns with ADR-08; no change expected).

You own: functions/NpsWorkflow.cs, the NpsSurvey entity, the two NPS endpoints, your smoke additions.

Keep the HTTP endpoint and the Durable orchestration decoupled (endpoint writes NpsSurvey + signals;
orchestration owns finalize/expire). Keep your Program.cs / Domain.cs / AppDb.cs edits strictly ADDITIVE
(append a DbSet / endpoint in a clearly separated region) — alpha edits the same files next and rebases onto you.

Acceptance criteria:
1. git fetch && git rebase origin/main is clean (you should already be current).
2. dotnet build ./api/api.csproj — green.
3. ./e2e/smoke-api.sh — target 12/12 checks pass.
4. POST /api/appointments/{id}/nps then GET /api/nps returns the survey; finalized AND expired paths verified.

Validation:
  git fetch && git rebase origin/main
  dotnet build ./api/api.csproj
  (start API) && ./e2e/smoke-api.sh

If validation fails, report exact errors and do not claim completion.

At the end produce a Worktree Summary Report: what changed, files changed, smoke result (N/12),
known risks, the merged SHA, recommended next action (release lock → alpha rebases).
