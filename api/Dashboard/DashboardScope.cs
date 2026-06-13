namespace HfcDemo.Dashboard;

// ── D10 — RBAC scope filter (applied BEFORE the read-model query) ────────────
// Two lenses for v1 (CONTRACT §0): `corporate` sees all territories; `franchisee`
// sees only its own. The scope resolves to a concrete allow-set, and handlers
// filter to it FIRST — a franchisee can never receive another territory's row.
//
// Demo-vs-prod parity mirrors ADR-05: here the role/identity come from headers
// (spoofable — say so), in prod from the authenticated token's claims. The
// FILTER doesn't change, only the *source* of role + franchisee id. Structured
// so adding the 5 Track-2 roles is a config flip (extend ScopeFor), not a
// rewrite of the call sites.
public sealed class DashboardScope
{
    public string ScopeLevel { get; init; } = "corporate";
    public int? FranchiseeId { get; init; }

    // null => unrestricted (corporate). Non-null => the only territories this
    // caller may see. Empty set => fail-closed (sees nothing).
    public IReadOnlySet<int>? AllowedTerritoryIds { get; init; }

    public bool IsCorporate => ScopeLevel == "corporate";
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
    public const string RoleHeader = "X-Dashboard-Role";        // corporate | franchisee
    public const string FranchiseeHeader = "X-Franchisee-Id";   // int, required for franchisee

    public static DashboardScope ScopeFor(IHeaderDictionary headers, IDashboardReadModel readModel)
    {
        var role = headers.TryGetValue(RoleHeader, out var r) ? r.ToString().Trim().ToLowerInvariant() : "";

        if (role == "franchisee")
        {
            int? franchiseeId = headers.TryGetValue(FranchiseeHeader, out var f)
                && int.TryParse(f.ToString(), out var id) ? id : null;

            // Resolve the allow-set from the read-model dimension. Missing/unknown
            // franchisee id => empty set => fail-closed (no rows), never all.
            var allowed = franchiseeId is null
                ? new HashSet<int>()
                : readModel.Territories
                    .Where(t => t.FranchiseeId == franchiseeId)
                    .Select(t => t.TerritoryId)
                    .ToHashSet();

            return new DashboardScope
            {
                ScopeLevel = "franchisee",
                FranchiseeId = franchiseeId,
                AllowedTerritoryIds = allowed,
            };
        }

        // Default lens is corporate (zero-config demo). Like ADR-05's header
        // tenant, this is convenient and insecure — prod binds it to a claim.
        return new DashboardScope { ScopeLevel = "corporate", AllowedTerritoryIds = null };
    }
}
