# Deep-Dive: Microsoft Identity — Entra ID / Azure AD B2C + OAuth2/OIDC

> Module: ADV (advanced, spans M2 backend · M5 RBAC · M6 SPA) · Stack area: AuthN/AuthZ · Defends: "How does a franchisee sign in, and how do you prove the token belongs to *their* tenant — and how do you move that from a dev key to Entra without rewriting the app?"

**Demo-proven vs prod — read this first.** The hfc-demo ships a *keyed dev-login* that mints HS256 tokens locally (`DevTokens.Mint` / `DevTokens.MintCorporate`, `api/Auth.cs:75-122`). That is a **stand-in** for production Microsoft Entra ID (formerly Azure AD) and Azure AD B2C. The demo deliberately puts the *exact same validation pipeline* behind both paths so the migration is a config flip, not a rewrite. Throughout this doc, **[DEMO]** marks what is actually built and runnable today, **[PROD]** marks the Entra/B2C path the demo is shaped to accept. The seam that makes them interchangeable is `AddHfcAuth` (`api/Auth.cs:131-178`), branching on whether `Auth:Authority` is configured (`api/Auth.cs:134, 140`).

---

## 1. Mental model

OAuth2 is **delegated authorization** ("let this app act on a resource with these scopes"); OIDC is a thin identity layer on top ("…and here is *who* the user is, in an ID token"). For HFC the only thing that ultimately matters is: **a request arrives carrying a signed JWT; the API verifies the signature/issuer/audience/expiry; the verified claims become the tenant.** Everything else — login UI, redirect dances, PKCE, JWKS rotation — is machinery to get a *trustworthy* token into that one verification step. The hfc-demo nails the verification step with a dev key and leaves a single, well-marked seam (`Auth.cs`) where the *source of trust* swaps from a shared dev secret to Entra's published signing keys. Mastery here is understanding that the demo already proves the hard, security-critical half (validation + claims→tenant), and the prod half is "point the issuer at Entra."

The franchise shape: corporate users (network / brand / region) and franchisee operators are two identity populations. **Entra ID (workforce)** is natural for HFC corporate staff; **Azure AD B2C / Entra External ID (customer/partner)** is natural for franchisees and their staff who are external to HFC's own directory. Both emit OIDC-compliant JWTs that the *same* API validates the *same* way.

---

## 2. How it works

### Two OAuth2 flows HFC actually uses

```text
(A) Authorization Code + PKCE  — the Angular SPA (a "public client", no secret)
  Browser/SPA                    Entra authorize endpoint            API
     │  1. redirect /authorize?response_type=code                     │
     │     &client_id&scope=openid api://hfc/Bookings.ReadWrite       │
     │     &code_challenge=BASE64(SHA256(verifier))  ───────────────► │ (IdP)
     │  2. user authenticates (B2C user flow / Entra)                 │
     │ ◄── 3. redirect back ?code=AUTH_CODE ───────────────────────  │
     │  4. POST /token  code + code_verifier (proves same client) ──► │
     │ ◄── 5. id_token (OIDC) + access_token (JWT) + refresh_token    │
     │  6. GET /api/dashboard  Authorization: Bearer <access_token> ─────────►│
     │                                              7. validate sig/iss/aud/exp│
     │                                              8. claims → TenantContext  │

(B) Client Credentials  — service-to-service, no user (e.g. a Durable Function
    or a backend worker calling the API)
  Worker                          Entra /token                        API
     │  POST /token grant_type=client_credentials                     │
     │     client_id + client_secret/cert + scope=api://hfc/.default ►│
     │ ◄── access_token (app-only JWT, carries app-roles, no `sub` user)
     │  call API with Bearer token ─────────────────────────────────────────►│
```

**Why PKCE for the SPA:** an Angular app cannot keep a client secret (anyone can read the JS bundle). PKCE replaces the secret with a per-login proof: the SPA generates a random `code_verifier`, sends only its SHA-256 hash (`code_challenge`) on the authorize call, then presents the raw `code_verifier` when redeeming the code. An attacker who intercepts the auth code can't redeem it without the verifier. This is the mandatory flow for public clients today — the old implicit flow is deprecated.

**Why client-credentials for service-to-service:** there is no user to redirect. The caller *is* the principal. The token carries **app-roles** (not delegated scopes) and no user `sub`.

