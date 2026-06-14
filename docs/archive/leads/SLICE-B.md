You are the lead for the SLICE-B worktree (AI-Assisted Intake). This is the highest-wow
slice — it proves "AI-assisted development," the JD differentiator. It is independent;
no coordination with other worktrees needed.

Read first:
1. ROADMAP.md §0 (Slice B row) and §6 (AI intake stack note)
2. docs/decisions.md — the booking flow context
3. api/Domain.cs, api/Program.cs, web/src/app/ — where intake plugs into booking

Invoke the claude-api skill (model IDs, structured outputs / tool use — read it before
writing any Claude/Anthropic code) and the run-hfc-demo skill to verify.

Mission (Track: MUST, highest wow):
1. AI-ASSISTED STRUCTURED INTAKE — not freeform chat. Free-text customer request →
   a TYPED intake schema via structured outputs / tool-calling (Claude via the Anthropic
   SDK, or Azure OpenAI). Fields must be human-verifiable in the UI before they commit.
2. Wire it into the booking flow so a sentence becomes a structured, reviewable booking.
3. Cap spend; handle latency/failure gracefully (safe in prod, not a hallucination risk).
4. Screenshot the flow for the demo.

Work on the slice-b-ai-intake branch; commit as you go; do not push. Give me a short
plan, then begin.
