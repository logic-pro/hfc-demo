# Azure SQL, Managed Identity & Auth — project notes & interview prep

## What it is

**Azure SQL** is Microsoft's fully-managed relational database service. The *serverless* tier
(SKU `GP_S_Gen5_1`) adds auto-scaling of compute and an auto-pause feature — the server
suspends after a configurable idle period and resumes on the next connection.

**Managed Identity** is Azure's mechanism for giving an Azure resource (App Service, Function
App, etc.) an automatically-managed Entra ID service principal — no credentials to create,
rotate, or store. A *system-assigned* identity is tied to the lifecycle of that specific
resource; a *user-assigned* identity is a standalone object that can be shared across multiple
resources.

**Entra ID** (formerly Azure Active Directory) is Microsoft's cloud identity platform —
workforce SSO, service-to-service tokens, RBAC. **Azure AD B2C** is the customer-facing
variant: it handles social logins (Google, Apple), email/password, and issues tokens scoped to
your tenant.

---

## How it's used in the HFC demo

### Azure SQL serverless with auto-pause

`infra/main.bicep` provisions the database under the `if (deploySql)` conditional (the
`deploySql` parameter defaults to `false`; the lean first pass uses SQLite so there is no SQL
cost at all):

```bicep
// infra/main.bicep — sqlDb resource
sku: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose' } // serverless, 1 vCore
properties: {
  autoPauseDelay: 60   // auto-pause after 1h idle
  minCapacity: json('0.5')
}
```

`autoPauseDelay: 60` means the compute shuts down after 60 minutes of no connections. While
paused you pay only for storage (~$0.115/GB/month). The first connection after a pause incurs a
cold-start resume — typically 20–30 seconds — which is acceptable for a demo but would need
`EnableRetryOnFailure` or a keep-alive ping in a production API.

### Entra-only authentication — no SQL passwords

The SQL server is configured with `azureADOnlyAuthentication: true`:

```bicep
// infra/main.bicep — sqlServer resource
administrators: {
  administratorType: 'ActiveDirectory'
  login: sqlAadAdminLogin
  sid: sqlAadAdminObjectId
  azureADOnlyAuthentication: true   // no SQL passwords — Entra only
  principalType: 'User'
}
```

This disables the traditional SA password and SQL logins entirely. Every connection must
present an Entra token.

### System-assigned managed identity on the API and Function App

Both compute resources carry `identity: { type: 'SystemAssigned' }`:

```bicep
// infra/main.bicep — api resource
identity: { type: 'SystemAssigned' }  // managed identity — zero secrets in config

// infra/main.bicep — funcApp resource
identity: { type: 'SystemAssigned' }
```

Azure provisions an Entra service principal automatically, tied to each resource. The principals
are output as `apiPrincipalId` and `funcPrincipalId` so downstream automation can reference
them.

### `Authentication=Active Directory Default` — zero secrets in the connection string

When `deploySql=true`, the API's `ConnectionStrings__Default` app setting is:

```
Server=tcp:<server>.database.windows.net,1433;Database=hfc;Authentication=Active Directory Default;Encrypt=True;
```

`Authentication=Active Directory Default` is a Microsoft.Data.SqlClient keyword that tries a
chain of credential sources in order: managed identity → Azure CLI → Visual Studio → environment
variables. In production on App Service the system-assigned managed identity wins; on a dev
machine the developer's `az login` credential wins. No password, no client secret, no Key Vault
reference required.

### The one manual data-plane grant

Bicep operates at the *control plane* (ARM). Granting a service principal access inside the SQL
database is a *data-plane* operation that requires a live SQL connection as an Entra admin.
`infra/deploy.sh` prints the exact T-SQL block after provisioning:

```sql
-- infra/deploy.sh — printed after Bicep completes when SQL_FQDN is non-empty
CREATE USER [<api-app-name>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<api-app-name>];
ALTER ROLE db_datawriter ADD MEMBER [<api-app-name>];
GO
```

This is documented in `DEPLOY.md` as the one manual step: run it once via the Azure portal
Query editor or `sqlcmd -G`, as the Entra admin, against the `hfc` database. Bicep cannot
automate it because ARM has no SQL-engine API surface.

### SQLite as the lean default

When `deploySql=false` (the default), the connection string is:

```
Data Source=/home/hfc-demo.db
```

App Service persists `/home` across restarts. This keeps the demo fully functional and free
while avoiding Azure SQL's ongoing cost. SQL is the `deploySql=true` upgrade path — use it
specifically when you want to demonstrate managed-identity-to-SQL during an interview or
walkthrough.

### PLANNED auth — Entra ID for staff, AD B2C for customers (Phase 0, ROADMAP.md)

