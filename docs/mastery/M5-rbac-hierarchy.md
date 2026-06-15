# M5 — RBAC over brand → region → territory

> Scoped JWT claims, policy-based authorization, the **read-down** pattern, and how a verified claim resolves to a query-time territory allow-set. Grounded in `api/Auth.cs`, `api/Dashboard/DashboardScope.cs`, and `api/Dashboard/DashboardEndpoints.cs`.

Cross-links: [[M1-multitenancy]] (the tenant isolation seam this RBAC layer sits on top of) · [[M7-bi-readmodels]] (the read model whose rows the allow-set filters).

---

## 1. Mental model

There are **two different access questions** in HFC, and conflating them is the classic mistake:

1. **Tenant isolation (write/operate)** — *"can this franchisee touch this row?"* Answered by the EF global query filter keyed on `franchisee_id`. A franchisee reads/writes only its **own** rows. (See [[M1-multitenancy]].)
2. **Franchisor read-down (report)** — *"can this corporate user read **across** tenants?"* A franchisor is **not** a bigger tenant — it has *no* `franchisee_id`. It reads the **portfolio**: every franchisee's rolled-up numbers. (See [[M7-bi-readmodels]].)

The hierarchy is **brand → region → territory**. A territory is the leaf (one franchisee operating one geography). Regions group territories; brands group regions. The RBAC design says: **your role pins you to a level, and your level resolves to the set of territory IDs you may see.** Corporate = the whole tree. A region manager = the subtree under their region. A franchisee = its own leaf territories.

The unifying primitive is an **allow-set of territory IDs**. Every level — corporate, brand, region, franchisee — collapses to "which territory IDs may this caller see?" Handlers filter the read model to that set **before** anything else. Corporate is modeled as `null` = unrestricted; everyone else is a concrete `HashSet<int>`; an unknown identity yields an **empty** set = fail-closed (sees nothing, never everything).

```
role/claim  ──ScopeFor──▶  AllowedTerritoryIds  ──.Allows(id) / .Where──▶  rows
corporate   ──────────────▶ null (all)
brand:7     ──────────────▶ {territories under brand 7}     (design / in progress)
region:31   ──────────────▶ {territories under region 31}   (design / in progress)
franchisee  ──────────────▶ {its own territories}           (LIVE)
(none)      ──────────────▶ {} empty → fail-closed
```

**Current state (be precise about this in the interview):**
- **LIVE today:** the **corporate** lens and the **franchisee** lens. Two tiers, both shipped and tested.
- **In progress:** the **brand** and **region** tiers — the "4-tier completion." The plumbing is deliberately built to absorb them as *a claim read*, not a rewrite (more in §6). I frame brand/region as **the design plus the in-flight extension**, not as something I'm claiming is already running.

---

## 2. Scoped JWT claims — identity becomes scope

`api/Auth.cs` is described in its own header as *"the single seam where a verified identity becomes the tenant"* (`api/Auth.cs:9-19`). Two claim shapes flow through the **identical** validation pipeline.

**Claim names are centralized** so the IdP mapping changes in one place (`api/Auth.cs:24-32`):

```csharp
public static class HfcClaims
{
    public const string FranchiseeId = "franchisee_id";  // the isolation key
    public const string BrandId = "brand_id";             // the grouping
    // Franchisor (read-down) role. A `corporate` value admits the executive
    // dashboard endpoints via the "Corporate" policy; a franchisee principal
    // carries `franchisee_id` instead and is tenant-scoped, never corporate.
    public const string CorporateRole = "corporate";
}
```

Two distinguishing facts to memorize:
- A **franchisee** token carries a `franchisee_id` claim and **no** corporate role → tenant-scoped.
- A **corporate** token carries the `corporate` **role** claim and **no** `franchisee_id` → read-down, never tenant-scoped.

**The franchisee mint** (`api/Auth.cs:77-96`) — note the `franchisee_id` + `brand_id` claims:

```csharp
public static string Mint(string franchiseeId, string brandId, ...)
{
    ...
    claims: new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, $"{franchiseeId}@dev"),
        new Claim(HfcClaims.FranchiseeId, franchiseeId),
        new Claim(HfcClaims.BrandId, brandId),
    },
    ...
}
```

**The corporate mint** (`api/Auth.cs:103-121`) — a role claim, deliberately **no** `franchisee_id`:

