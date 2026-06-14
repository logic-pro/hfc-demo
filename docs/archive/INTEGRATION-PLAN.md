# Integration Plan — reconciling the 7 worktrees

> Authoritative reconciliation plan after the parallel build. Supersedes the merge
> order in [INTEGRATION.md](INTEGRATION.md) (that file's plan assumed Slice D would
> stand down and predates the `corporate/` slice on `main`; both assumptions changed —
> see §1). Written by the PM after a per-branch review. Nothing is pushed; all
> branches are local commits.

## 0. Status — all 7 branches are sound

| Branch | Delivered | Conformance | Integration cost |
|---|---|---|---|
| `slice-a-auth-tenancy` | Token-claim two-axis tenancy, 8/8 tests | — | ✅ merged to `main` |
| `slice-b-ai-intake` | Claude tool-calling + heuristic fallback + guardrails, full stack | ROADMAP §5 | ✅ clean |
| `slice-c-nps-pipeline` | Durable ask-or-expire orchestration, `NpsSurvey` (denormalized `TerritoryId`), 12/12 smoke | ROADMAP §5 | ✅ clean |
| `slice-d-franchisee-dashboard` | Complete **franchisee ops** dashboard, live data, deposit action wired, Tailwind v4 | Operator view | ⚠️ shell/route + Tailwind + Seed.cs |
| `alpha` | `territory_period_summary` (§1 verbatim), 4 sub-scores+composite, watchlist, 24-territory seed | CONTRACT §1/§3/§4 | ⚠️ tenancy fork (~30 min) |
| `bravo` | 5 endpoints byte-for-byte §2, RBAC scope filter, swappable stub | CONTRACT §2 | 🔴 deletes `Auth.cs`; header-RBAC (~2–4 h) |
| `charlie` | Full **franchisor exec** dashboard (hero/map/scorecard/distribution/table), no-dep SVG, models verbatim §2 | CONTRACT §2 | ⚠️ shell/route + supersedes `corporate/` slice |

## 1. Two structural forks (the only real work)

### Fork 1 — tenancy (alpha + bravo branched before Slice A)
Both reverted to single-axis `BrandId` and deleted `api/Auth.cs`. `main` now carries Slice A's two-axis `FranchiseeId` model. A naive rebase **breaks the build** (main's `FranchiseeId` Domain/AppDb vs their `BrandId` filters/Seed) — a design fork, not a textual conflict.

- **alpha** (cheap, ~30 min): its read model is correctly boundary-agnostic (`RecomputeRollup` uses `IgnoreQueryFilters()` — corporate reads across franchisees, ADR-19). Resolve `AppDb`/`Seed` conflicts to adopt main's `FranchiseeId`; add a comment that the cross-tenant read is the sanctioned corporate aggregator.
- **bravo** (~2–4 h): rewire `DashboardScopeResolver.ScopeFor()` from the `X-Dashboard-Role`/`X-Franchisee-Id` headers to Slice A's claim seam (`TenantResolver.Populate` / `ctx.User`), and drop the `Auth.cs` deletion. The Slice A lead's instruction stands: **rebase RBAC onto `TenantResolver.Populate` — that's the single seam.** DTOs and the `IDashboardReadModel` interface are unaffected (no Charlie impact).

### Fork 2 — franchisor frontend (Charlie vs the `corporate/` slice) → **best of both**
Charlie is the base (complete drill path, no-dep SVG viz, models/fixtures verbatim §2, the D16 provenance-plane idea). Graft these from the `corporate/` slice, then retire its Angular components:

1. **Read-down auth seam (the important one).** Charlie's `DashboardDataService` live mode hits `/api/dashboard/corporate` with the default `HttpClient`, so `tenantInterceptor` would attach the **franchisee** token to a **cross-franchisee** endpoint. Graft the `corporate/` fix: skip the franchisee token for `/api/dashboard/*` (or `/api/corporate-dashboard/*`) in [tenant.interceptor.ts](../../web/src/app/tenant.interceptor.ts) and give the dashboard a corporate-scoped credential. **Do this as part of D17 (fixtures→live), not after.**
2. **Null-safe formatting.** Charlie's `formatValue` (`ui/health.ts`) takes a non-null `number` and would render `NaN`/`0` for missing live values. Adopt the `corporate/` util's `null → 'Unavailable'` guard.
3. **`unavailable` + gap-note state for D16.** Charlie shows financials as labeled `Illustrative` (good for the demo — a full-looking number). Extend D16 so the *genuinely unsourced* case degrades to the `corporate/` slice's dashed "unavailable + gap" treatment (e.g. *"Requires completed_job.invoiceAmount + territory.royalty_rate"*) instead of a fake number.
4. **Keep as design-of-record (not superseded):** ADR-18..21 in [decisions.md](../decisions.md) + [corporate-readmodel.sql](../architecture/corporate-readmodel.sql). Alpha's `territory_period_summary` is the demo subset of that "real platform" target.

**Retire:** `web/src/app/corporate/` Angular components (portfolio-page, kpi-grid, kpi-card, data-quality-badge) and reconcile to ONE shell with three routes: `/booking` (untouched), `/corporate` (Charlie, franchisor CEO), `/dashboard` (Slice D, franchisee operator).

## 2. Merge sequence

```
1. slice-b, slice-c        → main   (clean, independent — land first; C unblocks the NPS swap)
2. alpha                   → main   (rebase onto FranchiseeId; read model is boundary-agnostic)
3. bravo                   → main   (rewire RBAC to Slice A's token claim; drop Auth.cs deletion)
4. charlie                 → main   (reconcile shell+routes; D17 flip to live Bravo WITH the auth-seam graft)
5. D-NPS-SWAP                       (one-line: NPS seeded→measured via GET /api/nps, now C is in)
6. slice-d                 → main   (one reconciled shell; scope/lazy-load the Tailwind import)
```
The one hard ordering constraint: **Slice A before the dashboard RBAC goes live** (already satisfied — A is merged).

## 3. Decision log (answers to the lead questions)

| Lead | Question | Decision |
|---|---|---|
| Slice C | Does ADR-08 constrain NPS? | No — ADR-08 endorses the Durable pattern you used; no change. Visible after rebase onto main. |
| Slice C | Couple endpoint↔orchestration? | **Keep decoupled** (mirrors booking/deposit); event-coupling is a ~3-line Track-2 add. |
| Slice D | Ship deposit-volume-only, "revenue unavailable"? | **Yes** — honesty over a misleading proxy is the provenance principle. |
| Slice D | Derive funnel stages from columns? | **Yes** for the demo; persisting workflow state is a follow-up. |
| Alpha | Bravo reads via EF or a new Alpha API? | **Direct EF** behind Bravo's `IDashboardReadModel`; one API surface (Bravo's). |
| Alpha | Pull D-NPS-SWAP forward? | **Yes, after Slice C merges** — converts a seeded metric to measured, strengthening the provenance story. |
| Bravo | v1.1 additive `/api/dashboard/map`? | **Approved.** Do NOT add coords to the D9 list item (breaks the frozen §2 shape). |
| Charlie | Bravo status / DTO drift? | **No drift** — Bravo's DTOs and Charlie's models are both verbatim §2. D17 is a clean flip once Bravo is merged + running. |

## 4. Risks & verification gates

- **Tailwind global bleed (slice-d).** `@import "tailwindcss"` in global `styles.css` could touch the booking demo. Gate: visual-check `/booking` after merge; scope the import to the dashboard route if any regression.
- **Bravo live-shape parity.** Before flipping Charlie's D17, run one live call per endpoint and assert it matches `dashboard.models.ts` (the seam is built for this).
- **Seed.cs three-way merge** (alpha + slice-d both extend it on top of Slice A's Franchisee seed). Gate: boot + verify both the booking slots AND the dashboard demo data seed; spot-check one alpha "red story" survived the tenancy restructuring.
- **Two dashboards, one isolation story.** `/corporate` reads across franchisees (corporate scope, read-down); `/dashboard` is franchisee-scoped (Slice A filter). Confirm a franchisee token cannot reach `/api/dashboard/corporate` (the interceptor-skip graft + RBAC fail-closed both enforce this).
