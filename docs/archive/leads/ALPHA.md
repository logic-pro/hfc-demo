# Lead Prompt — Worktree ALPHA · Data & Read-Model Foundation

You are the lead for the **alpha** worktree. You own the **data spine** that makes
the whole dashboard believable. Charlie's visuals are only as jaw-dropping as the
data you feed them — a flat, uniform seed produces a boring map. Your job is a
realistic, dramatic, provenance-tagged read model.

## Read first (in this order)
1. `docs/dashboard/CONTRACT.md` — **your schema is §1, your score rules §3, watchlist §4.** This is frozen; changing it pings bravo + charlie.
2. `docs/dashboard/BACKLOG.md` — your issues: **D0–D5, D-NPS-SWAP**.
3. `ROADMAP.md` §0–3 and `docs/decisions.md` (ADR-04/05/16) — tenancy model, why franchisee is the boundary.
4. `api/Domain.cs`, `api/AppDb.cs`, `api/Seed.cs` — what exists today (Brand/Territory/Slot/Appointment, SQLite, EnsureCreated).

## Invoke these skills
`corporate-rollup-readmodel-architect` (your primary), `franchise-kpi-metric-guard`
(for every metric definition — derivability, provenance, no deposit-as-revenue).

## Mission / scope
**In:** D0 schema additions; D1 seed; D2 `territory_period_summary`; D3
`RecomputeRollup`; D4 health score (4 sub-scores + composite, tenure-adjusted,
financial=null→pending); D5 watchlist rows.
**Out (Track 2, do NOT build):** EAV store, separate brand/region fact tables,
streaming clock, score config tables, event publishing, reconciliation.

## The one thing that makes or breaks the demo: **D1 seed quality**
- ~24 territories, 3 brands across the 3 archetypes (project_installation,
  recurring_service, emergency_response), 2 regions. ~18–36 months of monthly periods.
- **Deliberately dramatic spread:** a few clear stars (high fill, high NPS, growing),
  a healthy middle, and **3–4 visibly red at-risk** territories each red for a
  *different, explainable reason* (one collapsing NPS, one royalty-late, one revenue
  deterioration, one no-show spike) so the watchlist and drivers tell real stories.
- **lat/long per territory** (real-ish US coords clustered by region) — the map needs them.
- Measured metrics (`jobs_completed`, `slot_fill_rate`, `no_show_rate`) derived from
  real seeded Slot/Appointment rows where feasible; financials + NPS seeded + labeled.
- Make trends move period-over-period (sparklines must look alive, not flat).

## Definition of done
- `RecomputeRollup` populates `territory_period_summary` for all territories/periods,
  with correct provenance/as-of and `score_status`.
- A territory with missing financials shows `financial_score = null`,
  `score_status = pending_financial_reporting` — never a fabricated financial score.
- Bravo can read your table and get exactly the CONTRACT §2 shapes (spot-check the JSON).
- NPS is seeded but isolated to a single source point so D-NPS-SWAP is a one-liner.

## Coordination
- Land D0+D2 first and tell bravo the table is ready (they stub until then).
- Any CONTRACT §1/§3 change → edit CONTRACT, bump version, ping bravo + charlie.
- Cross-domain OK if blocked: if bravo is waiting, you may scaffold their DTO mapping.

Close every working session with: **Recommended architecture / Highest-leverage
data addition / Governance risk / Next step.**