```csharp
// Mint a CORPORATE (franchisor) token: a verified principal carrying the
// corporate ROLE claim and NO franchisee_id ...
public static string MintCorporate(...)
{
    ...
    claims: new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, "corporate@dev"),
        new Claim(ClaimTypes.Role, HfcClaims.CorporateRole),
    },
    ...
}
```

`MintCorporate` is the **additive sibling** of `Mint` — the franchisee path is unchanged, same dev signing/issuer/audience/lifetime, so *"it travels the identical validation pipeline"* (`api/Auth.cs:98-102`). That is the whole point: corporate is not a bypass, it's another valid token shape.

> **The brand/region extension (design):** the in-progress tiers add `brand:N` / `region:N` scope claims to the token (the role claim says *what kind* of user, the scope claim says *which subtree*). A region-manager token would carry `role=region` (or the corporate role plus) and a `region_id` scope claim. Nothing else in the pipeline changes — validation is the same; only `ScopeFor` learns one more branch (§6).

**Validation rigor (same in dev and prod).** If `Auth:Authority` is set, tokens validate against the real IdP's JWKS (Entra ID / Azure AD B2C, RS256). Otherwise a symmetric dev key is used **with the same validation parameters** (`api/Auth.cs:131-167`) — issuer, audience, lifetime, signing key all validated. There is *"never a 'trust the header' shortcut"* (`api/Auth.cs:128-130`). This matters because the *old* demo trusted `X-Dashboard-Role` / `X-Franchisee-Id` headers (see `DashboardScope.cs:11-13`); the seam now reads only signed claims.

---

## 3. Policy-based authorization — the "Corporate" policy

Policy names live in one place (`api/Auth.cs:35-38`):

```csharp
public static class HfcPolicies { public const string Corporate = "Corporate"; }
```

The policy is registered as a simple role requirement (`api/Auth.cs:172-176`):

```csharp
services.AddAuthorization(options =>
{
    options.AddPolicy(HfcPolicies.Corporate, policy =>
        policy.RequireRole(HfcClaims.CorporateRole));
});
```

`RequireRole(HfcClaims.CorporateRole)` matches the `corporate` role claim minted by `MintCorporate` (default `RoleClaimType = ClaimTypes.Role`). The comment at `api/Auth.cs:168-171` states the design boundary explicitly: *"Franchisee tenancy is unaffected — it flows through the query filter, not a policy."* That sentence is the entire architecture in one line:

- **Corporate access = a policy** (role gate at the endpoint edge).
- **Franchisee access = a query filter** (data gate, per-row, via the allow-set / EF filter).

They are orthogonal layers. The policy decides *who may enter the franchisor endpoint at all*; the filter decides *which rows a tenant may see*.

---

## 4. The READ-DOWN pattern — why corporate endpoints are *role-gated, not tenant-gated*

A franchisor's whole job is to read **across** tenants — to compare brands, rank territories, spot the watchlist. So the corporate endpoints **must not** be tenant-scoped; if you applied the franchisee query filter to a corporate user, they'd see nothing (no `franchisee_id` → empty set → fail-closed). Instead they are **role-gated**: prove you're corporate, then you get the unrestricted lens.

This is visible directly in the endpoints. The corporate, watchlist, and map endpoints all end with `.RequireAuthorization("Corporate")`:

```csharp
// D6 — Corporate vital signs + brand comparison (pre-rolled).
app.MapGet("/api/dashboard/corporate", (...) => { ... })
   .RequireAuthorization("Corporate");                 // DashboardEndpoints.cs:24,53
...
app.MapGet("/api/dashboard/watchlist", (...) => { ... })
   .RequireAuthorization("Corporate");                 // DashboardEndpoints.cs:80,103
...
app.MapGet("/api/dashboard/map", (...) => { ... })
   .RequireAuthorization("Corporate");                 // DashboardEndpoints.cs:107,126
```

The corporate handler also defends in depth — even past the policy it re-asserts the lens (`DashboardEndpoints.cs:29-34`):

```csharp
// The corporate roll-up is a portfolio aggregate; narrowing it to one
// franchisee would require request-time re-aggregation (forbidden).
if (!scope.IsCorporate)
    return Results.Problem(statusCode: 403,
        title: "Corporate scope required for the corporate dashboard.");
```

Contrast the **per-territory** endpoints, which are merely **authenticated** and lean on the allow-set so a franchisee is scoped to its own rows (`DashboardEndpoints.cs:56-77`, `129-153`):

