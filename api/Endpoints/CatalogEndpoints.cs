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
        // Brand catalog — not tenant-filtered; a grouping over franchisees.
        app.MapGet("/api/brands", async (AppDb db) =>
            Results.Ok(await db.Brands.OrderBy(b => b.Name)
                .Select(b => new BrandDto(b.Id, b.Name, b.Tagline)).ToListAsync()))
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
                var f = await db.Franchisees.FirstOrDefaultAsync(x => x.Id == req.FranchiseeId);
                if (f is null) return Results.NotFound("Unknown franchisee.");
                var token = DevTokens.Mint(f.Id, f.BrandId,
                    signingKey: app.Configuration["Auth:DevSigningKey"]);
                return Results.Ok(new DevTokenResponse(token, f.Id, f.BrandId));
            }).AllowAnonymous();
        }
    }
}
