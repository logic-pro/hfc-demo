# Orchestration & Development Velocity

How this repo is built, wired, and **operated for speed**. This is the team-facing
explanation of *how we work* — the parallel-execution model, the coordination control
plane, the automation that keeps it safe, and the levers we pull to move faster.

> TL;DR — One repo, one `main`. Work runs in **parallel lanes** (git worktrees), each
> owning a disjoint slice of the code. A lightweight **file-based control plane** (`.pm/`)
> assigns work and collects reports. **CI is the only merge authority** — branch
> protection + auto-merge let green PRs land hands-off. Long agent sessions are kept fast
> with a **context-handoff** ritual. The result: many changes integrating per day with
> near-zero merge conflicts.

---

## 1. The big picture

```
                         ┌──────────────────────────────────────────┐
                         │  GitHub: logic-pro/hfc-demo (public)      │
                         │  main  ──protected──▶ required CI check    │
                         │  auto-merge: green + up-to-date ⇒ lands    │
                         └────────────▲───────────────┬──────────────┘
                                      │ PRs            │ rebases / assignments
            ┌─────────────────────────┴──────┐        │
            │ PM session (umbrella worktree)  │        │
            │  • reads .pm/inbox + CI         │        │
            │  • assigns via .pm/outbox       │        │
            │  • conducts merges / deploys    │        │
            └───────┬─────────────────────────┘        │
                    │ writes assignments / reads reports│
        ┌───────────▼───────────────────────────────────▼─────────────┐
        │  .pm/  file-based control plane (the "bus")                   │
        │  registry.json · outbox/<lane> · inbox · status · board      │
        └──┬──────────┬──────────┬──────────┬──────────┬───────────────┘
           │          │          │          │          │   (each lane = a git worktree)
        ┌──▼──┐    ┌──▼──┐    ┌──▼──┐    ┌──▼──┐    ┌──▼──────────┐
        │alpha│    │bravo│    │charl│    │delta│    │echo / chore │   ← parallel lanes
        │ api │    │ api │    │ web │    │ ci  │    │ e2e / refac │
        └─────┘    └─────┘    └─────┘    └─────┘    └─────────────┘
```

The product itself (an HFC franchisor BI + operations platform — ASP.NET Core 9 API,
Angular 20 SPA, Azure Durable Functions) is documented in
[ARCHITECTURE.md](ARCHITECTURE.md), [decisions.md](decisions.md) (ADRs 01–21), and
[dashboard/CONTRACT.md](dashboard/CONTRACT.md). **This doc is about how we *build* it.**

---

## 2. Parallel lanes = git worktrees

We don't context-switch one checkout between tasks. Each concurrent stream of work is a
**git worktree** under `../hfc-demo-worktrees/`, sharing one `.git` but with its own
working directory, branch, and editor window:

| Lane | Branch | Typical focus |
|------|--------|---------------|
| `alpha` | `feat/*` | API / read-model / rollup |
| `bravo` | `feat/*` | API / dashboard endpoints |
| `charlie` | `feat/*` | Angular / web surfaces |
| `delta` | `chore/*` | CI / infra / tooling |
| `echo` | `feat/*` | e2e drivers / cross-cutting |
| `chore-modularize` | `chore/modularize-endpoints` | **barrier** refactors of hub files |

Lanes are **reusable NATO slots**, not permanent roles — we repoint a slot's focus and
allowed paths per round. The win: five edits in flight with **zero branch-switching cost**
and no "stash dance."

**The one rule that makes it work — disjoint ownership.** Every lane owns a set of
`allowed_paths` (in `registry.json`). Two lanes never edit the same file in the same round.
This is the *deep* fix for merge conflicts — far more effective than locks or careful
timing. Conflicts we don't create cost nothing to resolve.

---

## 3. The control plane (`.pm/` — the "bus")

A dependency-free, file-based message bus. No server, no database — just files in the
shared repo, reachable from any worktree via `git rev-parse --git-common-dir`.