```csharp
app.MapGet("/api/territories/{id:int}/health-score", (...) =>
{
    // Scope BEFORE lookup: a franchisee never reads another's territory.
    if (!holder.Scope.Allows(id))
        return Results.Problem(statusCode: 403, title: "Territory outside your scope.");
    ...
}).RequireAuthorization();   // authenticated; franchisee lens scopes to own (D10)
```

So the gating split is intentional:

| Endpoint | Gate | Why |
|---|---|---|
| `/api/dashboard/corporate`, `/watchlist`, `/map` | `RequireAuthorization("Corporate")` | portfolio roll-up — franchisor-only, **read-down across tenants** |
| `/api/territories`, `/api/territories/{id}/health-score` | `RequireAuthorization()` (any verified user) | franchisee lens hard-scopes to own rows via the allow-set |

---

## 5. Scope → query filter — the allow-set

`DashboardScope` (`api/Dashboard/DashboardScope.cs:16-34`) is the resolved permission. The key is the nullable allow-set and its semantics:

```csharp
// null => unrestricted (corporate). Non-null => the only territories this
// caller may see. Empty set => fail-closed (sees nothing).
public IReadOnlySet<int>? AllowedTerritoryIds { get; init; }

public bool IsCorporate => ScopeLevel == "corporate";
public bool Allows(int territoryId) =>
    AllowedTerritoryIds is null || AllowedTerritoryIds.Contains(territoryId);
```

`Allows` is the single chokepoint. `null` → everything (corporate); a set → membership test; empty set → nothing. Memorize the three-way semantics — they are the failure-mode safety net.

**Resolution** happens in `ScopeFor` (`DashboardScope.cs:49-87`). The presence of a `franchisee_id` claim selects the franchisee lens; its absence is the corporate lens.

```csharp
public static DashboardScope ScopeFor(ClaimsPrincipal? user, IDashboardReadModel readModel)
{
    var franchiseeId = user?.FindFirst(HfcClaims.FranchiseeId)?.Value;

    if (!string.IsNullOrWhiteSpace(franchiseeId))
    {
        // Franchisee lens: scope to exactly this franchisee's territories ...
        // An id that matches no territory yields an EMPTY allow-set => fail-closed.
        var allowed = readModel.Territories
            .Where(t => !string.IsNullOrEmpty(t.FranchiseeSlug)
                && string.Equals(t.FranchiseeSlug, franchiseeId, StringComparison.OrdinalIgnoreCase))
            .Select(t => t.TerritoryId)
            .ToHashSet();

        return new DashboardScope {
            ScopeLevel = "franchisee", FranchiseeId = franchiseeId, AllowedTerritoryIds = allowed,
        };
    }

    // No franchisee_id claim => corporate lens (all).
    return new DashboardScope { ScopeLevel = "corporate", AllowedTerritoryIds = null };
}
```

The allow-set is built from the **read-model dimension** (`readModel.Territories`), not from the operational DB — the dashboard reads the pre-rolled model (see [[M7-bi-readmodels]]). Note the slug reconciliation comment (`DashboardScope.cs:58-66`): the read model keys franchisee by integer but also carries the operational `FranchiseeSlug`, and Slice A's claim **is** that slug, so the match is slug-to-slug.

**The filter is applied FIRST** in every handler — "scope first," before query-param filters, sort, paginate (`DashboardEndpoints.cs:88,111,137`):

```csharp
var items = rm.Watchlist
    .Where(w => scope.Allows(w.TerritoryId))    // scope first   (DashboardEndpoints.cs:88)
    .Where(w => brandId is null || ...)
    ...
```

### How a region manager sees their region's territories but not others (the claim + the WHERE)

This is the brand/region case made concrete — **design + in-progress extension**, not yet live:

1. **The claim.** The region-manager token carries a scope claim, e.g. `region_id = 31` (alongside its role). The token validates through the same pipeline as today's two tiers.
2. **The resolve.** `ScopeFor` gains a branch (between the franchisee and corporate branches) that reads the `region_id` claim and builds the allow-set from the dimension:

   ```csharp
   // PROPOSED brand/region branch (extends ScopeFor — DashboardScope.cs ~line 80):
   var regionId = user?.FindFirst(HfcClaims.RegionId)?.Value;   // new HfcClaims const
   if (int.TryParse(regionId, out var rid))
   {
       var allowed = readModel.Territories
           .Where(t => t.RegionId == rid)        // the subtree under this region
           .Select(t => t.TerritoryId)
           .ToHashSet();                          // empty if region unknown => fail-closed
       return new DashboardScope { ScopeLevel = "region", AllowedTerritoryIds = allowed };
   }
   ```