From `ROADMAP.md §2`:

- **Customers** authenticate via Azure AD B2C (social + email/password flows).
- **Staff** (franchisee, corporate) authenticate via Entra ID.
- Three roles: `customer`, `franchisee` (scoped to one or more `franchiseeId`s), `corporate`.
- **Tenant and role come from token claims — never client-supplied.** This closes the current
  demo's security gap: today's `X-Tenant-Id` request header is spoofable; the Phase-0 design
  reads `franchiseeId` from the validated JWT claim, keeping the EF global query filter
  mechanism intact but wiring it to a trusted source.

---

## Why we chose it (and alternatives)

### Serverless vs. provisioned vs. Elastic Pool

| Option | Fit | Tradeoff |
|---|---|---|
| **Serverless** (chosen for demo) | Sporadic/bursty traffic, dev/demo | Auto-pause saves cost; cold-start resume on first connection |
| Provisioned (DTU/vCore) | Steady workload, latency-sensitive | Always-on compute cost; no cold start |
| Elastic Pool | Many databases with variable load | Shared compute — efficient at scale, overkill for a single-tenant demo |

For the HFC demo's usage pattern (demo sessions with long idle gaps), serverless + auto-pause
is the right default. A production SaaS with real tenants would likely move to a provisioned
tier or an elastic pool to eliminate resume latency.

### Managed identity vs. connection-string secrets vs. Key Vault

| Option | Fit | Tradeoff |
|---|---|---|
| **Managed identity** (chosen) | Any Azure-hosted workload | Zero credentials to manage; not portable off-Azure |
| Connection-string secret in app settings | Quick prototypes | Secret visible in ARM; requires rotation discipline |
| Key Vault reference in app settings | Secret-based but audited | Adds a Key Vault dependency; still a secret, just stored better |

Managed identity eliminates the rotation problem entirely. Key Vault references are the right
fallback for third-party credentials (e.g., a Stripe API key) where managed identity is not an
option.

### Entra-only auth vs. SQL auth

SQL auth (username + password on the SQL engine) was the traditional approach. It requires
creating, storing, and rotating credentials and bypasses all Entra Conditional Access policies.
`azureADOnlyAuthentication: true` in the Bicep disables it at the server level so no SQL
password can ever be used — a defense-in-depth choice, not just a convenience.

### Azure AD B2C vs. Auth0 for customer identity

| | Azure AD B2C | Auth0 |
|---|---|---|
| **Pricing** | Free up to 50k MAU | Paid above 7.5k MAU on standard plans |
| **Microsoft integration** | Native — same token format, MSAL, Entra portals | Third-party; requires additional bridging |
| **Customization** | Custom policies (XML) — powerful but verbose | Visual flows — faster for standard scenarios |
| **Vendor alignment** | Stays within the Azure ecosystem | Portable; stack-agnostic |

For an Azure-native stack targeting Microsoft enterprise customers (HFC's franchisee base uses
Office 365), AD B2C keeps everything in one billing envelope and one IAM surface. Auth0 would
be reasonable if the team prioritized speed-to-market over stack cohesion.

---

## Core concepts to nail

### System-assigned vs. user-assigned managed identity

- **System-assigned**: one-to-one with the resource. Created and deleted with the resource.
  Cannot be pre-authorized before the resource exists. Simplest; used in this demo.
- **User-assigned**: a standalone Entra object. Can be attached to multiple resources
  simultaneously. Pre-create it, grant it permissions, then assign at deploy time.
  Better for shared services or when you need to pre-provision RBAC before the compute
  resource is created.

### How `Authentication=Active Directory Default` acquires a token for SQL

The `DefaultAzureCredential` chain (used internally by `Microsoft.Data.SqlClient` when this
keyword is set) tries, in order:

1. Environment variables (`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`)
2. Workload identity (AKS)
3. Managed identity (IMDS endpoint at `169.254.169.254` — available on App Service and Functions)
4. Azure CLI (`az account get-access-token`)
5. Azure PowerShell, Visual Studio, VS Code

On App Service in production, step 3 succeeds immediately. The token is scoped to
`https://database.windows.net/.default`. `Microsoft.Data.SqlClient` attaches it as a Bearer
token on the TDS login; SQL Server validates it against Entra and maps it to the database
principal created by `CREATE USER ... FROM EXTERNAL PROVIDER`.

### Key Vault references as the fallback

For secrets that cannot use managed identity (third-party APIs, Stripe keys, Twilio auth
tokens), the pattern is:

1. Store the secret in Key Vault.
2. Grant the App Service's managed identity `Get` on Key Vault secrets.
3. Set the app setting value to `@Microsoft.KeyVault(SecretUri=https://...)`.

