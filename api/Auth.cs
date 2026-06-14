using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

namespace HfcDemo;

// ─────────────────────────────────────────────────────────────────────────────
// AUTH & TENANCY SEAM
// This file is the single seam where a *verified* identity becomes the tenant.
// Nothing downstream (handlers, query filter) trusts client-supplied input — it
// reads only the scoped TenantContext, which is populated here from claims that
// the JWT pipeline has already validated (signature, issuer, audience, expiry).
//
// Slices alpha / bravo / slice-d rebase their RBAC onto this one place: roles
// live in the same principal, so role resolution is one more line in
// TenantResolver.Populate — no new plumbing, no second source of truth.
// ─────────────────────────────────────────────────────────────────────────────

// Claim types carried by the token. In Entra ID these are app-roles / optional
// claims; in Azure AD B2C they're custom (extension) claims. The names are
// centralised so the IdP mapping is changed in exactly one place.
public static class HfcClaims
{
    public const string FranchiseeId = "franchisee_id";  // the isolation key
    public const string BrandId = "brand_id";             // the grouping
    // Franchisor (read-down) role. A `corporate` value admits the executive
    // dashboard endpoints via the "Corporate" policy; a franchisee principal
    // carries `franchisee_id` instead and is tenant-scoped, never corporate.
    public const string CorporateRole = "corporate";
}

// Authorization policy names (one source of truth for endpoint .RequireAuthorization).
public static class HfcPolicies
{
    public const string Corporate = "Corporate";
}

// Defaults for the LOCAL/TEST issuer (symmetric key). In production these are
// replaced by Entra ID / B2C via the Auth:Authority + Auth:Audience config —
// the validation pipeline is identical, only the key material and issuer move
// from "dev symmetric secret" to "IdP JWKS (RS256)". The dev token endpoint
// that mints these is gated to the Development environment in Program.cs.
public static class AuthDefaults
{
    public const string Issuer = "hfc-demo-dev";
    public const string Audience = "hfc-demo";
    // 32+ bytes for HS256. Dev/test only; never used when Auth:Authority is set.
    public const string DevSigningKey = "hfc-demo-dev-signing-key-please-override-0123456789";

    public static SymmetricSecurityKey DevKey(string? configured = null) =>
        new(Encoding.UTF8.GetBytes(
            string.IsNullOrWhiteSpace(configured) ? DevSigningKey : configured));
}

// THE SEAM. Map a verified principal onto the request's TenantContext.
// Fail-closed: an unauthenticated principal or a token with no franchisee claim
// leaves FranchiseeId null, and the EF global query filter then matches no rows.
public static class TenantResolver
{
    public static void Populate(TenantContext tenant, ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true) return;   // no identity → no tenant
        tenant.FranchiseeId = user.FindFirst(HfcClaims.FranchiseeId)?.Value;
        tenant.BrandId = user.FindFirst(HfcClaims.BrandId)?.Value;
        // RBAC rebase point (alpha/bravo/slice-d): e.g.
        //   tenant.Roles = user.FindAll(ClaimTypes.Role).Select(c => c.Value).ToArray();
    }
}

// Mints the dev/test tokens the local SPA and the integration tests use. Shared
// by the dev token endpoint and the test project so there is one definition of
// "a valid HFC token" — tests prove the *real* validation path, not a bypass.
public static class DevTokens
{
    public static string Mint(string franchiseeId, string brandId,
        string? signingKey = null, string issuer = AuthDefaults.Issuer,
        string audience = AuthDefaults.Audience, TimeSpan? lifetime = null)
    {
        var creds = new SigningCredentials(AuthDefaults.DevKey(signingKey),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, $"{franchiseeId}@dev"),
                new Claim(HfcClaims.FranchiseeId, franchiseeId),
                new Claim(HfcClaims.BrandId, brandId),
            },
            notBefore: DateTime.UtcNow.AddMinutes(-1),
            expires: DateTime.UtcNow.Add(lifetime ?? TimeSpan.FromHours(8)),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    // Mint a CORPORATE (franchisor) token: a verified principal carrying the
    // corporate ROLE claim and NO franchisee_id — so the dashboard scope resolves
    // to the corporate lens and the "Corporate" policy admits it. Additive sibling
    // of Mint(); the franchisee path above is unchanged. Same dev signing/issuer/
    // audience/lifetime, so it travels the identical validation pipeline.
    public static string MintCorporate(string? signingKey = null,
        string issuer = AuthDefaults.Issuer, string audience = AuthDefaults.Audience,
        TimeSpan? lifetime = null)
    {
        var creds = new SigningCredentials(AuthDefaults.DevKey(signingKey),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, "corporate@dev"),
                new Claim(ClaimTypes.Role, HfcClaims.CorporateRole),
            },
            notBefore: DateTime.UtcNow.AddMinutes(-1),
            expires: DateTime.UtcNow.Add(lifetime ?? TimeSpan.FromHours(8)),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public static class AuthExtensions
{
    // Configure JWT Bearer. If Auth:Authority is set we trust the real IdP
    // (Entra ID / B2C): tokens are validated against its JWKS. Otherwise we fall
    // back to the symmetric dev key so the demo and tests run with genuine
    // signature/issuer/audience/lifetime validation — never a "trust the header"
    // shortcut.
    public static IServiceCollection AddHfcAuth(this IServiceCollection services,
        IConfiguration config)
    {
        var authority = config["Auth:Authority"];
        var audience = config["Auth:Audience"] ?? AuthDefaults.Audience;

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(o =>
            {
                if (!string.IsNullOrWhiteSpace(authority))
                {
                    // Production: Entra ID / Azure AD B2C. JWKS-backed RS256.
                    o.Authority = authority;
                    o.Audience = audience;
                    o.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidateAudience = true,
                        ValidateLifetime = true,
                        ValidateIssuerSigningKey = true,
                    };
                }
                else
                {
                    // Local/test: symmetric dev key, same validation rigor.
                    o.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidIssuer = AuthDefaults.Issuer,
                        ValidateAudience = true,
                        ValidAudience = audience,
                        ValidateLifetime = true,
                        ValidateIssuerSigningKey = true,
                        IssuerSigningKey = AuthDefaults.DevKey(config["Auth:DevSigningKey"]),
                    };
                }
            });
        // Authorization: the "Corporate" policy gates the franchisor read-down
        // (executive dashboard) endpoints. RequireRole matches the corporate role
        // claim minted above (default RoleClaimType = ClaimTypes.Role). Franchisee
        // tenancy is unaffected — it flows through the query filter, not a policy.
        services.AddAuthorization(options =>
        {
            options.AddPolicy(HfcPolicies.Corporate, policy =>
                policy.RequireRole(HfcClaims.CorporateRole));
        });
        return services;
    }
}
