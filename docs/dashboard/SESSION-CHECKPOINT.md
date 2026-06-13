# Session Checkpoint — dashboard build (resume here)

_Saved 2026-06-13. Where everything stands and how to pick back up._

## TL;DR
Two dashboards are in flight, plus the four feature slices:
- **Corporate CEO dashboard** → built in parallel across `alpha` (data/read-model),
  `bravo` (API), `charlie` (Angular showcase UI). Coordinated by
  [CONTRACT.md](CONTRACT.md).
- **Franchisee Operations dashboard** → `slice-d-franchisee-dashboard`. Mock-first
  Angular scaffold is **committed and builds**; `/dashboard` route serves.
- Foundation/feature slices: `slice-a` (auth/tenancy — merge first), `slice-b`
  (AI intake), `slice-c` (NPS pipeline → feeds dashboards).

Lead prompts for all seven: [leads/](leads/). Status + deps + merge order:
[INTEGRATION.md](INTEGRATION.md). Backlog: [BACKLOG.md](BACKLOG.md).

## State by worktree (at checkpoint)
| Worktree | Branch | State |
|---|---|---|
| main | `main` | Scaffolding committed: 3 skills, CONTRACT, BACKLOG, INTEGRATION, lead prompts, this file |
| slice-d-franchisee-dashboard | `slice-d-franchisee-dashboard` | **Committed**: ops-dashboard scaffold (mock) + `/dashboard` route. `ng build` green. Next: backend `GET /api/dashboard`, flip `USE_MOCK=false` |
| charlie | `charlie` | **WIP checkpoint committed** — exec-UI refactor in progress (app→booking/ split, dashboard/ dir). Resume from its lead prompt |
| alpha | `alpha` | **WIP checkpoint committed** — `Seed.cs` changes started |
| bravo | `bravo` | (shares alpha's checkout note; check `git log`) |
| slice-a / slice-b / slice-c | resp. branches | Not started in this session; lead prompts ready |

> WIP checkpoint commits were made to preserve in-progress work in other sessions'
> worktrees so nothing is lost. They are labeled `WIP checkpoint` and are safe to
> amend/reset — they change no working files.

## Slice D — Franchisee Operations dashboard (this session's build)
- Code: `slice-d-franchisee-dashboard/web/src/app/dashboard/` (+ `shell.ts`,
  `app.routes.ts`). Docs: that folder's `README.md` + `API-CONTRACT.md`.
- Verified: `npm install` ok, `ng build` ok (lazy dashboard chunk, Tailwind active),
  dev server served `/dashboard` HTTP 200, no console/runtime errors.
- **NOT done**: visual screenshot — the sandbox Chromium is missing `libnspr4`/no sudo.
- To view / screenshot yourself:
  ```bash
  cd hfc-demo-worktrees/slice-d-franchisee-dashboard/web
  npm start                       # opens dev server
  # browse http://localhost:4200/dashboard   (mock data, no backend needed)
  # screenshot: npx playwright install-deps chromium && \
  #   npx playwright screenshot http://localhost:4200/dashboard shot.png
  ```

## Next steps (when you return)
1. Slice D: implement backend `GET /api/dashboard` per API-CONTRACT.md → flip
   `DashboardApiService.USE_MOCK = false` → screenshot.
2. Corporate: continue alpha (land D0+D2 first) → bravo stub endpoints → charlie UI.
   All build to [CONTRACT.md](CONTRACT.md); contract changes = bump + ping.
3. Merge order: slice-a → alpha → bravo → charlie → slice-c (+NPS swap) → slice-b.
   (Full order + dependency threads in INTEGRATION.md.)
4. Optional: create a GitHub remote + run `create-issues.sh` to materialize the
   backlog as real issues (no remote today; explicit publish needed).