### JWT structure and the validation contract

A JWT is `base64url(header).base64url(payload).base64url(signature)`.

```text
header  { "alg":"RS256", "kid":"abc123", "typ":"JWT" }   ← kid selects the key
payload { "iss":"https://login.microsoftonline.com/<tid>/v2.0",
          "aud":"api://hfc-demo",
          "exp":1718400000, "nbf":..., "iat":...,
          "sub":"<stable user id>",
          "roles":["corporate"]  or  "scp":"Bookings.ReadWrite",
          "franchisee_id":"f-101", "brand_id":"sparkle" }   ← custom/optional claims
signature  RSA-SHA256 over header.payload, signed by the IdP's private key
```

Validation = check **four things**, all of which map 1:1 to the demo's `TokenValidationParameters`:

| Check | What it stops | Demo param (`api/Auth.cs`) |
|---|---|---|
| **Signature** | forged/tampered tokens | `ValidateIssuerSigningKey = true` + `IssuerSigningKey` (`:150 / :163-164`) |
| **Issuer** | tokens from another IdP | `ValidateIssuer = true` + `ValidIssuer` (`:147 / :159`) |
| **Audience** | tokens minted for a different API | `ValidateAudience = true` + `ValidAudience` (`:148 / :161`) |
| **Expiry/nbf** | replayed stale tokens | `ValidateLifetime = true` (`:149 / :162`) |

[PROD] With `Authority` set, `o.Authority = authority` (`api/Auth.cs:143`) makes the JwtBearer middleware fetch Entra's **OpenID configuration** (`/.well-known/openid-configuration`) and its **JWKS** (`jwks_uri`), pick the public key by `kid`, verify the RS256 signature, and cache+rotate keys automatically. You set `ValidateIssuerSigningKey = true` (`:150`) but supply **no key material** — the middleware resolves it from JWKS. That asymmetry is the whole point of the prod path (see §5).

### HS256 (demo) vs RS256 + JWKS (Entra)

```text
[DEMO] HS256 — SYMMETRIC
  same secret signs AND verifies
  ┌────────────┐  secret S  ┌──────────────┐
  │ DevTokens  │───sign────►│  AddHfcAuth  │
  │   .Mint    │            │  verify w/ S │   ← API must HOLD the signing secret
  └────────────┘            └──────────────┘   ← anyone with S can MINT valid tokens

[PROD] RS256 — ASYMMETRIC
  IdP private key signs; API verifies with the PUBLIC key from JWKS
  ┌────────────┐  PRIVATE   ┌──────────────┐  PUBLIC (JWKS)  ┌─────────────┐
  │  Entra ID  │───sign────►│  access_token│────────────────►│  AddHfcAuth │
  │ (holds key)│            └──────────────┘                 │ verify only │
  └────────────┘                                             └─────────────┘
       ▲ only Entra can mint            API can ONLY verify, never mint ────┘
```

---

## 3. Concrete code (HFC-shaped)

### [DEMO] The seam — one method, two trust sources (`api/Auth.cs:131-178`)

```csharp
public static IServiceCollection AddHfcAuth(this IServiceCollection services,
    IConfiguration config)
{
    var authority = config["Auth:Authority"];                 // set in prod = Entra/B2C
    var audience  = config["Auth:Audience"] ?? AuthDefaults.Audience;

    services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(o =>
        {
            if (!string.IsNullOrWhiteSpace(authority))
            {
                // [PROD] Entra ID / Azure AD B2C. JWKS-backed RS256.
                o.Authority = authority;                       // → fetches OIDC config + JWKS
                o.Audience  = audience;
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer            = true,          // iss must match Entra
                    ValidateAudience          = true,          // aud must be our API
                    ValidateLifetime          = true,          // exp/nbf
                    ValidateIssuerSigningKey  = true,          // key comes from JWKS (no IssuerSigningKey set)
                };
            }
            else
            {
                // [DEMO] symmetric dev key — SAME four checks, key supplied inline
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer           = true, ValidIssuer   = AuthDefaults.Issuer,
                    ValidateAudience         = true, ValidAudience = audience,
                    ValidateLifetime         = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey         = AuthDefaults.DevKey(config["Auth:DevSigningKey"]),
                };
            }
        });

    services.AddAuthorization(options =>
        options.AddPolicy(HfcPolicies.Corporate, p => p.RequireRole(HfcClaims.CorporateRole)));
    return services;
}
```

