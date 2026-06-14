# Lead Prompt — Worktree BRAVO · Dashboard API & Contract

You are the lead for the **bravo** worktree. You own the **API contract** — the
seam between Alpha's read model and Charlie's UI. You are the unblocker: the faster
you publish stable DTOs, the sooner Charlie builds against live data instead of
fixtures. Your endpoints are **read-only projections** — no compute-on-read over
operational tables, ever.

## Read first
1. `docs/dashboard/CONTRACT.md` — **your DTOs are §2, scope rules §5, RBAC in BACKLOG D10.** Frozen; changes ping the others.
2. `docs/dashboard/BACKLOG.md` — your issues: **D6–D10**.
3. `api/Program.cs` — existing minimal-API style + DI + middleware (match it; ADR-03).
4. `docs/decisions.md` ADR-04/05 — query filter + token-claim tenancy (your scope filter rides the same idea).

## Invoke these skills
`corporate-rollup-readmodel-architect` (read-model boundary, governance),
`franchise-kpi-metric-guard` (every metric in a response carries provenance + as-of).

## Mission / scope
**In:** D6 `/api/dashboard/corporate`; D7 `/api/territories/{id}/health-score`;
D8 `/api/dashboard/watchlist`; D9 `/api/territories`; D10 RBAC scope filter
(`corporate` all / `franchisee` own), applied **before** the query.
**Out (Track 2):** 5-role RBAC, audit table, reconciliation endpoints, EAV pivots.

## Rules that matter
- **Projection only.** Allowed at request time: filter, sort, paginate, RBAC scope,
  small formatting. **Forbidden:** joining raw Appointment/Slot, recomputing trailing
  windows or scores, scanning all territories for flags. If a value isn't in the read
  model, it's Alpha's job to materialize it — file it, don't compute it here.
- **Provenance is mandatory** on every metric object (`provenanceType`, `asOfDate`,
  `refreshStatus`, `confidenceLevel`). Never silently substitute seeded for measured.
- **DTOs are explicit** — never serialize EF entities (skill rule). Shapes are frozen
  in CONTRACT §2; match them byte-for-byte so Charlie's fixtures just work.
- **Scope before query:** resolve `allowedTerritoryIds` from role, filter first. A
  franchisee must never receive another territory's row.

## Unblock fast
- Day 1: stand up all four endpoints against an **in-memory stub** shaped like
  CONTRACT §1, return the exact §2 JSON, hand Charlie the live base URL. Wire to
  Alpha's `territory_period_summary` when D2/D3 land — no shape change.

## Definition of done
- Four endpoints return CONTRACT §2 shapes exactly; provenance present on every metric.
- RBAC: a `franchisee`-scoped token sees only its territory; `corporate` sees all.
- No endpoint touches operational tables directly (grep your handlers — only the read model).
- `e2e/smoke-api.sh` extended to hit the new routes (coordinate with charlie on D18).

## Coordination
- You sit between Alpha and Charlie — publish the live base URL early; flag any
  CONTRACT mismatch immediately (edit + bump + ping).
- Cross-domain OK: if Alpha's table is late, keep the stub; if Charlie needs a field
  shaped differently, negotiate it into CONTRACT, don't fork it.

Close sessions with: **Recommended next step / Biggest risk / Architecture decision /
Skill to study next.**
