# PM Board (PM-owned · single writer)

**Trunk:** `origin/main = 3a303dc` (#46 HFC theme system; redesign DEPLOYED LIVE 2026-06-16). **Round:** Back-Office Wave 1 OPEN.
**Last reconcile:** 2026-06-16Tm — new initiative round assigned.

## 🟢 Back-Office Wave 1 — OPEN (2026-06-16Tm)
Initiative: turn the 3-surface demo into a franchisor back-office at `/back-office` (corporate-scope), anchored by a
**full custom report builder** + **Territory Explorer**, with Users&Roles / Org&Catalog sections. Plan: `docs/backoffice/ROADMAP.md` · contracts: `docs/backoffice/CONTRACTS.md`. DISJOINT paths → parallel; `/start-lane` in each window.

**Trunk now:** `origin/main = 7c882ef` (foundation #48 · infra #49 · reporting-api #50 · report-builder #51 · territory #52 · seed/operator-data #54 all merged).

| Slot | Branch | Mission | State |
|---|---|---|---|
| chore-modularize | feat/backoffice-shell | FOUNDATION: shell+nav+routes+ComingSoon+stubs | ✅ MERGED (PR #48) |
| alpha | feat/reporting-api | Reporting API: catalog/query/saved CRUD (contract owner) | ✅ MERGED (PR #50) |
| charlie | feat/report-builder-ui | Report builder UI (flagship) + CSV/XLSX export | ✅ MERGED (PR #51) |
| bravo | feat/territory-explorer | Territory Explorer + scorecard drill-down | ✅ MERGED (PR #52) |
| delta | chore/deploy-hardening | Harden deploy.sh + CI gate | ✅ MERGED (PR #49) |
| (PM hotfix) | feat/seed-operator-data | Seed: every operational franchisee gets activity (user ask) + tenancy/smoke test hardening | ✅ MERGED (PR #54) |
| echo | test/backoffice-e2e | e2e: BO nav RBAC + builder + drill-down | ⏸ PR #53 CONFLICTING — needs rebase onto 7c882ef (overlaps PM's smoke-api.sh fixes; resolve additively) |
| chore-modularize (m2) | chore/backoffice-prettier | FOLLOW-UP: prettier-clean backoffice/** (D15) | 📥 assigned — /start-lane to pull |

**Remaining to close Wave 1:** (1) rebase+merge echo #53; (2) redeploy code-only so operator-data + /back-office go live; (3) chore-modularize prettier (m2) → delta flips lint to hard-gate.
**Merge order:** Foundation ✅ → Infra ✅ → Reporting API ✅ → (Reports UI ✅ ∥ Territory ✅) → seed ✅ → prettier → e2e.
**Open cross-lane:** delta's back-office lint is non-blocking until backoffice/** is prettier-clean (D15); delta flips it hard in a follow-up.
**C1 note:** Foundation finalized admin route as `/back-office/admin/catalog` (not `/admin/org`); reports/territories stub paths match contract exactly — no cross-lane impact.
**Deploy of record:** redesign pushed code-only to live Central US App Service (Bicep skipped; RG-meta eastus2 vs resources centralus — delta to fix). post-deploy-e2e green.

---
### Prior round (CLOSED) — hardening/QA + redesign

The corporate-dashboard + 4-tier-RBAC + 8-brand-seed + hardening work all shipped (through PR #37). The build is
demo-ready: Executive / Operator / Scheduling surfaces, honestly-scoped read-down RBAC, problem+json errors, real
/healthz, no cold starts. Open backlog is small.

**Start-lane round (2026-06-15T22:10Z):** fresh assignments in `outbox/<slot>/2026-06-15k__*`; prior ones archived to `.pm/archive/<slot>/`. DISJOINT path ownership → all 6 run in parallel. Run `/start-lane` in each window.

| Slot | Assignment (/start-lane picks it up) | Writes | Output |
|---|---|---|---|
| chore-modularize | Land the Seed/Config api refactor (D10) | `api/**` | PR → auto-merge |
| charlie | Root-fix global heading CSS + drop #38 workaround (after #38 merges) | `web/**` | PR → auto-merge |
| echo | Assert PR #38 franchisee fixes in e2e + drive post-deploy gate green | `e2e/**` | PR → auto-merge |
| delta | Harden CI quality gate (web build+lint on PR; verify post-deploy auto-trigger) | `.github/`,`scripts/` | PR → auto-merge |
| alpha | READ-ONLY QA pass (/qa-integration-tester) → go/no-go | none | report to inbox |
| bravo | READ-ONLY API contract + security audit (/security-review) | none | report to inbox |

## k-round RESULT (2026-06-16T00:45Z) — ALL LANDED
- ✅ #38 franchisee polish · ✅ #39 CI gate (delta) · ✅ #40 heading CSS root-fix (charlie) · ✅ #41 Seed/Config split (chore) · ✅ #42 e2e franchisee asserts (echo). chore idle-clean; api/ now FREE.

## Consolidated demo verdict — **GO** (alpha QA + bravo audit)
- **alpha QA: GO.** Build green; 39/39 live smoke; 4-tier RBAC + tenant isolation proven with real cross-scope attacks; provenance honest; all 3 surfaces render. Zero Critical, zero High.
- **bravo audit: security spine SHIP-OK.** RBAC/authZ, problem+json, DTO conformance, JWT, tenant isolation, headers all PASS. BUT real gaps below.

## NPS-measured — ✅ DONE (D11, PR #43 merged)
- Landed onto the new `api/Seed/**`. Terr {1,3,9,13,18,21} → Measured (NpsSurvey rows on real completed appointments); other 42 stay Illustrative; terr 23 stays pending. 39/39 smoke green, no count/watchlist drift. alpha stash now redundant (work merged) — safe to drop.
- Minor note (not acted): `EfDashboardReadModel` still hardcodes the corporate NPS *vital-sign* provenanceType="seeded" (lines 162/216) — the territory `RefreshStatus` is the in-scope honesty signal and flips correctly; the network roll-up badge staying "seeded" is defensible (it's a seeded aggregate). Revisit only if the exec NPS badge needs to read measured.

## api-validation E1/E2 — 🔄 LANDING (PR #44, auto-merge armed, CI running)
- All 6 fixes in: deposit amountCents required & >=1 (400 before any state mutation), booking required-fields before slot lookup (400), NPS score required (int?, 400), operator period unknown→400 (valid set = WTD/MTD/QTD/YTD only; LTM rejected), corporate unknown periodId→404 (matches health-score), pagination page>=1/pageSize 1..100→400. All problem+json. smoke 50/50 (8 new negative assertions). Closes the lost `fix/api-validation` set.

## Territory map markers — 🔄 FIXED (PR #45, auto-merge armed)
- Map rendered no dots + distribution histogram collapsed: `/api/territories` (`TerritoryListItemDto`) omitted lat/lng + compositeScore → web `project()`=NaN → SVG dropped every circle. Fix: additive `Lat,Lng,CompositeScore,ScoreStatus` on the list DTO, projected like `/api/dashboard/map`. smoke 53/53. Scope correct (corporate 49 / brand 8). (Salvaged a partial agent run after 3× 529 overload + a zombie-API port clash during local smoke.)

## Territory map markers — ✅ MERGED (PR #45)

## Theme work — user clarified: KEEP the dark theme, just HFC-accent the highlights
- **PR #47 (RECOMMENDED, in review, no auto-merge):** surgical — swap the dark theme's teal chrome accent → HFC amber `#f99c1c` / orange `#e7602a` (glows, sparkline, map glow, ambient). Navy base + cool ink + semantic health ramp UNCHANGED. Web-only, dev build green. This is exactly the user's stated ask.
- **PR #46 (ON HOLD — do NOT merge as-is):** the full light/dark toggle + token system + franchisee visual lift. It re-toned the dark BASE to warm-charcoal — broader than the user wants ("I really like what we already did with the dark theme"). Branch preserved; revisit only if the user wants the light/dark toggle + franchisee lift (would need its dark base retuned back to navy first).
- Palette source of truth: `.pm/parked/hfc-brand-theme.md`.

## STILL QUEUED (LOW — not started)
- bravo A1/E3/S1 (LOW): scope-resolver default lens → fail-closed-empty; problem+json on Conflict/dev-token bare strings; tighten CORS from AllowAnyOrigin.
- Obs#1 (demo polish): seed a deposit-paid slice so operator funnels aren't all-leak.

## ⚠ PROCESS RISK (logged to risks.md)
Two planned items — `fix/api-validation` AND `feat/nps-measured` — were reported "merged" in earlier stand-downs but **only their branch tips merged; the actual feature commits never landed.** Caught by bravo + alpha. Trust CI/diff, not self-reported "merged".

**Earlier follow-ups still open:** `web/src/styles.css` global heading rule root-fixed in #40 ✅. Deposit $0 confirmed genuine (no deposits seeded), not a bug.

**Parked (roadmap, not assigned):** charlie Phase 3 light/dark theme toggle — non-load-bearing polish; revive only on idle.

**Gate reminder:** CI green on the PR is the merge authority — not self-reports.
**Latent bug RESOLVED:** tenant.interceptor token-strip on `/api/dashboard/territories` — fixed on main (attach-to-all).