**The load-bearing fact:** the *shape* of validation is identical in both branches. The only difference is where the signing key lives — inline `IssuerSigningKey` (demo) vs JWKS resolved from `Authority` (prod). Downstream code (`TenantResolver.Populate`, the EF query filter, the `Corporate` policy) never knows which branch ran.

### [DEMO → PROD] Claims → tenant, the single seam (`api/Auth.cs:60-70`)

```csharp
public static void Populate(TenantContext tenant, ClaimsPrincipal? user)
{
    if (user?.Identity?.IsAuthenticated != true) return;   // fail-closed: no identity → no tenant
    tenant.FranchiseeId = user.FindFirst(HfcClaims.FranchiseeId)?.Value;  // "franchisee_id"
    tenant.BrandId      = user.FindFirst(HfcClaims.BrandId)?.Value;       // "brand_id"
    // RBAC rebase: tenant.Roles = user.FindAll(ClaimTypes.Role)...
}
```

`HfcClaims` (`api/Auth.cs:24-32`) names the claim types in **one place** with a comment that spells out the prod mapping: *"In Entra ID these are app-roles / optional claims; in Azure AD B2C they're custom (extension) claims."* That centralization is why flipping to Entra changes the IdP token-configuration, not the C#.

### [PROD] Angular SPA with MSAL (auth-code + PKCE)

The demo's SPA today stores a dev-minted token in a signal/localStorage (`web/src/app/tenant.service.ts:39`) and an interceptor attaches it as a bearer (`web/src/app/tenant.interceptor.ts:12-16`). In prod you keep that interceptor *shape* but source the token from MSAL:

```typescript
// app.config.ts  — MSAL handles the auth-code + PKCE dance and token cache
import { PublicClientApplication, InteractionType } from '@azure/msal-browser';
import { MsalInterceptor, MSAL_INSTANCE, MsalGuard } from '@azure/msal-angular';

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId: 'spa-app-registration-guid',
    authority: 'https://login.microsoftonline.com/<tenant-id>',   // or B2C user-flow authority
    redirectUri: '/auth-callback',
  },
  cache: { cacheLocation: 'memory' },   // NOT localStorage — see §6 XSS
});

// MsalInterceptor attaches the right scoped access token per outgoing API URL,
// acquiring/refreshing silently — the same job tenant.interceptor.ts does today.
providers: [
  { provide: MSAL_INSTANCE, useValue: msalInstance },
  { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
  MsalGuard,   // replaces web/src/app/auth/auth.guard.ts at route level
]
```

The Angular *change surface* is small precisely because the demo already isolates "get a token" (TenantService) from "attach a token" (interceptor) from "guard a route" (auth.guard).

---

## 4. The HFC tie-in

HFC's authorization is a hierarchy: **brand → region → territory**, plus the operator tenant. The token must carry enough to place the caller in that tree. The demo encodes this as:

- **Franchisee operator** → token carries `franchisee_id` (`api/Auth.cs:89`); `TenantResolver` sets `TenantContext.FranchiseeId`, and the EF global query filter then scopes every read to that tenant. This is the multitenancy isolation key — see [[M1-multitenancy]].
- **Corporate (network/brand/region)** → token carries a **role** claim and *no* `franchisee_id` (`api/Auth.cs:114-115`); the `Corporate` policy (`RequireRole`, `api/Auth.cs:174-175`) admits the read-down executive endpoints, and the scope resolver narrows the read model to the allowed territories. The four-scope model is explicit in the SPA (`web/src/app/tenant.service.ts:11`).

This maps directly onto the three Microsoft authorization primitives — **which one for which job is a core interview probe** (see [[M5-rbac-hierarchy]]):

| Primitive | What it is | HFC use |
|---|---|---|
| **Scopes (`scp`)** | *delegated* permissions: what the app may do on behalf of a user (auth-code flow) | coarse API gating, e.g. `Bookings.ReadWrite` vs `Dashboard.Read` |
| **App-roles (`roles`)** | roles assigned to a user *or* an app (works in client-credentials too) | the HFC RBAC tiers: `corporate`, region/brand roles → maps to the demo's `ClaimTypes.Role` |
| **Groups (`groups`)** | Entra security-group membership | avoid for fine-grained RBAC — overage problem (see §6); fine for org-chart joins |

