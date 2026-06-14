# HFC Demo — Architecture & Workflow

The one doc that explains *where everything is* and *how we work here*: the
workspace layout, the application architecture, and the multi-agent dev workflow.

---

## 1. Workspace layout

```
interview-workspace/                 ← outer workspace (.claude/skills mirror lives here)
└── hfc-workspace/                   ← umbrella the PM session opens
    ├── open-worktrees.sh            ← open every worktree slot in its own VS Code window
    ├── open-hfc.sh                  ← deprecated shim → open-worktrees.sh --all
    ├── hfc-demo/                    ← THE REPO (git root, github.com/logic-pro/hfc-demo)
    │   ├── api/                     ← ASP.NET Core 9 minimal API + EF Core
    │   ├── web/                     ← Angular 20 SPA (standalone + signals)
    │   ├── functions/               ← Azure Durable Functions (booking + NPS orchestrations)
    │   ├── tests/                   ← xUnit + WebApplicationFactory (tenancy + concurrency)
    │   ├── e2e/                     ← smoke-api.sh + Playwright drivers
    │   ├── infra/                   ← Bicep IaC + deploy.sh
    │   ├── .github/workflows/ci.yml ← the CI green-gate (build + test + web AOT + smoke)
    │   ├── .claude/skills/          ← repo-shipped skills
    │   ├── .pm/                     ← multi-agent control plane (see §3 + .pm/README.md)
    │   └── docs/                    ← this file + ADRs + tech + dashboard coordination
    └── hfc-demo-worktrees/          ← parallel execution slots (git worktrees)
        ├── alpha  bravo  charlie    ← reusable NATO slots
        ├── delta  echo              ← (delta = free slot; echo = franchisee UI, in-flight)
        └── chore-modularize         ← special-purpose lane (round-2 enabler)
```

A **git worktree** is a second working directory sharing the repo's `.git`. Each
slot is an independent checkout on its own branch, so multiple agents work in
parallel without switching branches. The PM session sits at the umbrella and can
read/write into every worktree by path.

---

## 2. Application architecture

**Stack:** ASP.NET Core 9 (minimal API) · EF Core (SQLite local / Azure SQL prod) ·
Angular 20 (standalone components, signals) · Azure Durable Functions · Bicep IaC.
See [decisions.md](decisions.md) (ADR-01..21) for the *why* behind each choice.

**Multi-tenancy (the core invariant).** Tenant + role come from a **verified token
claim** (`TenantResolver.Populate` in `api/Auth.cs`), never a client header. Two
axes: **`franchiseeId` = isolation boundary**, **`brandId` = grouping**. An EF
global query filter keys on `franchiseeId` and is **fail-closed** (no claim → zero
rows). [ADR-04/05/16]

**Two data planes.**
- *Operational* (franchisee-owned): `Slot`, `Appointment`, `Estimate`, `NpsSurvey`, … — tenant-filtered.
- *Corporate read model* (cross-franchisee, read-only): `territory_period_summary` + `watchlist_flag`, built by `RecomputeRollup` (the one sanctioned cross-tenant aggregator via `IgnoreQueryFilters`). The franchisor dashboard reads **only** this plane, never operational tables. [ADR-19, CONTRACT §1]

**Key flows already shipped:** booking with optimistic-concurrency 409 [ADR-06] ·
idempotent deposits [ADR-07] · AI-assisted intake (`api/Intake.cs`, Claude
tool-calling + heuristic fallback) · post-service NPS → review-gen Durable
orchestration (`functions/NpsWorkflow.cs`).

