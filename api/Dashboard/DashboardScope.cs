using System.Security.Claims;

namespace HfcDemo.Dashboard;

// ── D10 — RBAC scope filter (applied BEFORE the read-model query) ────────────
// Two lenses for v1 (CONTRACT §0): `corporate` sees all territories; `franchisee`
// sees only its own. The scope resolves to a concrete allow-set, and handlers
// filter to it FIRST — a franchisee can never receive another territory's row.
//
// Scope source is Slice A's tenancy seam (api/Auth.cs): role + franchisee id come
// from the VERIFIED token claim on ctx.User, never a client header. (The previous
// X-Dashboard-Role / X-Franchisee-Id headers were the pre-Slice-A demo stand-in;
// rewired per INTEGRATION.md #1 "rebase scope onto A's token claim".) The FILTER
// is unchanged — only the *source* moved header → claim. Structured so adding the
// 5 Track-2 roles is a claim read (extend ScopeFor), not a rewrite of call sites.
public sealed class DashboardScope
{
    public string ScopeLevel { get; init; } = "corporate";
    // Operational franchisee slug from the claim (matches Slice A's TenantContext);
    // null for the corporate lens. Informational — the boundary is AllowedTerritoryIds.
    public string? FranchiseeId { get; init; }

    // The numeric brand/region the read-down scope narrows to (null for network /
    // franchisee). Drives which pre-baked scoped roll-up the corporate handler reads.
    public int? ScopeBrandId { get; init; }
    public int? ScopeRegionId { get; init; }

    // null => unrestricted (corporate). Non-null => the only territories this
    // caller may see. Empty set => fail-closed (sees nothing).
    public IReadOnlySet<int>? AllowedTerritoryIds { get; init; }

    public bool IsCorporate => ScopeLevel == "corporate";
    // The franchisor read-down plane (network / brand / region) — all three may
    // open the executive dashboard; only `franchisee` (the operator) may not.
    public bool IsReadDown =>
        ScopeLevel is "corporate" or "brand" or "region";
    public bool Allows(int territoryId) =>
        AllowedTerritoryIds is null || AllowedTerritoryIds.Contains(territoryId);

    // CONTRACT §2 corporate `scope.territoryIds`: [] for corporate (= all).
    public int[] TerritoryIdsForEcho =>
        AllowedTerritoryIds?.OrderBy(x => x).ToArray() ?? Array.Empty<int>();
}

// Scoped per-request holder, set by middleware (mirrors TenantContext).
public sealed class DashboardScopeHolder
{
    public DashboardScope Scope { get; set; } = new();
}

public static class DashboardScopeResolver
{
    // RBAC scope derives from the VERIFIED token claim (Slice A's seam in
    // api/Auth.cs), never a client header: the `franchisee_id` claim is the
    // isolation key, and its presence selects the franchisee lens. A franchisee
    // therefore cannot widen its own view by sending a header — the lens is
    // pinned to the signed token.
    public static DashboardScope ScopeFor(ClaimsPrincipal? user, IDashboardReadModel readModel)
    {
        // ── Read-down hierarchy (network → brand → region) from the role + scope-id
        // claims minted by the role-based login. Each narrows the territory set; the
        // "Corporate" policy has already admitted them at the endpoint. ────────────
        if (user?.IsInRole(HfcClaims.CorporateRole) == true)
            return new DashboardScope { ScopeLevel = "corporate", AllowedTerritoryIds = null };

        if (user?.IsInRole(HfcClaims.BrandRole) == true)
        {
            int? brandId = ParseId(user.FindFirst(HfcClaims.ScopeBrandId)?.Value);
            var allowed = brandId is int bid
                ? readModel.Territories.Where(t => t.BrandId == bid).Select(t => t.TerritoryId).ToHashSet()
                : new HashSet<int>();                          // missing id => fail-closed
            return new DashboardScope
            {
                ScopeLevel = "brand", ScopeBrandId = brandId, AllowedTerritoryIds = allowed,
            };
        }

        if (user?.IsInRole(HfcClaims.RegionRole) == true)
        {
            int? regionId = ParseId(user.FindFirst(HfcClaims.ScopeRegionId)?.Value);
            var allowed = regionId is int rid
                ? readModel.Territories.Where(t => t.RegionId == rid).Select(t => t.TerritoryId).ToHashSet()
                : new HashSet<int>();                          // missing id => fail-closed
            return new DashboardScope
            {
                ScopeLevel = "region", ScopeRegionId = regionId, AllowedTerritoryIds = allowed,
            };
        }

        var franchiseeId = user?.FindFirst(HfcClaims.FranchiseeId)?.Value;

        if (!string.IsNullOrWhiteSpace(franchiseeId))
        {
            // Franchisee lens: scope to exactly this franchisee's territories,
            // resolved from the read-model dimension. An id that matches no
            // territory yields an EMPTY allow-set => fail-closed (no rows), never all.
            //
            // Slug↔read-model reconciliation (INTEGRATION.md #1, now landed): the read
            // model keys franchisee by INTEGER (CONTRACT §1), but each dimension also
            // carries the operational franchisee SLUG (CONTRACT §1 v1.2 `franchisee_slug`,
            // sourced from `territory_period_summary.FranchiseeSlug`). Slice A's claim
            // IS that slug, so we match claim→dim slug-to-slug. A franchisee with no
            // dashboard territories (e.g. a booking-only operational franchisee) still
            // resolves to an EMPTY set — fail-closed — and the corporate lens / 403 /
            // unknown-id boundaries are unaffected.
            var allowed = readModel.Territories
                .Where(t => !string.IsNullOrEmpty(t.FranchiseeSlug)
                    && string.Equals(t.FranchiseeSlug, franchiseeId, StringComparison.OrdinalIgnoreCase))
                .Select(t => t.TerritoryId)
                .ToHashSet();

            return new DashboardScope
            {
                ScopeLevel = "franchisee",
                FranchiseeId = franchiseeId,
                AllowedTerritoryIds = allowed,
            };
        }

        // (ParseId lives at the bottom of this class.)

        // No franchisee_id claim => corporate lens (all). In the demo this also
        // covers anonymous access (the corporate dashboard is the zero-config
        // default; the endpoints are not auth-gated). In prod a franchisor
        // principal carries a corporate app-role and no franchisee_id — still
        // claim-gated, never the old spoofable header.
        return new DashboardScope { ScopeLevel = "corporate", AllowedTerritoryIds = null };
    }

    private static int? ParseId(string? raw) =>
        int.TryParse(raw, out var n) ? n : null;
}
