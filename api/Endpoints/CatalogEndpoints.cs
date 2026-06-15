using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// ── Catalog / login-picker plane ─────────────────────────────────────────────
// Untenanted lookups that back the demo's brand→franchisee login picker, plus
// the dev-only token mint that stands in for a B2C/Entra login. No tenant filter
// applies here: these lists exist so a caller can *choose* an identity before one
// is resolved. (The token claim — not these endpoints — is what scopes everything
// after login; see Auth.cs, the single tenancy seam.)
public static class CatalogEndpoints
{
    public static void MapCatalog(this WebApplication app)
    {
        // Brand catalog — not tenant-filtered; a grouping over franchisees. Carries
        // the numeric Num so the login picker can mint a brand-scope token.
        app.MapGet("/api/brands", async (AppDb db) =>
            Results.Ok(await db.Brands.OrderBy(b => b.Name)
                .Select(b => new BrandDto(b.Id, b.Name, b.Tagline, b.Num)).ToListAsync()))
            .AllowAnonymous();

        // Region catalog — untenanted reference backing the region-manager login
        // persona (its numeric id mints a region-scope token). Dashboard-set regions.
        app.MapGet("/api/regions", async (AppDb db) =>
            Results.Ok(await db.Regions.OrderBy(r => r.Name)
                .Select(r => new RegionDto(r.Id, r.Name)).ToListAsync()))
            .AllowAnonymous();

        // Franchisee catalog — untenanted. In production the franchisees a user may act
        // as come from their identity; here this list backs the demo's login picker.
        app.MapGet("/api/franchisees", async (AppDb db) =>
            Results.Ok(await db.Franchisees
                .Join(db.Brands, f => f.BrandId, br => br.Id, (f, br) => new { f, br })
                .OrderBy(x => x.br.Name).ThenBy(x => x.f.Region)
                .Select(x => new FranchiseeDto(x.f.Id, x.f.BrandId, x.br.Name, x.f.Name, x.f.Region))
                .ToListAsync()))
            .AllowAnonymous();

        // Dev-only: exchange a franchisee selection for a signed token (stands in for a
        // B2C / Entra login). Gated to Development so it never ships a token mint to prod.
        if (app.Environment.IsDevelopment())
        {
            app.MapPost("/api/dev/token", async (DevTokenRequest req, AppDb db) =>
            {
                var key = app.Configuration["Auth:DevSigningKey"];
                // Normalize the read-down tier from either wording: `scope`
                // (network|brand|region) as the web login picker sends, or `role`
                // (the corporate/network alias). Each mints a scoped read-down token.
                var tier = (req.Scope ?? req.Role)?.ToLowerInvariant();
                switch (tier)
                {
                    case "network":
                    case HfcClaims.CorporateRole:                       // "corporate"
                        return Results.Ok(new DevTokenResponse(
                            DevTokens.MintCorporate(signingKey: key), null, null, "network"));

                    case HfcClaims.BrandRole:                           // "brand"
                        if (req.BrandId is not int bid)
                            return Results.BadRequest("brand scope requires a numeric brandId.");
                        if (!await db.Brands.AnyAsync(b => b.Num == bid))
                            return Results.NotFound("Unknown brand.");
                        return Results.Ok(new DevTokenResponse(
                            DevTokens.MintBrand(bid, signingKey: key), null, null, "brand"));

                    case HfcClaims.RegionRole:                          // "region"
                        if (req.RegionId is not int rid)
                            return Results.BadRequest("region scope requires a numeric regionId.");
                        if (!await db.Regions.AnyAsync(r => r.Id == rid))
                            return Results.NotFound("Unknown region.");
                        return Results.Ok(new DevTokenResponse(
                            DevTokens.MintRegion(rid, signingKey: key), null, null, "region"));
                }

                // Franchisee (operator) login: unchanged — exchange a franchisee
                // selection for a tenant-scoped token.
                if (string.IsNullOrWhiteSpace(req.FranchiseeId))
                    return Results.BadRequest("Provide a scope (network|brand|region) or a franchiseeId.");

                var f = await db.Franchisees.FirstOrDefaultAsync(x => x.Id == req.FranchiseeId);
                if (f is null) return Results.NotFound("Unknown franchisee.");
                var token = DevTokens.Mint(f.Id, f.BrandId, signingKey: key);
                return Results.Ok(new DevTokenResponse(token, f.Id, f.BrandId, "franchisee"));
            }).AllowAnonymous();
        }
    }
}