```
.pm/
├── registry.json        # lanes → branch → allowed_paths → skills   (PM-owned, single writer)
├── outbox/<lane>/*.md   # PM → lane  : assignments                  (PM writes, lane reads)
├── inbox/*__<lane>__*.md# lane → PM  : reports                      (append-only, unique names)
├── status/<lane>.md     # lane → PM  : current state                (one file per lane)
├── board.md             # PM's view of the round                    (PM-owned)
├── handoffs/latest.md   # context-handoff checkpoint                (see §6)
└── hooks/               # the automation (see §5)
```

Why files instead of a tool? Because every agent and human already has a filesystem and
git. Reports can't get "summarized in chat and forgotten" — they're durable artifacts the
PM reads. It survives restarts, works offline, and diffs in git.

---

## 4. The merge model — CI is the only authority

GitHub Flow, tuned for rapid integration:

1. A lane branches off `main`, does its slice, opens a PR.
2. **CI runs** (`ci.yml`, single status check `build · test · web · smoke`): builds API +
   Functions, runs the integration tests (tenancy, concurrency, idempotency), builds the
   Angular SPA, and runs `e2e/smoke-api.sh`.
3. **Branch protection on `main`** requires that check **and `strict` mode** — the PR must
   be *up to date with main* before it can merge. That forces a rebase + re-run whenever
   main moves underneath it.
4. **Auto-merge** (`gh pr merge --auto --squash`): the PR lands by itself the moment it's
   rebased and green. No human in the merge path.

> **The sacred rule: local-green ≠ integrated-green.** We learned this the hard way — a
> PR that built clean locally turned `main` red after merge because another lane had
> changed a shared assumption. `strict` mode is our poor-man's merge queue: it re-tests
> each PR against the *current* main before it's allowed in. CI, not a self-report, decides.

> **Why this repo isn't on a real merge queue:** merge queues require an *organization*
> repo on GitHub Team/Enterprise. This is a user-owned public repo, so `strict` + required
> checks + auto-merge is the closest safe equivalent.

### Barrier lanes
Some work *can't* be parallel — e.g. `chore-modularize` rewrites the hub files
(`Program.cs`, `Seed.cs`, `AppDb.cs`) that every API lane touches. These run **solo**: no
other API lane active, rebase → refactor → verify → merge fast, then everyone else rebases
onto the new structure. A barrier is a deliberate, signposted exception to the parallel
model — see [worktrees/ROUND2-MODULARIZE.md](worktrees/ROUND2-MODULARIZE.md).

---

## 5. Automation — the hooks

Claude Code hooks turn the conventions above into *enforced, zero-effort* behavior. All
hooks live in `.pm/hooks/`, resolve the shared `.pm/` from any worktree, and **fail open**
(a broken hook never blocks work).

| Hook | Event | What it does |
|------|-------|--------------|
| `load-assignment.sh` | SessionStart | When a lane window opens, prints that lane's pending assignment from `outbox/` — no pasting. |
| `load-handoff.sh` | SessionStart | If a recent context-handoff exists, surfaces it so a fresh session resumes read-then-go. |
| `context-watch.sh` | UserPromptSubmit | Watches transcript size; **nudges once** past a threshold to checkpoint before auto-compaction (§6). |
| `report-on-stop.sh` | Stop | Before a lane finishes with unreported work, **requires** a report (what built / problems / self-eval) into `inbox/`. Blocks once, then allows. |
| `lane-guard.sh` | PreToolUse | (optional) Blocks edits outside the lane's `allowed_paths` — enforces disjoint ownership. |

Together these mean: a lane **opens to its assignment**, **can't drift out of its lane**,
and **can't finish without reporting** — the PM stays in the loop without chasing anyone.

---

## 6. Keeping agent sessions fast — context handoff

Long agent sessions slow down (every turn re-reads a growing transcript) and eventually
auto-compact, which can summarize away detail. We make the reset *deliberate*:

- **`context-watch` hook** nudges once when the transcript gets heavy.
- **`/context-handoff` skill** summarizes the work + live state (pulled from real
  `git log` / `gh pr list`, not memory), writes a focused continuation prompt to
  `.pm/handoffs/latest.md`, and tells you to `/clear`.
- **`load-handoff` hook** surfaces that checkpoint on the next session so it resumes
  instantly.

This is a real velocity lever: a fresh, focused session is faster and cheaper than a
bloated one, and the handoff guarantees nothing is lost across the reset.

---

## 7. Skills — the behavior protocols

