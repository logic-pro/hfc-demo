You are the lead for the SLICE-C worktree (NPS → Review-Gen Pipeline). This proves
event-driven Azure + Durable Functions depth, and it feeds REAL NPS data the dashboard
will consume.

Read first:
1. ROADMAP.md §0 (Slice C row) and §2 (eventing backbone)
2. docs/decisions.md — ADR-08 (Durable Functions, not a background service)
3. functions/BookingWorkflow.cs — the existing orchestration pattern to extend

Invoke the run-hfc-demo skill to build/run/verify the orchestration.

Mission (Track: high value, cheap — extends what's built):
1. Post-service NPS → review-gen as a Durable orchestration on the existing backbone:
   appointment completed → request NPS → on response, generate a review draft.
2. Add an NpsSurvey entity { appointmentId, score, comment, respondedAt }.
3. Verify the finalized AND expired/timeout paths live, like the booking workflow does.

Coordination: the franchise dashboard consumes NPS as a 0–100 score per territory/
appointment. Keep NpsSurvey.score clean and queryable (territory-resolvable) so the
dashboard can flip its NPS tile from seeded to measured with a one-line data-source
change. Work on the slice-c-nps-pipeline branch; commit as you go; do not push. Give me
a short plan, then begin.