**Why HFC corporate RBAC = app-roles, not groups or scopes:** app-roles are issued in *both* user and app tokens, are app-scoped (no naming collisions across apps), and don't suffer the groups-overage truncation. The franchise hierarchy is an *authorization* concept owned by the HFC app, so it belongs in app-roles + the `franchisee_id`/`brand_id` claims, resolved server-side — exactly what `Auth.cs` already does with `RequireRole` and the claim-driven `TenantResolver`.

---

## 5. Trade-offs — when NOT to use this

### Why prod uses asymmetric RS256, not the demo's symmetric HS256

| Option | Pro | Con | HFC verdict |
|---|---|---|---|
| **HS256 (symmetric)** [DEMO] | trivial, no infra, fast | API must *hold* the signing secret → anyone who can verify can also **forge** tokens; secret must be shared with every minter; rotation is a coordinated outage | ✅ dev/test only — never prod |
| **RS256 + JWKS (asymmetric)** [PROD/Entra] | API holds only the *public* key (can verify, cannot mint); key rotation is automatic via JWKS `kid`; one IdP, many APIs | a bit more setup; needs network reach to the JWKS endpoint | ✅ production |

The decisive reason: with HS256 the verification key *is* the signing key. An attacker who compromises any service that validates tokens can mint admin tokens. With RS256 the API is a pure verifier; compromising it yields nothing forgeable. For a multi-tenant platform where a forged `franchisee_id` is a cross-tenant breach, that asymmetry is non-negotiable in prod.

### Which Microsoft IdP for franchisees