Skills are reusable instruction sets (in `~/.claude/skills/`, mirrored in `.claude/skills/`).
PM-side and lane-side:

**PM (conductor) skills**
- `pm-control-plane` — read bus + CI → update board → assign next round.
- `worktree-pm-orchestrator` — plan work, write copy-paste lane prompts (in window order).
- `repo-pm-worktree-strategist` — audit lanes, recommend structure / merge order.
- `integration-merge-resolver` — rebase → resolve → **CI-green → merge**, one at a time.

**Lane (lead) skills**
- `start-lane` — one command: read this slot's assignment from the bus and begin.
- `worktree-summary-reporter` — produce a PM-ready report **and deliver it to `inbox/`**.
- `worktree-continuation` — on finish: self-audit → report → pull next safe task.

**Cross-cutting**
- `context-handoff` — checkpoint a long session for a clean reset (§6).

---

## 8. Visual verification — screenshots in CI

The local agent sandbox has no browser system libs, so it can't render the SPA. Instead,
`screenshots.yml` runs on a CI runner with a **real Chromium**: it boots the API + web,
runs every `e2e/drive-*.mjs` Playwright driver, and uploads the PNGs as a **downloadable
artifact** (Actions → run → Artifacts). That's how anyone reviews the actual rendered
dashboards without local setup.

---

## 9. A round, end to end

1. **PM assigns** — writes one assignment per lane to `outbox/<lane>/`, sets `allowed_paths`
   in `registry.json` so the round is conflict-free by construction.
2. **Lanes execute** — each window opens to its assignment, works only its slice, validates
   locally, opens a PR, sets `--auto`.
3. **CI gates** — PRs rebase + re-test against the moving main; green ones auto-merge.
4. **Lanes report** — the Stop hook forces a report (incl. self-evaluation) into `inbox/`.
5. **PM closes the round** — reads reports + main CI, runs any barrier lane solo, then
   either opens the next round or deploys.

A round of 4–5 lanes integrates in well under an hour, with conflicts approaching zero.

---

## 10. Why this is fast (the levers, for the team discussion)

| Lever | Effect |
|-------|--------|
| **Worktrees, not branch-switching** | N edits in flight, zero stash/switch tax. |
| **Disjoint `allowed_paths`** | Conflicts are *prevented*, not resolved. The biggest time sink in parallel work disappears. |
| **CI as sole merge authority + `strict`** | No "works on my machine" regressions reaching main; no human merge bottleneck. |
| **Auto-merge** | Green PRs land without waiting on a person. |
| **File-based bus + hooks** | Assignment, lane-guarding, and reporting are automatic — coordination overhead ≈ 0. |
| **Context-handoff** | Agent sessions stay in their fast regime instead of degrading. |
| **Barrier discipline** | The one class of unavoidable conflict (hub files) is sequenced deliberately, not discovered in a merge. |
| **Frozen CONTRACT** | Lanes integrate against a stable API shape; no churn-induced rework. |

### Where we can go faster next
- **Modularize the API hub files** (`chore-modularize`) so multiple API lanes can add
  endpoints without ever sharing a file — removes the last common-file barrier.
- **Promote `lane-guard` from optional to default** so ownership is enforced, not trusted.
- **Add a deploy-preview** per PR (Azure) so review happens on a live URL, not just CI.
- **Tighten the screenshot job** (CORS/api-base) so it captures populated dashboards, not
  error states — turning it into a visual regression gate.

---

## 11. Where everything lives

| Concern | Source of truth |
|---------|-----------------|
| Product architecture | [docs/ARCHITECTURE.md](ARCHITECTURE.md) |
| Why each choice | [docs/decisions.md](decisions.md) (ADR-01..21) |
| Frozen API/read-model contract | [docs/dashboard/CONTRACT.md](dashboard/CONTRACT.md) |
| Deep dives (tenancy, concurrency, idempotency, Azure, Angular) | [docs/tech/](tech/) |
| **How we work / velocity** | **this file** |
| Branch & merge rules | [docs/worktrees/WORKTREE-GITFLOW.md](worktrees/WORKTREE-GITFLOW.md) |
| Live coordination state | [.pm/](../.pm/) (registry, board, inbox/outbox, status) |
