# Worktree Lead Prompt — slice-b (AI-assisted intake)

You are the lead for this worktree. Work only here.

## Status: ✅ MERGED to `main` (PR #1)
Slice B is done and merged: `api/Intake.cs` (Claude tool-calling extraction + deterministic heuristic fallback + spend/latency guardrails), `POST /api/intake/parse` (tenant-scoped, stateless), the "Draft with AI" frontend, and `e2e/drive-intake.mjs`. **You do not need to build anything.**

## Repo context
HFC franchise platform demo — ASP.NET Core 9 + EF Core + Angular 20 + Azure Durable Functions. `main` is the always-deployable trunk; GitHub Flow, rapid integration (see `docs/dashboard/WORKTREE-GITFLOW.md`).

## What to do in this window
1. Confirm it's on `main`:
   ```bash
   git fetch origin && git log --oneline -3 origin/main && git show --stat origin/main -- api/Intake.cs | head
   ```
2. Stand down — no new PRs from this branch.

## Optional follow-on (only if asked)
- Register `AnthropicClient` as a singleton in DI (currently created per call).
- Add an explicit unit/integration test for the heuristic-fallback path (API key unset).
- If you take this on: new branch off `main`, additive only, build + smoke green, then PR.

## Git rules
Don't work on `main`. Don't force-push. Conventional commits with trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No new deps without approval.
