# Dashboard Build — Backlog (delegatable to alpha / bravo / charlie worktrees)

> Demo target: **"demo now, real platform later"** + **maximum visual wow**.
> Charlie (UI/dataviz) is the showcase; Alpha feeds it believable data; Bravo
> delivers the contract fast. Build to [CONTRACT.md](CONTRACT.md), not to each other.
>
> Labels: `track1` (build now) · `track2` (north-star, design-only) ·
> `alpha`/`bravo`/`charlie` (owning worktree) · `wow` (visual-impact priority).
> Run [create-issues.sh](create-issues.sh) to materialize these as real GitHub
> issues **once a remote exists** (see note at bottom).

---

## Track 1 — Demo v1 (build this week)

### Alpha — Data & Read-Model Foundation (the spine)
- **D0** `alpha` Schema: add `Region`, `Franchisee`(+`franchiseeId`), `Brand.archetype`, an `Appointment` status covering completed/cancelled/no-show, and seed fields `invoiceAmount` + `royalty_rate`. _Blocks D2,D3._
- **D1** `alpha` `wow` Seed believable demo data: 3 brands across the 3 archetypes, 2 regions, **~24 territories with a deliberately dramatic performance spread** (clear top performers + 3–4 red at-risk), **+ lat/long per territory** so the map is alive. Realistic, not uniform.
- **D2** `alpha` Read-model table `territory_period_summary` (wide/typed per CONTRACT §1) + EnsureCreated/seed wiring.
- **D3** `alpha` `RecomputeRollup` job: territory→brand→corporate aggregation, provenance stamping, on-demand/boot trigger.
- **D4** `alpha` Health score: 4 sub-scores + composite, documented `franchise_ops_v1` weights, `financial=null→pending`, tenure-band adjustment (CONTRACT §3).
- **D5** `alpha` Watchlist flag computation in the rollup (rows only; event publish is Track 2).
- **D-NPS-SWAP** `alpha` `track1` Flip `nps_score` provenance `seeded→measured` when Slice C merges (one data-source line). _Depends on Slice C; NOT a blocker._

### Bravo — Dashboard API & Contract
- **D6** `bravo` `GET /api/dashboard/corporate` — vital signs + brand comparison (CONTRACT §2). May stub the read model until Alpha lands.
- **D7** `bravo` `GET /api/territories/{id}/health-score` — composite + 4 sub-scores + drivers + provenance.
- **D8** `bravo` `GET /api/dashboard/watchlist` — scoped flags.
- **D9** `bravo` `GET /api/territories` — paged/filterable registry (incl. lat/long for the map).
- **D10** `bravo` RBAC scope filter: `corporate` (all) + `franchisee` (own), applied **before** query; structured so 5 roles are a later config flip.

### Charlie — Angular Dashboard UI (the showcase) `wow`
- **D11** `charlie` `wow` **Executive theme + animated hero-8 KPI tiles** (value, sparkline, YoY delta, status color, provenance badge + as-of). The landing punch.
- **D12** `charlie` `wow` **Geographic territory health map** — territories as dots/regions shaded green/yellow/red by composite score; brand filter + at-risk overlay; hover→mini-card. _The single most jaw-dropping element — prioritize._
- **D13** `charlie` `wow` Territory **performance distribution** (quartile histogram) + ranked brand-comparison table, both click-to-drill.
- **D14** `charlie` `wow` Territory **scorecard**: composite **radial gauge** + 4 sub-score bars + top ± drivers + provenance labels. The "explainable score" reveal.
- **D15** `charlie` Watchlist **action queue** panel (severity-sorted, drill-to-territory).
- **D16** `charlie` `wow` **Provenance/data-quality visual**: measured vs reported/seeded legend + per-tile badges + as-of dates — the "we separate what we measure from what's reported" story.
- **D17** `charlie` Build against CONTRACT fixtures first; swap `api.service` to live Bravo endpoints when ready; smooth portfolio→brand→territory drill transitions.

### Shared
- **D18** `charlie`/`bravo` Wire the demo narrative + extend `e2e/smoke-api.sh` to cover the new endpoints; reset-to-clean seed path.

---

## Track 2 — North-star (design-only; do NOT build for the demo)
- **N1** `track2` Reported-plane integration (royalty/billing import → real financial sub-score + same-store growth).
- **N2** `track2` Watchlist eventing on Service Bus/Durable (`TerritoryFlagged`) — reuses Slice C backbone.
- **N3** `track2` Score config tables (`score_weight_version`/`config`, archetype + tenure overrides) — runtime-tunable by Franchise Ops.
- **N4** `track2` Full 5-role RBAC + access audit table.
- **N5** `track2` Region/brand/corporate fact tables + optional EAV + perf hardening to the §19 latency SLAs on Azure SQL.

---

## Review decisions captured (resolved in CONTRACT)
- **Wide table over EAV** for v1 (type safety, no request-time pivot).
- **Same-territory growth is seeded-only** and always labeled.
- **Latency SLAs are Azure-SQL targets**, not demo gates.

---

## Note on "git issues"
`hfc-demo` is a **local-only repo with no remote**, so there is no GitHub project to
create issues in yet. This backlog + `create-issues.sh` are the portable form. To get
real GitHub issues: create/attach a remote, then run `create-issues.sh`. **Pushing
this repo to GitHub is an outward-facing publish — get explicit go-ahead first**
(it may contain deploy URLs / interview-prep material).