3. **The WHERE.** Nothing at the call sites changes. `scope.Allows(t.TerritoryId)` already filters every endpoint; a region manager's allow-set contains region 31's territory IDs only, so `.Where(t => holder.Scope.Allows(t.TerritoryId))` (`DashboardEndpoints.cs:111,137`) returns region 31's rows and silently drops the rest. Territories in region 32 are never in the set, so they never appear and `/{id}/health-score` returns **403** for them via `Allows(id)` (`DashboardEndpoints.cs:60`).

Brand works the same way one level up: `brand:7` → `.Where(t => t.BrandId == 7)`. The design intent is encoded already — the endpoints even accept `brandId`/`regionId` **query** filters today (`DashboardEndpoints.cs:89-90,112-113,138-139`); the tier work makes those a *security* boundary (from the claim) rather than only a convenience filter.

---

## 6. HFC tie-in

HFC is a multi-brand home-services franchisor. The franchisor CEO/exec needs the **read-down** view — compare brands, rank regions, find the at-risk territories — while each franchisee must stay boxed into its own data. The brand→region→territory tree is HFC's actual org chart, and "RBAC over that tree" is literally on the role's stack. The two-question split (tenant filter vs. corporate policy) is what lets *one* API serve both the operator surface and the executive surface without one leaking into the other. The 4-tier completion (adding brand + region managers) is a live roadmap item, and the code is **pre-shaped** for it: `DashboardScope.cs:14-15` says it's *"structured so adding the 5 Track-2 roles is a claim read (extend ScopeFor), not a rewrite of call sites,"* and `Auth.cs:16-18` says roles *"live in the same principal, so role resolution is one more line ... no new plumbing, no second source of truth."*

---

## 7. Trade-offs — claims-in-token vs. DB lookup per request

The design puts scope-determining **identity** in the token (role, `franchisee_id`, future `region_id`) but resolves the **allow-set** from the read model at request time. Worth being able to defend both halves.

| | Claims in the token | DB lookup per request |
|---|---|---|
| **Latency** | No round trip — the gate is in-memory | Extra query on every request |
| **Revocation** | Stale until token expiry (8h here, `Auth.cs:93,118`) | Immediate — reflects current grants |
| **Coupling** | API trusts the IdP's claim mapping | API owns the authz source of truth |
| **Token size** | Grows if you embed the full territory list | Token stays tiny |

**HFC's actual choice is a hybrid, and that's the strong answer:** the **role/level** is a claim (cheap, stable, set by the IdP), but the **concrete territory allow-set** is derived from the read model per request (`ScopeFor` queries `readModel.Territories`). So we get fast policy gating *and* an allow-set that tracks the current territory→franchisee/region/brand mapping without re-minting tokens when a territory is reassigned. We deliberately do **not** stuff the territory ID list into the JWT — it would bloat the token and go stale the moment the org chart changes. The cost we accept is role-level revocation latency, bounded by the 8h lifetime; for an executive reporting surface that is acceptable, and a shorter lifetime or IdP-side revocation covers the high-stakes case.

---

## 8. Failure modes

1. **Corporate endpoint left anonymous → full-portfolio leak (a REAL bug we closed).** Before `feat/corporate-role`, the dashboard endpoints were **open**. With no token, `ScopeFor` defaulted to the **corporate** lens (`DashboardScope.cs:81-87`), so *"an anonymous caller read the whole portfolio"* — the exact words in `DashboardEndpoints.cs:12-21`. The fix: `.RequireAuthorization("Corporate")` on `/corporate`, `/watchlist`, `/map`, and `.RequireAuthorization()` on the territory endpoints, so anonymous is *"rejected before the scope is even resolved."* This is the headline failure mode: **a permissive default at the scope layer is only safe if the edge is gated** — defense in depth, but the edge gate is load-bearing.

2. **Over-broad scope → cross-tenant leak.** If `ScopeFor` returned `null` (= all) for a franchisee — say a claim-parsing bug, or treating "no matching territory" as "all" instead of empty — that franchisee reads every tenant's rows. The code guards this precisely: an unmatched `franchisee_id` yields an **empty** `HashSet`, *"fail-closed (no rows), never all"* (`DashboardScope.cs:56-57`). The invariant: **absence of a positive grant must collapse to empty, never to unrestricted.**