App Service resolves the reference at startup. The secret never appears in ARM or in application
code.

### OAuth2 / OIDC basics — access vs. ID token, scopes, claims

- **ID token**: proves who the user is (authentication). Contains identity claims
  (`sub`, `name`, `email`). Consumed by the client, never sent to a downstream API.
- **Access token**: proves what the caller is allowed to do (authorization). Contains audience
  (`aud`), scopes, and custom claims (roles, `franchiseeId`, `tenantId`). Sent as `Authorization: Bearer` to the API.
- **Scope**: a string representing a permission the client requests (`openid`, `profile`, a
  custom API scope like `hfc/bookings.write`).
- **Claim**: a key-value pair inside the token (`sub`, `roles`, custom claims). The API trusts
  claims from the issuer's public keys; it never trusts a request header for the same data.

### How a tenant/role claim drives multi-tenant authorization

In the Phase-0 design (ROADMAP.md §2), the JWT issued by Entra ID / AD B2C contains a
`franchiseeId` claim. The ASP.NET Core middleware validates the token signature (using the
issuer's JWKS endpoint) and exposes the claim via `HttpContext.User`. The EF Core global query
filter reads `franchiseeId` from the claim — the same filter mechanism already in the demo,
just wired to a trusted source instead of a spoofable header:

```csharp
// conceptual — Phase-0 target
modelBuilder.Entity<Appointment>()
    .HasQueryFilter(a => a.FranchiseeId == currentFranchiseeId);
// currentFranchiseeId resolved from HttpContext.User.FindFirst("franchiseeId").Value
```

### Transient fault handling and `EnableRetryOnFailure`

When Azure SQL serverless resumes from auto-pause, the first connection attempt may fail with a
transient error (40613 — database unavailable). EF Core's `EnableRetryOnFailure` retries with
exponential back-off:

```csharp
options.UseSqlServer(connectionString, sql =>
    sql.EnableRetryOnFailure(maxRetryCount: 5,
                             maxRetryDelay: TimeSpan.FromSeconds(30),
                             errorNumbersToAdd: null));
```

Without this, a cold-start resume will surface as a 500 error on the first request after an
idle period.

---

## Gotchas / caveats

**Managed identity → SQL requires a data-plane grant Bicep cannot do.** `CREATE USER ... FROM
EXTERNAL PROVIDER` runs inside the SQL engine, which ARM has no API surface for. Automating
this in a real CI/CD pipeline typically requires a post-deploy script that runs `sqlcmd -G`
(Entra auth) or uses an Azure DevOps SQL deployment task. In this demo, `deploy.sh` prints the
exact block and instructs you to run it manually (DEPLOY.md — "the one manual step").

**Serverless cold-start / resume after auto-pause.** `autoPauseDelay: 60` means a 60-minute
idle period triggers auto-pause. The resume on the next connection takes 20–30 seconds. Without
`EnableRetryOnFailure` this surfaces as an immediate 500. For a demo this is acceptable; for a
customer-facing API the choices are: raise `autoPauseDelay`, keep the serverless tier and add
retry logic, or move to a provisioned tier.

**Free-tier SQL quota and cost.** Azure SQL serverless is not permanently free. Free credits
cover the first period; after that the serverless tier charges for vCore-seconds when active
plus storage always. The demo defaults `deploySql=false` specifically to avoid this: SQLite on
`/home` is free and fully functional. Use `deploySql=true` only when you want to demonstrate
the managed-identity story.

**`azureADOnlyAuthentication: true` is a one-way door at the server level.** Once set, you
cannot add a SQL admin password as a fallback without disabling it first. This is intentional
for security but can lock you out during a misconfigured managed-identity grant step.

**F1 App Service plan has no always-on.** The API also cold-starts after idle. Bumping to B1
eliminates this but adds ~$13/month. Irrelevant for a demo; important to flag in an interview.

---

## Interview Q&A

**Q1. How does your API connect to Azure SQL without a password anywhere?**

The App Service has a system-assigned managed identity. The connection string uses
`Authentication=Active Directory Default`, which causes `Microsoft.Data.SqlClient` to acquire an
Entra bearer token via the Instance Metadata Service (IMDS) on `169.254.169.254`. That token is
presented to SQL instead of a password. The database principal was created with `CREATE USER
[api-name] FROM EXTERNAL PROVIDER`, mapping the Entra object ID to a SQL user with
`db_datareader` and `db_datawriter` roles.

**Q2. What is the difference between system-assigned and user-assigned managed identity, and
when would you choose each?**

System-assigned: lifecycle tied to one resource, created/deleted with it, simplest to use.
User-assigned: a reusable standalone Entra principal you can attach to multiple resources and
pre-authorize before the compute resource exists. Choose user-assigned when multiple services
share the same identity (e.g., an API and a background worker that both write to the same
storage account), or when you need to pre-grant permissions before the compute resource is
created.

**Q3. The demo currently reads the tenant from an `X-Tenant-Id` header. Why is that a security
problem, and how does Phase 0 fix it?**

A request header is client-supplied and trivially spoofable — any caller can set it to any
value. Phase 0 moves tenant resolution to the validated JWT: the access token issued by Entra ID
/ AD B2C carries a `franchiseeId` claim signed by the issuer. The ASP.NET Core middleware
validates the signature using the issuer's JWKS endpoint; the claim is then extracted from
`HttpContext.User`. The EF global query filter remains unchanged — only the source of the
franchisee ID changes, from an untrusted header to a cryptographically verified claim.

**Q4. What is `azureADOnlyAuthentication: true` and what does enabling it change?**

It is an Azure SQL server-level flag that disables all SQL-engine authentication (username +
password, SA account). Every connection must present an Entra bearer token. Consequences: no
SQL passwords exist; Conditional Access policies (MFA, device compliance) can gate access; audit
logs in Entra capture all sign-in events. It cannot be bypassed from the SQL engine side — even
if someone has a valid SA password from a backup, it will not work while this flag is set.

**Q5. Why can't Bicep create the SQL database user for the managed identity?**

Bicep (and ARM) operate at the Azure control plane. `CREATE USER ... FROM EXTERNAL PROVIDER` is
a T-SQL statement executed inside the SQL engine's data plane. ARM has no API surface that
maps to SQL engine DDL — it can create servers, databases, and firewall rules, but it cannot
open a SQL connection and run T-SQL. Automating this step requires a post-deployment script
using `sqlcmd -G` (Entra auth), an Azure DevOps SQL deployment task, or a custom Azure
Automation runbook.

**Q6. What is the `GP_S_Gen5_1` SKU and why was it chosen?**

`GP_S` = General Purpose Serverless. `Gen5_1` = 5th generation hardware, 1 vCore. The serverless
tier auto-scales compute between `minCapacity` (0.5 vCore here) and the provisioned maximum (1
vCore), and auto-pauses after the `autoPauseDelay` (60 minutes). Chosen because the demo has
long idle periods between sessions — auto-pause means you pay only for storage (~$0.115/GB/month)
while idle rather than a fixed hourly compute charge.

**Q7. What happens on the first connection after auto-pause, and how do you handle it in .NET?**

Azure SQL resumes the compute on the first connection attempt. Resume takes ~20–30 seconds. The
connection attempt may fail with SQL error 40613 ("database unavailable") during this window.
EF Core's `EnableRetryOnFailure` (on the `UseSqlServer` call) will retry with exponential
back-off and catch this transient error. Without it, the first post-idle request surfaces as a
500 to the caller.

**Q8. What is the difference between an ID token and an access token, and which one does the
API validate?**

The ID token proves identity (who the user is) and is consumed by the client application only —
it should never be sent to an API. The access token proves authorization (what the caller may
do) and contains audience (`aud`), scopes, and custom claims. The API validates the access
token: it checks the signature against the issuer's JWKS endpoint, verifies `aud` matches the
API's app ID, checks expiry, and then reads claims (`roles`, `franchiseeId`) to make
authorization decisions. It never reads the ID token.

**Q9. Why Azure AD B2C for customers instead of just Entra ID?**

Entra ID is designed for organizational (workforce) identities — it assumes the user has a work
or school account and is managed by an IT admin. Customers do not have organizational accounts;
they use personal email or social providers. AD B2C supports social login (Google, Apple,
Facebook), email/password with self-service password reset, custom branding, and custom policy
flows (XML-based Identity Experience Framework). It also has a generous free tier (50k MAU). The
HFC design uses both: Entra ID for staff (franchisee / corporate), AD B2C for customers —
two separate issuers, two separate token validation configurations in the API.

**Q10. If you wanted to store a Stripe API key securely alongside managed identity, how would
you do it?**

Managed identity cannot be used for third-party services — Stripe does not know about your Azure
identity. The pattern is: store the Stripe secret key in Azure Key Vault, grant the App
Service's managed identity the `Key Vault Secrets User` role on that vault, then set the app
setting to a Key Vault reference: `@Microsoft.KeyVault(SecretUri=https://...)`. App Service
resolves the reference at startup using the managed identity — no secret ever appears in ARM,
in application code, or in environment variable listings. Rotation is done once in Key Vault;
the app picks it up on the next restart.
