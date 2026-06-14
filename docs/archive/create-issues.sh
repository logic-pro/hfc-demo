#!/usr/bin/env bash
# Materialize the dashboard backlog as real GitHub issues.
# PREREQUISITE: hfc-demo must have a GitHub remote (it currently does NOT).
#   1) Create a repo:   gh repo create <owner>/hfc-demo --private --source=. --remote=origin
#   2) Then run:        bash docs/dashboard/create-issues.sh
# Idempotency: re-running creates duplicates. Run once.
set -euo pipefail

repo_check() { git remote get-url origin >/dev/null 2>&1 || { echo "No 'origin' remote. See header."; exit 1; }; }
repo_check

# --- labels (ignore errors if they already exist) ---
gh label create track1   --color 1D76DB --description "Build now (demo v1)"        2>/dev/null || true
gh label create track2   --color C5DEF5 --description "North-star, design-only"    2>/dev/null || true
gh label create alpha    --color 0E8A16 --description "Worktree: data/read-model"  2>/dev/null || true
gh label create bravo    --color FBCA04 --description "Worktree: API/contract"      2>/dev/null || true
gh label create charlie  --color D93F0B --description "Worktree: Angular UI"        2>/dev/null || true
gh label create wow      --color B60205 --description "Visual-impact priority"      2>/dev/null || true

iss() { gh issue create --title "$1" --label "$2" --body "$3"; }

# --- Track 1 :: Alpha ---
iss "D0  Schema: Region, Franchisee, Brand.archetype, Appointment status, seed revenue/royalty fields" "track1,alpha" "Add Region, Franchisee(+franchiseeId), Brand.archetype, an Appointment status (completed/cancelled/no-show), and seed fields invoiceAmount + royalty_rate. Blocks D2,D3. See docs/dashboard/CONTRACT.md."
iss "D1  Seed believable demo data with dramatic spread + lat/long [wow]" "track1,alpha,wow" "3 brands across 3 archetypes, 2 regions, ~24 territories with a deliberately dramatic performance spread (clear top performers + 3-4 red at-risk) and lat/long per territory so the map is alive. Realistic, not uniform."
iss "D2  Read-model table territory_period_summary (wide/typed)" "track1,alpha" "Per CONTRACT.md S1. Wide typed columns, per-group provenance, EnsureCreated/seed wiring."
iss "D3  RecomputeRollup job (territory->brand->corporate)" "track1,alpha" "On-demand/boot trigger. Aggregation + provenance stamping. No streaming."
iss "D4  Health score: 4 sub-scores + composite, tenure-adjusted" "track1,alpha" "franchise_ops_v1 documented weights, financial=null->pending, tenure bands. CONTRACT.md S3."
iss "D5  Watchlist flag computation in rollup (rows only)" "track1,alpha" "Event publish deferred to Track 2. CONTRACT.md S4."
iss "D-NPS-SWAP  Flip nps_score seeded->measured when Slice C merges" "track1,alpha" "One data-source line. Depends on Slice C. NOT a blocker."

# --- Track 1 :: Bravo ---
iss "D6  GET /api/dashboard/corporate" "track1,bravo" "Vital signs + brand comparison. CONTRACT.md S2. May stub read model until Alpha lands."
iss "D7  GET /api/territories/{id}/health-score" "track1,bravo" "Composite + 4 sub-scores + drivers + provenance. CONTRACT.md S2."
iss "D8  GET /api/dashboard/watchlist" "track1,bravo" "Scoped flags. CONTRACT.md S2."
iss "D9  GET /api/territories registry (paged, incl lat/long)" "track1,bravo" "Filterable by brand/region/status/archetype."
iss "D10 RBAC scope filter: corporate + franchisee lens" "track1,bravo" "Applied before query; structured so 5 roles are a later config flip."

# --- Track 1 :: Charlie (showcase) ---
iss "D11 Executive theme + animated hero-8 KPI tiles [wow]" "track1,charlie,wow" "Bespoke command-center aesthetic (NOT default Material). Value, sparkline, YoY delta, status color, provenance badge + as-of. See LEAD prompt for design identity."
iss "D12 Geographic territory health map [wow]" "track1,charlie,wow" "Territories shaded green/yellow/red by composite; brand filter + at-risk overlay; hover mini-card. The single most jaw-dropping element."
iss "D13 Performance distribution + ranked brand table [wow]" "track1,charlie,wow" "Quartile histogram + brand comparison; click-to-drill."
iss "D14 Territory scorecard: radial gauge + sub-scores + drivers [wow]" "track1,charlie,wow" "Composite radial gauge, 4 sub-score bars, top +/- drivers, provenance labels."
iss "D15 Watchlist action queue panel" "track1,charlie" "Severity-sorted, drill-to-territory."
iss "D16 Provenance / data-quality visual [wow]" "track1,charlie,wow" "Measured vs reported/seeded legend + per-tile badges + as-of. The honest-data story."
iss "D17 Fixtures-first, then live wiring + drill transitions" "track1,charlie" "Build against CONTRACT fixtures, swap api.service to live endpoints, smooth portfolio->brand->territory drill."
iss "D18 Demo narrative + smoke test + clean seed reset" "track1,charlie" "Extend e2e/smoke-api.sh for new endpoints."

# --- Track 2 (design-only) ---
iss "N1  Reported-plane integration (royalty/billing import)" "track2" "Activates real financial sub-score + same-store growth."
iss "N2  Watchlist eventing on Service Bus/Durable" "track2" "TerritoryFlagged; reuses Slice C backbone."
iss "N3  Score config tables (version/tenure/archetype weights)" "track2" "Runtime-tunable by Franchise Ops."
iss "N4  Full 5-role RBAC + access audit" "track2" ""
iss "N5  Fact tables + optional EAV + Azure-SQL perf hardening" "track2" "Region/brand/corporate grains; latency SLAs."

echo "Done. Created dashboard backlog issues."