3. **Scope applied after filtering / not at all.** If a handler forgot `.Where(scope.Allows(...))` or applied it after pagination, scoped rows could slip into the page count or the payload. The convention "scope first" (`DashboardEndpoints.cs:88,111,137`) exists to make this auditable — the scope predicate is always the first `.Where`.

4. **Trusting client input for scope.** The retired `X-Dashboard-Role` / `X-Franchisee-Id` headers (`DashboardScope.cs:11-13`) were spoofable — any caller could claim corporate. Resolved by reading **only** the verified claim. The lesson: scope must come from a signed token, never a header or query param the client controls.

5. **Brand/region tier shipped without the WHERE.** When adding the tiers, the danger is minting a `region` token whose `ScopeFor` branch isn't wired — it would fall through to the corporate (`null`/all) default and leak the portfolio. Mitigation: a new role/level **must** ship its `ScopeFor` branch and a fail-closed default in the *same* change; add a test that an unknown/region token is **not** corporate.

---

## 9. Interview defense (follow-ups + answers)

**Q: Why role-gate the corporate endpoints instead of tenant-gating them like everything else?**
A: Because a franchisor reads *across* tenants — that's the read-down pattern. A corporate user has no `franchisee_id`, so the tenant query filter would resolve to an empty allow-set and they'd see nothing. The corporate roll-up is a portfolio aggregate; you can't narrow it to one tenant without re-aggregating at request time, which we forbid. So corporate access is a **policy** (`RequireAuthorization("Corporate")`, `DashboardEndpoints.cs:53`) and franchisee access is a **filter** — orthogonal layers, stated outright at `Auth.cs:168-171`.

**Q: You put role in the JWT but look up the territory list per request — why not put everything in the token, or nothing?**
A: Hybrid on purpose. Role/level is stable and IdP-owned, so it's a cheap in-memory claim. The concrete allow-set tracks the org chart, which changes (territories get reassigned) — embedding it would bloat the token and go stale, forcing a re-mint on every reassignment. Deriving it from the read model per request keeps tokens small and the mapping fresh. The cost is role-level revocation latency bounded by the 8h lifetime (`Auth.cs:118`), acceptable for a reporting surface; shorten the lifetime or use IdP revocation if a grant must be killed instantly.

**Q: How would you add the region-manager tier without touching every endpoint?**
A: It's already shaped for it. Add a `region_id` scope claim to the token (same validation pipeline) and one branch to `ScopeFor` that builds the allow-set as `Territories.Where(t => t.RegionId == rid)` with an empty-set fail-closed default. No call site changes because every handler already filters via `scope.Allows(...)` — the design note at `DashboardScope.cs:14-15` calls this out: *"adding the roles is a claim read, not a rewrite of call sites."* The one rule: ship the `ScopeFor` branch in the same change as the new token, or it falls through to corporate-all and leaks.

**Q: What was the worst RBAC bug in this codebase and how did you find/fix it?**
A: The dashboard endpoints were anonymous, and because `ScopeFor` defaults a no-`franchisee_id` caller to the **corporate** (all) lens, an unauthenticated request read the entire portfolio (`DashboardEndpoints.cs:12-21`). The default was convenient for the zero-config demo but a leak in prod. Fix: gate the edge — `RequireAuthorization("Corporate")` on the franchisor endpoints, `RequireAuthorization()` on the rest — so anonymous is rejected before scope is even resolved. Defense in depth (the in-handler `IsCorporate` recheck at `DashboardEndpoints.cs:32` stays), but the edge gate is the real fix.

---

## 10. Demo proof

**(a) Corporate endpoint returns 401 without a token.** With the auth gate live, an unauthenticated call is rejected at the edge:

```bash
# No Authorization header → 401 (rejected before ScopeFor runs)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/api/dashboard/corporate
# => 401
```

**(b) A corporate token gets in; a franchisee token is 403 on the corporate endpoint.**

```bash
# Corporate token (MintCorporate: role=corporate, no franchisee_id) → 200, full portfolio
curl -s -H "Authorization: Bearer $CORP_TOKEN" http://localhost:5000/api/dashboard/corporate | jq '.scope'
# => { "scopeLevel": "corporate", "territoryIds": [] }   (empty = ALL, per CONTRACT §2 / DashboardScope.cs:31-33)

# Franchisee token on the corporate endpoint → 403 (policy + in-handler IsCorporate recheck)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $FRAN_TOKEN" \
  http://localhost:5000/api/dashboard/corporate
# => 403
```

