# Worktree Lead Prompt — slice-a (auth & tenancy)

You are the lead for this worktree. Work only here.

## Status: ✅ MERGED to `main`
Slice A is done and merged (token-claim two-axis tenancy: `franchiseeId` boundary, `brandId` grouping, via `TenantResolver.Populate` in `api/Auth.cs`; EF global query filter, fail-closed; 8/8 integration tests). This is the foundation everything else rebases onto. **You do not need to build anything.**

## Repo context
HFC franchise platform demo — ASP.NET Core 9 minimal API + EF Core (SQLite local / Azure SQL) + Angular 20 (standalone, signals) + Azure Durable Functions. `main` is the always-deployable trunk; GitHub Flow, rapid integration (see `docs/worktrees/WORKTREE-GITFLOW.md`).

## What to do in this window
1. Confirm your branch is reflected on `main`:
   ```bash
   git status --short && git fetch origin && git log --oneline -3 origin/main
   ```
2. Stand down — do not open new PRs from this branch.

## Optional follow-on (only if asked)
- Harden RBAC roles on the `TenantResolver.Populate` seam (corporate / franchisee / regional) so alpha/bravo/slice-d bind role from the claim, not a header.
- If you take this on: new branch off `main`, additive only, keep the single claim-resolution seam, integration test the role paths, then PR.

## Git rules
Don't work on `main`. Don't force-push. Conventional commits with trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