| Option | Pro | Con | HFC verdict |
|---|---|---|---|
| **Entra ID (workforce)** | best for *internal* HFC staff; conditional access, MFA, SSO | not designed to hold millions of external consumer/partner accounts | ✅ HFC corporate users |
| **Azure AD B2C** | external identities, social IdPs, custom-branded user flows + custom policies (IEF) | separate tenant to run; B2C is on a sunset path toward External ID | ✅ today's franchisee identities (custom claims like `franchisee_id`) |
| **Entra External ID** (the successor) | Microsoft's go-forward customer/partner identity (CIAM); B2C feature parity growing | newer; some B2C custom-policy scenarios still maturing | ✅ go-forward target for new tenants |
| **Roll-your-own (the demo's dev key)** | zero dependency, full control, great for tests | you now own password storage, MFA, breach response, token rotation, social login — all the things that get companies breached | ❌ never in prod; only the demo stand-in |

The demo's dev-login is the "roll-your-own" cell — explicitly chosen *only* because it lets the demo + integration tests exercise the **real validation path** without standing up an IdP (`api/Auth.cs:72-74` comment: *"tests prove the real validation path, not a bypass"*).

---

## 6. Failure modes

1. **Validating the signature wrong (or not at all).**
   *Symptom:* forged tokens accepted; cross-tenant data leak. *Root cause:* `ValidateIssuerSigningKey = false`, or trusting `iss`/`aud` strings without checking the signature, or hard-coding a key that doesn't match the IdP. *Guardrail:* the demo always sets all four checks `= true` in both branches (`api/Auth.cs:147-150, 159-163`); in prod let `Authority` drive JWKS resolution rather than pinning a key.

2. **Accepting `alg: none` (or attacker-chosen alg).**
   *Symptom:* an unsigned token `{"alg":"none"}` is accepted as valid. *Root cause:* a permissive/old JWT library that honors the header's alg. *Guardrail:* Microsoft.IdentityModel rejects `none` and won't verify an HS256 token against an RS256-configured key; never disable algorithm validation. The classic **RS256→HS256 confusion attack** (signing with the *public* key as if it were an HS256 secret) is blocked because the prod branch is JWKS/RS256-only.

3. **Scope vs role confusion.**
   *Symptom:* a service-to-service (client-credentials) call is denied because the endpoint checks a *delegated scope* (`scp`) that only exists in user tokens — or worse, an endpoint accepts a `scp` from a user who lacks the *role*. *Root cause:* mixing `scp` (delegated, user present) with `roles` (app-role, may be app-only). *Guardrail:* gate corporate read-down by **role** (`RequireRole`, `api/Auth.cs:175`) — roles ride in both user and app tokens; reserve scopes for coarse delegated API surface.

4. **Token in `localStorage` → XSS exfiltration.**
   *Symptom:* a single XSS payload reads `localStorage`, steals the bearer token, and impersonates the user (carrying their `franchisee_id`). *Root cause:* persisting a usable access token where any injected script can read it. *Guardrail:* the demo is **honest about this** — `tenant.service.ts:24-26` comments *"Demo-grade persistence — a real build would hold the token in memory + an httpOnly refresh cookie."* Prod: MSAL token cache in **memory** (not localStorage), refresh via httpOnly cookie or silent renew, plus a strict CSP. Short access-token lifetimes limit the blast radius.

5. **Issuer/authority mismatch after the flip.**
   *Symptom:* every request 401s post-migration. *Root cause:* `Auth:Authority` points at the wrong tenant/version (v1 vs v2 issuer URL), or `Auth:Audience` doesn't match the API's App ID URI. *Guardrail:* match `ValidAudience` to the `aud` Entra actually stamps (`api://<app-id-uri>`), and use the v2.0 authority. The demo's split `ValidIssuer`/`Authority` design (`api/Auth.cs:143, 159`) means this is *one config value*, not a code change.

6. **JWKS unreachable / key rotation.**
   *Symptom:* intermittent 401s after Entra rotates signing keys. *Root cause:* aggressive caching or blocked egress to `login.microsoftonline.com`. *Guardrail:* the JwtBearer middleware auto-refreshes JWKS on `kid` miss; ensure outbound network to the metadata endpoint and don't pin a single `kid`.

---

## 7. Interview defense

- **Q: Your demo signs with HS256. Isn't that insecure?**
  **A:** Yes — and that's deliberate and bounded. HS256 is the *dev/test* stand-in so the demo and integration tests exercise the genuine signature/issuer/audience/expiry path without standing up an IdP (`api/Auth.cs:50, 72-74`). Production sets `Auth:Authority` to Entra/B2C and the same `AddHfcAuth` takes the RS256+JWKS branch (`api/Auth.cs:140-152`). The API then only ever *verifies* with Entra's public key — it can't mint tokens. The shape of validation is identical; only the key source moves.

- **Q: Walk me through migrating from the dev key to Entra. What breaks?**
  **A:** Almost nothing, by design — `Auth.cs` is the single seam. Steps: (1) register the API + SPA app registrations in Entra/B2C; (2) configure app-roles and optional/custom claims (`franchisee_id`, `brand_id`, `roles`) so Entra stamps the same claim types `HfcClaims` already reads (`api/Auth.cs:24-32`); (3) set `Auth:Authority` and `Auth:Audience` in config; (4) swap the SPA's dev-login for MSAL. The validation params, `TenantResolver`, the EF query filter, and the `Corporate` policy are untouched — they read verified claims regardless of issuer. That's the "flip the issuer" migration: a config change plus a token-claims mapping in Entra.

- **Q: Scopes, app-roles, or groups for the brand→region→territory hierarchy?**
  **A:** App-roles. They issue in both user and app(client-credentials) tokens, are app-scoped so names don't collide, and avoid the groups *overage* problem (Entra truncates `groups` past ~150–200 and emits an overage pointer you'd have to call Graph to resolve — fragile for an auth hot path). Scopes are for coarse delegated API surface; groups are fine for org-chart joins but not fine-grained RBAC. The demo already gates corporate access by role (`RequireRole`, `api/Auth.cs:175`) and the tenant by the `franchisee_id` claim — both ride cleanly in app-roles/optional claims.

- **Q: Where do you store the token in the browser, and why does it matter?**
  **A:** In memory via the MSAL cache, not localStorage. localStorage is readable by any injected script, so one XSS steals a bearer token carrying the user's `franchisee_id` — a cross-tenant impersonation. The demo uses localStorage but flags it as demo-grade (`tenant.service.ts:24-26`); prod uses in-memory access tokens, httpOnly refresh cookies, short lifetimes, and CSP.

---

## 8. Demo proof

