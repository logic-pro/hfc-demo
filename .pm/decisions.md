# Decisions (PM-owned · append-only · one entry per decision)

- **D1 — NPS tenancy scope:** `NpsSurvey` is franchisee-isolated (FranchiseeId filter) with BrandId+TerritoryId denormalized for the dashboard grain. *Why:* shares the appointment's isolation boundary; stays territory-resolvable without a join. (slice-c)
- **D2 — RBAC role claim: DEFERRED (Track 2).** bravo derives corporate-vs-franchisee from presence/absence of the `franchisee_id` claim, so no role claim is needed for the demo and no spoofable header is reintroduced. (slice-a follow-on parked)
- **D3 — bravo merges with the stub before its EF swap.** EF swap deferred to a post-alpha follow-up; bravo touches no AppDb/Domain/Seed so it doesn't block on alpha's schema. (Now alpha is merged → EF swap unblocked.)
- **D4 — Slug↔int bridge: `franchisee_slug`** added to `territory_period_summary` (CONTRACT v1.2, additive). alpha owns it; bravo maps the token slug → this column for the franchisee lens. v1.1 reserved for bravo's `/api/dashboard/map`.
- **D5 — CI is the merge authority.** Local self-reports are a pre-check; the PR's CI run gates the merge. (Proven: alpha self-reported 8/8 green, PR conflict-clean, merged → CI caught a real red on integrated main.)
- **D6 — Modularize after round 1.** The hub-file refactor (wt-modularize) runs only after bravo/charlie/echo land, branched off the settled main — running it mid-round would collide with every lane.
- **D7 — Smoke assertions assert a floor, not exact seed counts.** Fixed `franchisee catalog` check from `==16` to `>=16` after alpha's reseed grew it to 38 (PR #5).
- **D8 — Generic NATO slots.** Worktrees are reusable slots (alpha..echo); task/role/allowed_paths/skills reassigned per round via the bus. Physical dir rename (slice-a→delta, slice-d→echo) only when the slot's window is closed and (for echo) after its work merges.

## OPEN — needs a decision
- **O1 — Dashboard dir collision:** exec-ui (charlie) and franchisee (echo/slice-d) both targeted `web/src/app/dashboard/`. **Proposed:** charlie keeps `web/src/app/dashboard/` (corporate); franchisee moves to `web/src/app/franchisee/`. Confirm before echo rebases.
- **O2 — `/api/franchisees` catalog:** now returns 38 (16 operational + 22 dashboard). Should the booking picker filter to operational-only, or is 38 fine? (UX call.)