**(c) Scope narrows the rows.** Same `/api/territories` endpoint, two tokens — the franchisee sees only its own:

```bash
# Corporate: every territory
curl -s -H "Authorization: Bearer $CORP_TOKEN" "http://localhost:5000/api/territories" \
  | jq '.total'                      # => e.g. 24 (whole portfolio)

# Franchisee: only its own territories (allow-set from ScopeFor)
curl -s -H "Authorization: Bearer $FRAN_TOKEN" "http://localhost:5000/api/territories" \
  | jq '.total'                      # => e.g. 2 (its own only)

# Out-of-scope territory health → 403 (Allows(id) is false; DashboardEndpoints.cs:60)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $FRAN_TOKEN" \
  "http://localhost:5000/api/territories/999/health-score"
# => 403  "Territory outside your scope."
```

The mechanism: the franchisee token's `franchisee_id` claim → `ScopeFor` builds a 2-element `AllowedTerritoryIds` set → `.Where(t => holder.Scope.Allows(t.TerritoryId))` (`DashboardEndpoints.cs:137`) drops everything else. The corporate token has no `franchisee_id` → allow-set `null` → `Allows` returns `true` for all.

---

## Flashcards

1. **Q:** What are the two different access questions in HFC RBAC? **A:** (1) Tenant isolation — can this franchisee touch this row? (query filter on `franchisee_id`). (2) Franchisor read-down — can corporate read *across* tenants? (the "Corporate" policy). Orthogonal layers.

2. **Q:** What claim does a franchisee token carry, and what does a corporate token carry instead? **A:** Franchisee: `franchisee_id` (+ `brand_id`), no role. Corporate: `corporate` **role** claim, **no** `franchisee_id`. (`Auth.cs:77-96`, `103-121`)

3. **Q:** How is the "Corporate" policy defined? **A:** `policy.RequireRole(HfcClaims.CorporateRole)` matching the `corporate` role claim, default `RoleClaimType = ClaimTypes.Role`. (`Auth.cs:174-175`)

4. **Q:** Why are corporate endpoints role-gated, not tenant-gated? **A:** A franchisor reads across tenants and has no `franchisee_id`; tenant-gating would yield an empty allow-set (nothing). Read-down = role gate. (`Auth.cs:168-171`)

5. **Q:** What are the three states of `AllowedTerritoryIds` and their meaning? **A:** `null` = unrestricted (corporate); non-null set = exactly these; empty set = fail-closed (nothing). (`DashboardScope.cs:23-29`)

6. **Q:** What selects the franchisee vs. corporate lens in `ScopeFor`? **A:** Presence of a `franchisee_id` claim → franchisee lens; absence → corporate (all). (`DashboardScope.cs:51-87`)

7. **Q:** What happens if a franchisee's `franchisee_id` matches no territory? **A:** Empty allow-set → fail-closed (no rows), never all. (`DashboardScope.cs:56-57`)

8. **Q:** What was the real RBAC bug that got closed? **A:** Dashboard endpoints were anonymous; no token → corporate (all) default → anonymous read the whole portfolio. Fixed with `RequireAuthorization`. (`DashboardEndpoints.cs:12-21`)

9. **Q:** Which tiers are LIVE vs. in progress? **A:** LIVE: corporate + franchisee. In progress: brand + region (the 4-tier completion).

10. **Q:** How does a region manager get scoped to their region (design)? **A:** `region_id` scope claim → new `ScopeFor` branch builds `Territories.Where(t => t.RegionId == rid)` allow-set → existing `scope.Allows` WHERE filters every endpoint. No call-site changes.

11. **Q:** Where is the scope filter applied in each handler, and why there? **A:** First — "scope first," before query-param filters/sort/paginate, so it's auditable and rows can't leak into counts. (`DashboardEndpoints.cs:88,111,137`)

12. **Q:** Claims-in-token vs. DB-lookup — what's HFC's choice? **A:** Hybrid: role/level is a token claim (cheap, stable); the concrete territory allow-set is derived from the read model per request (fresh, no token bloat). Cost: role revocation bounded by 8h lifetime.

---

## Mock Q&A