| Claim | Where in `hfc-demo` |
|---|---|
| Single auth seam, two trust sources | `api/Auth.cs:131-178` (`AddHfcAuth`) |
| Four-check validation maps to Entra | `api/Auth.cs:147-150` (prod) / `:159-164` (dev) |
| HS256 dev signing key (stand-in) | `api/Auth.cs:50` (`DevSigningKey`), `:81-82` (`HmacSha256`) |
| Claims → tenant (fail-closed) | `api/Auth.cs:60-70` (`TenantResolver.Populate`) |
| Centralized claim-type mapping w/ Entra note | `api/Auth.cs:24-32` (`HfcClaims`) |
| Corporate policy (role-gated read-down) | `api/Auth.cs:172-176` + dev mint `:103-121` |
| Auth wired before tenancy resolution | `api/Program.cs:17` (`AddHfcAuth`), `:57-69` (UseAuthentication → resolve) |
| Bearer attached once (interceptor) | `web/src/app/tenant.interceptor.ts:12-16` |
| Token store + honest localStorage caveat | `web/src/app/tenant.service.ts:24-26, 39` |
| Four-scope hierarchy in the SPA | `web/src/app/tenant.service.ts:11` |

**To demonstrate the prod path without an Entra tenant:** set `Auth:Authority` to a B2C/Entra test authority in `appsettings`, register the API audience, and watch the *same* endpoints accept RS256 tokens — no C# change. The branch already exists at `api/Auth.cs:140`.

---

## 9. Related

- [[M5-rbac-hierarchy]] — the brand→region→territory authorization model; scopes vs app-roles vs groups feed it, the `Corporate` policy + scope resolver enforce it.
- [[M1-multitenancy]] — the `franchisee_id` claim resolved here becomes the EF global-query-filter isolation key; auth is the *source* of the tenant, tenancy is the *enforcement*.
- [[M2-aspnetcore-backend]] — JwtBearer middleware order in the pipeline (`UseAuthentication` → resolve tenant → `UseAuthorization`).
- [[M6-angular-spa]] — the interceptor/guard/service split that keeps the MSAL swap small.

---

## Flashcards

1. **Q:** What two things does OAuth2 give you vs OIDC? **A:** OAuth2 = delegated *authorization* (access token + scopes); OIDC = an *identity* layer on top (ID token, "who the user is").
2. **Q:** Which OAuth2 flow does the Angular SPA use and why? **A:** Authorization Code + PKCE — a public client can't keep a secret; PKCE proves the token redeemer is the same client that started the flow.
3. **Q:** Which flow for service-to-service with no user? **A:** Client credentials — the app is the principal; token carries app-roles, no user `sub`.
4. **Q:** Name the four JWT validation checks. **A:** Signature, issuer (`iss`), audience (`aud`), lifetime (`exp`/`nbf`). In demo: all four `=true` in `TokenValidationParameters`.
5. **Q:** HS256 vs RS256 — the one-line difference that matters. **A:** HS256 verifier *holds* the signing secret (can forge); RS256 verifier holds only the public key (verify-only). Prod = RS256.
6. **Q:** What does setting `o.Authority` do in the prod branch? **A:** Makes JwtBearer fetch the IdP's OIDC metadata + JWKS, select the key by `kid`, verify RS256, and auto-rotate keys.
7. **Q:** Scopes vs app-roles vs groups — which for HFC RBAC and why? **A:** App-roles — issue in user *and* app tokens, app-scoped, no groups-overage truncation.
8. **Q:** Why never put the access token in localStorage? **A:** Any XSS can read it and impersonate the user (carrying their `franchisee_id`). Use in-memory + httpOnly refresh cookie.
9. **Q:** What is the `alg: none` attack and what blocks it? **A:** An unsigned token accepted as valid; blocked by libraries that reject `none` and enforce the configured algorithm (Microsoft.IdentityModel does).
10. **Q:** What is the RS256→HS256 confusion attack? **A:** Signing a token with the public key treated as an HS256 secret; blocked by an RS256-only configuration that won't verify HS256.
11. **Q:** In one sentence, what is the "flip the issuer" migration? **A:** Set `Auth:Authority`+`Auth:Audience` and map Entra claims to `HfcClaims` — `AddHfcAuth` takes the RS256/JWKS branch with zero downstream change.
12. **Q:** Why is `TenantResolver.Populate` fail-closed? **A:** No authenticated identity → `FranchiseeId` stays null → the EF global query filter matches no rows. No claim, no data.

---

## Mock Q&A