**Two dashboards (distinct audiences):**
- `/corporate` — **franchisor executive** dashboard (cross-brand portfolio; reads the corporate read model). API in `api/Dashboard/*` to the frozen **CONTRACT §2** DTOs.
- `/dashboard` — **franchisee operator** dashboard (one franchisee's own bookings/deposits/no-shows; tenant-scoped).
- Both live behind **one Angular shell** with three routes: `/booking`, `/corporate`, `/dashboard`.

**Provenance is first-class:** every dashboard metric carries `provenanceType` +
`asOfDate` + `refreshStatus` (measured vs reported/seeded/unavailable). Deposits
and estimates are **never** shown as revenue. [ADR-20]

---

## 3. Multi-agent development workflow

**Roles.** A **PM/conductor** session (the umbrella) coordinates; **lead** sessions
each own one worktree slot. Separate Claude sessions can't message each other, so
they coordinate through a **file bus**, not chat.

**The control plane — `.pm/`** (full spec in [.pm/README.md](../.pm/README.md)):
`registry.json` (slots→branch→allowed_paths→skills) · `board.md` · `decisions.md`
· `risks.md` · `inbox/` (lead→PM) · `outbox/<slot>/` (PM→lead) · `status/<slot>.md`.
PM is the **single writer** of registry/board/decisions; leads append unique inbox
files + own one status file.

**Slots, not feature branches.** Worktrees are **reusable NATO slots** (`alpha`…`echo`);
the task/scope/skills are reassigned per round via the registry. A finished, merged
slot is **retired** (or reassigned), not kept busy with invented work.

**Skills (the behavior protocol):**
| Skill | Side | Purpose |
|---|---|---|
| `pm-control-plane` | PM | run the bus loop → assign work |
| `worktree-pm-orchestrator` | PM | plan + write per-lane copy-paste prompts |
| `repo-pm-worktree-strategist` | PM | audit worktrees → recommend structure |
| `integration-merge-resolver` | PM/conductor | rebase → resolve → CI-green → merge, one at a time |
| `worktree-continuation` | lead | on finish: report → pull next (≤1 safe cycle) or idle-clean |
| `worktree-summary-reporter` | lead | produce the PM-ready status report |

**Git flow (GitHub Flow, rapid integration).** One always-deployable `main`;
short-lived feature branches; **rebase often, merge-when-green, re-sync after every
merge.** See [worktrees/WORKTREE-GITFLOW.md](worktrees/WORKTREE-GITFLOW.md).

**The merge gate.** **CI green on the PR is the merge authority — not self-reports.**
(Learned the hard way: a lane self-reported all-green, its PR was conflict-clean, it
merged, and CI caught a real red on the integrated trunk — fixed via a follow-up PR.)

**Conflict prevention.** The deep fix is **disjoint file ownership** (each slot edits
only its `allowed_paths`); `Program.cs`/`AppDb.cs`/`Seed.cs` are shared chokepoints,
which is why a single-writer merge order is used until the `wt-modularize` lane
splits them into per-feature files. An **opt-in `PreToolUse` lane-guard hook**
(`.pm/hooks/lane-guard.sh`, fail-open) can enforce ownership deterministically.

**The loop:**
```
PM assigns (outbox) → lead implements (in allowed_paths) → lead validates locally
→ worktree-continuation: report to inbox + update status, pull next
→ pm-control-plane: read inbox + CI → update board → assign next
→ conductor: merge PRs that are CI-green, one at a time → broadcast new main SHA → all re-sync
```

---

## 4. Invariants (do not break)
- Tenant/role from the **token claim**; never a client header. Don't touch `api/Auth.cs` semantics or revert to BrandId-only.
- The franchisor dashboard reads the **corporate read model**, never operational tables.
- **CONTRACT §2 DTOs are frozen** — byte-for-byte. Changes bump the contract version + ping leads.
- **CI green** is required to merge.
- Edit only your slot's **`allowed_paths`**; cross-lane needs go to `.pm/inbox/`, never directly to another worktree.

---

## 5. Doc map
- **This file** — architecture + workflow (start here).
- [decisions.md](decisions.md) — ADR-01..21 (every technical trade-off).
- [.pm/README.md](../.pm/README.md) — the control-plane / bus spec.
- [dashboard/CONTRACT.md](dashboard/CONTRACT.md) — frozen read-model + API DTOs.
- [worktrees/WORKTREE-GITFLOW.md](worktrees/WORKTREE-GITFLOW.md) — branch/merge rules.
- [architecture/corporate-readmodel.sql](architecture/corporate-readmodel.sql) — "real platform" read-model DDL (Alpha's demo table is a subset).
- [architecture/enterprise-jmfamily.md](architecture/enterprise-jmfamily.md) — business/scaling context.
- [tech/](tech/) — per-technology deep-dives (ASP.NET, Angular, EF, Durable, Azure, multitenancy).

> **Note (doc consolidation pending):** several older coordination docs overlap
> (`dashboard/INTEGRATION.md`, `INTEGRATION-PLAN.md`, `LEAD-PROMPTS.md`, the two
> prompt sets under `dashboard/prompts/`, `docs/pm-audit-20260613/`). The intended
> single source of truth going forward is **`.pm/`** + this file; the rest should be
> archived. See housekeeping notes.

---

## 6. Common commands
```bash
# open all worktree slots (labelled with branch + current task)
./open-worktrees.sh                 # or --all for umbrella+main too; --dry-run to preview

# build / test / run (from hfc-demo/)
dotnet build api/api.csproj
dotnet test tests/HfcDemo.Tests.csproj
(cd web && npm ci && npm run build)
./e2e/smoke-api.sh                  # against a running API

# deploy (see run-hfc-demo skill / infra/deploy.sh)
```
