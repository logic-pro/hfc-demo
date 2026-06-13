# Worktree Integration Map — all parallel streams

> Master orchestration map for the HFC demo build. Seven worktrees run in parallel.
> This file records each one's status, mission, dependencies, and the merge order so
> the plan survives across sessions. Kickoff prompts for each live in the chat; the
> dashboard leads also have briefs in [leads/](leads/).

## The seven worktrees

| Worktree | Branch | Stream | Status | Mission (one line) |
|---|---|---|---|---|
| **slice-a-auth-tenancy** | `slice-a-auth-tenancy` | Security foundation | **Active — MUST, merge first** | Move tenant from `X-Tenant-Id` header → verified token claim; two-axis tenancy (`franchiseeId` key, `brandId` grouping); integration + concurrency tests |
| **slice-b-ai-intake** | `slice-b-ai-intake` | AI intake | **Active — independent** | Free-text → typed intake schema via structured outputs/tool-calling; human-verifiable; wire into booking |
| **slice-c-nps-pipeline** | `slice-c-nps-pipeline` | Eventing/NPS | **Active — feeds dashboard** | Post-service NPS → review-gen Durable orchestration; `NpsSurvey{appointmentId,score,...}`; verify finalized + expired paths |
| **slice-d-franchisee-dashboard** | `slice-d-franchisee-dashboard` | Franchisee **Operations** dashboard (operator view) | **Active — scaffold built** | Mock-first Angular dashboard committed + `/dashboard` route serving; next: backend `GET /api/dashboard`, flip `USE_MOCK=false`, wire drawer actions, e2e screenshot. Distinct from the corporate CEO dashboard (alpha/bravo/charlie). |
| **alpha** | `alpha` | Data & read-model | **Active** | Schema + believable seed + `territory_period_summary` + `RecomputeRollup` + health score + watchlist rows (D0–D5) |
| **bravo** | `bravo` | Dashboard API | **Active** | Read-only projection endpoints to CONTRACT §2 DTOs + RBAC scope filter (D6–D10) |
| **charlie** | `charlie` | Angular UI (showcase) | **Active — the jaw-drop** | "Operations Command Center" exec UI: hero tiles, health map, radial scorecard, provenance visual (D11–D18) |

## Dependency threads (the only things that couple these streams)

1. **Slice A ↔ alpha/bravo — tenancy/RBAC source.**
   A replaces the header with a token claim and adds `franchiseeId`. Bravo's RBAC scope
   filter (D10) and Alpha's `franchiseeId` model must end up on A's tenancy model.
   **Resolution (demo-now/real-later):** alpha/bravo build with a swappable scope source
   (header/seed now → A's token claim when A merges). **Do not gate the dashboard on A.**
   Treat "rebase scope onto A" as a post-merge integration task.

2. **Slice C → dashboard — NPS swap.**
   C produces `NpsSurvey.score` (0–100, territory-resolvable). The dashboard ships NPS
   as a *seeded* tile now; when C merges, issue **D-NPS-SWAP** flips it to *measured* —
   a one-line data-source change (no shape change), thanks to provenance.

3. **Slice D → charlie — salvage.**
   D hands reusable Angular/aggregation bits to Charlie via `SALVAGE.md`, then stands down.

4. **alpha → bravo → charlie — the contract spine.**
   All three build to [CONTRACT.md](CONTRACT.md) (frozen). Charlie on fixtures, Bravo on
   a stub, Alpha makes it real. Contract changes = edit + bump version + ping the others.

## Merge order (recommended)

```
1. slice-a-auth-tenancy   → main   (security MUST; tenancy model everything rebases onto)
2. alpha                  → main   (read-model spine; rebase franchiseeId onto A's model)
3. bravo                  → main   (rebase RBAC scope onto A's token claim)
4. charlie                → main   (swap fixtures → live bravo)
5. slice-c-nps-pipeline   → main   (then run D-NPS-SWAP)
6. slice-b-ai-intake      → main   (independent; merge whenever green)
   slice-d                → retire after SALVAGE.md harvested
```

Independent streams (B, and C until the NPS swap) can merge in any order once green.
The one true ordering constraint is **A before the dashboard's RBAC goes live**.