**1. Walk me through what happens, end to end, when a franchisee hits `/api/territories`.**
The JWT bearer pipeline validates signature/issuer/audience/lifetime (`Auth.cs:131-167`). `RequireAuthorization()` confirms an authenticated principal — anonymous is rejected here. Middleware runs `ScopeFor`: it finds the `franchisee_id` claim and builds an allow-set of that franchisee's territory IDs from `readModel.Territories` (`DashboardScope.cs:67-71`). The handler filters scope-first: `.Where(t => holder.Scope.Allows(t.TerritoryId))` (`DashboardEndpoints.cs:137`), then applies query params, paginates, maps to DTO. The franchisee sees only its own rows.
- *Follow-up: what if they pass `?brandId=` for a brand they don't own?* It's an extra `.Where` after the scope filter (`DashboardEndpoints.cs:138`) — purely a convenience narrowing on rows already scoped to them, so it can't widen access. Scope is the security boundary; the query param is filtering within it.

**2. A franchisee calls the corporate dashboard. What happens and at which layer?**
Two layers. First the policy: `.RequireAuthorization("Corporate")` requires the `corporate` role, which a franchisee token doesn't have → **403** at the edge (`DashboardEndpoints.cs:53`). Even if that were bypassed, the handler rechecks `if (!scope.IsCorporate) return 403` (`DashboardEndpoints.cs:32-34`). Defense in depth.
- *Follow-up: why not just let the franchisee see a franchisee-scoped version of the corporate roll-up?* Because the roll-up is a pre-aggregated portfolio metric; scoping it to one tenant would require re-aggregating at request time, which the design forbids (`DashboardEndpoints.cs:29-31`). Franchisees use the territory-scoped endpoints instead.

**3. Design the region-manager tier. What changes, and what's the risk?**
Add a `region_id` scope claim to the token (same validation pipeline, additive like `MintCorporate`). Add one branch to `ScopeFor` reading that claim and building `Territories.Where(t => t.RegionId == rid).Select(t => t.TerritoryId).ToHashSet()`, with empty-set fail-closed. No endpoint changes — every handler already filters via `scope.Allows` (`DashboardScope.cs:14-15`). The risk: if you mint the region token without wiring `ScopeFor`, it falls through to the corporate (`null`/all) default and leaks the portfolio — so the branch and a "region token is not corporate" test must ship in the same change.
- *Follow-up: brand managers too?* Same pattern one level up — `brand_id` claim → `.Where(t => t.BrandId == bid)`. The endpoints already accept `brandId`/`regionId` as query filters (`DashboardEndpoints.cs:89-90`); the tier makes them a claim-driven security boundary.

**4. Defend putting the role in the JWT but not the territory list.**
Role is stable and IdP-owned — cheap to carry, rarely changes. The territory list tracks the org chart, which *does* change (reassignments); embedding it bloats the token and forces a re-mint on every change, and it goes stale between mints. So I derive the allow-set from the read model per request — small tokens, always-current mapping. The trade-off is revocation latency at the role level, bounded by the 8h lifetime (`Auth.cs:118`); for an exec reporting surface that's fine, and I'd shorten the lifetime or use IdP revocation for must-kill-now cases.
- *Follow-up: what breaks if the read model is stale relative to the operational DB?* The allow-set is computed from the read-model dimension, so a freshly created territory not yet rolled up wouldn't appear in scope until the next roll-up. That's a freshness window, not a leak — it fails closed (omits rows), which is the safe direction. (See [[M7-bi-readmodels]].)

**5. Why does an empty allow-set mean "nothing" instead of "everything"? Couldn't that be a bug?**
It's the deliberate fail-closed invariant. `Allows` returns true only when the set is `null` (corporate) or contains the id; an empty *non-null* set matches nothing (`DashboardScope.cs:28-29`). A franchisee whose id matches no territory therefore sees zero rows, never all (`DashboardScope.cs:56-57`). The dangerous inversion — empty meaning all — is exactly the cross-tenant leak we design against: absence of a positive grant must collapse to empty.
- *Follow-up: but corporate is `null` = all — isn't that the same danger?* Corporate's `null` is reached *only* on the no-`franchisee_id` path, and the edge already requires the corporate role for the all-portfolio endpoints. So "all" is unreachable without the corporate policy passing first. That's why the anonymous-default bug (`DashboardEndpoints.cs:12-21`) was serious — it left the edge ungated, exposing the `null`/all default to anyone.