**1. Q:** Take me from a franchisee clicking "Sign in" to a row coming back scoped to their tenant.
**A:** SPA redirects to the B2C/Entra authorize endpoint with PKCE; user authenticates via the B2C user flow; redirect back with an auth code; SPA redeems it (with the code_verifier) for an access token carrying `franchisee_id`. The interceptor attaches it as a bearer (`tenant.interceptor.ts:12-16`). The API validates signature/iss/aud/exp via JWKS (`Auth.cs:140-152`), `TenantResolver` reads `franchisee_id` into `TenantContext` (`Auth.cs:65`), and the EF global query filter scopes the query.
**Follow-up Q:** Where could a tenant leak slip in? **A:** If tenancy came from a header instead of a verified claim, or if the query filter were bypassed by raw SQL — the demo closes the first by sourcing tenant only from `ctx.User` (`Program.cs:64-69`) and fail-closing on a missing claim.

**2. Q:** Your validation params look the same in both branches except the key. Is that a smell?
**A:** It's the design goal. Validation *rigor* must be constant; only the *trust root* changes (inline symmetric key in dev, JWKS-resolved public key in prod). Keeping the params identical is what makes the issuer flip safe — there's no second, weaker validation path to forget about.
**Follow-up Q:** So what literally changes in code at migration? **A:** Nothing in `Auth.cs` logic — you set two config values (`Auth:Authority`, `Auth:Audience`) and map Entra's token claims to `HfcClaims`. The SPA swaps dev-login for MSAL. That's it.

**3. Q:** A region manager should see all territories in their region but no others. How is that authorized?
**A:** An app-role places them at the region tier; the token carries the role (and brand/region context) but no `franchisee_id`. The `Corporate` policy admits the read-down endpoints (`Auth.cs:174-175`), and the scope resolver narrows the read model to the region's territories *before* the query (`Program.cs:77-83`). See [[M5-rbac-hierarchy]].
**Follow-up Q:** Why not encode the region as a group? **A:** Groups-overage truncates membership past ~150–200 and forces a Graph call to resolve — fragile on the auth hot path. App-roles are app-scoped and ride in the token directly.

**4. Q:** What's the worst thing an attacker can do with your current localStorage token, and how do you cut it down?
**A:** Steal it via XSS and impersonate the franchisee — cross-tenant access carrying their `franchisee_id`. Mitigations: MSAL in-memory cache instead of localStorage, httpOnly refresh cookie, short access-token TTL, strict CSP, and output encoding to prevent the XSS in the first place. The demo flags its localStorage as demo-grade (`tenant.service.ts:24-26`).
**Follow-up Q:** Why does a short TTL help if they have a refresh token? **A:** Keep the refresh token in an httpOnly cookie that JS can't read; then XSS gets only a soon-expiring access token, not durable access.

**5. Q:** B2C, Entra External ID, or roll-your-own for franchisee identities — defend a choice.
**A:** B2C today (custom claims like `franchisee_id` via user flows/custom policies), with Entra External ID as the go-forward target since Microsoft is steering CIAM there. Roll-your-own (the demo's dev key) is out for prod — it means owning password storage, MFA, breach response, and social login, which is how platforms get breached. The demo uses the dev key *only* to test the real validation path without an IdP (`Auth.cs:72-74`).
**Follow-up Q:** What would actually move you off B2C to External ID? **A:** New-tenant feature parity (especially the custom-policy scenarios HFC needs for partner identities) plus Microsoft's stated direction — and the migration cost is again contained to the IdP side because the API only sees OIDC JWTs validated the same way.

---

```text
Module(s) covered: ADV (Entra ID / B2C + OAuth2/OIDC) — spans M2 backend, M5 RBAC, M6 SPA
Doc type produced: Topic deep-dive (+ Flashcards 12, Mock Q&A 5 with follow-ups)
Depth-standard gaps (if any): none — all 7 standards hit; MSAL/Angular and prod RS256 path are [PROD]-marked (demo ships the dev-key stand-in + the real validation pipeline they flip into)
Interview follow-ups it prepares you for: HS256-is-insecure rebuttal; the issuer-flip migration; scopes vs app-roles vs groups; token storage / XSS; B2C vs External ID vs roll-your-own
Next doc to write: ADV-secrets-keyvault-managed-identity (how the prod signing trust + connection strings are held without secrets in config)
```
