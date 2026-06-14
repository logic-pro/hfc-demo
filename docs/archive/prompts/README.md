# Worktree Lead Prompts — index

One self-contained prompt per worktree. Open the file → Select All → copy → paste
into that worktree's agent window. (Run `./open-worktrees.sh` to open all 7 windows.)

| # | Worktree window | File | Status | What to paste it for |
|---|---|---|---|---|
| 1 | `slice-a-auth-tenancy` | [1-slice-a-auth-tenancy.md](1-slice-a-auth-tenancy.md) | ✅ merged | Stand down / verify; optional RBAC follow-on |
| 2 | `slice-b-ai-intake` | [2-slice-b-ai-intake.md](2-slice-b-ai-intake.md) | ✅ merged (PR #1) | Stand down; optional polish |
| 3 | `slice-c-nps-pipeline` | [3-slice-c-nps-pipeline.md](3-slice-c-nps-pipeline.md) | ▶ active | Reconcile tenancy conflict + land NPS |
| 4 | `alpha` | [4-alpha.md](4-alpha.md) | ▶ active | Rebase read model onto FranchiseeId |
| 5 | `bravo` | [5-bravo.md](5-bravo.md) | ▶ active | Rebase API; RBAC header→token; swap stub→alpha EF |
| 6 | `charlie` | [6-charlie.md](6-charlie.md) | ▶ active | Merge exec UI at `/corporate`; best-of-both grafts; D17 live |
| 7 | `slice-d-franchisee-dashboard` | [7-slice-d-franchisee-dashboard.md](7-slice-d-franchisee-dashboard.md) | ▶ active | Land franchisee dashboard at `/dashboard`; scope Tailwind |

**Merge order:** 3 → 4 → 5 → 6 (flip D17) → D-NPS-SWAP → 7 → deploy.
**Shared rules every prompt enforces:** keep Slice A's `Auth.cs` token seam, no BrandId-only revert, don't change the frozen CONTRACT §2 DTOs, rebase → green → PR. See [WORKTREE-GITFLOW.md](../WORKTREE-GITFLOW.md), [CONTRACT.md](../CONTRACT.md), [INTEGRATION-PLAN.md](../INTEGRATION-PLAN.md).
