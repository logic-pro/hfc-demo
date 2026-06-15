// ── HFC scheduling demo — Azure infrastructure ──────────────────────────────
// Provisions the cloud topology the local stack maps onto:
//
//   Static Web App (Angular SPA)
//        │  calls
//        ▼
//   App Service (ASP.NET Core API)  ──managed identity──▶  Azure SQL (serverless)
//        │  starts orchestrations
//        ▼
//   Function App (Durable Functions) + Storage   ──▶  Application Insights (both)
//
// Cost note: defaults aim at the free/cheapest tiers (F1 plan, Consumption
// Functions, serverless SQL that auto-pauses). Azure SQL is NOT free forever —
// see DEPLOY.md for the zero-cost SQLite-in-container alternative.

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short prefix for resource names (lowercase letters/numbers).')
@minLength(3)
@maxLength(11)
param namePrefix string = 'hfcdemo'

@description('Deploy Azure SQL + wire the API to it via managed identity. Off = API uses SQLite on /home (lean/free first pass).')
param deploySql bool = false

@description('Entra (AAD) object ID that becomes the SQL admin (only used when deploySql=true).')
param sqlAadAdminObjectId string = ''

@description('Entra display name / UPN for the SQL admin (only used when deploySql=true).')
param sqlAadAdminLogin string = ''

@description('App Service plan SKU for the API. F1=Free (cold-starts after ~20min idle; Always On NOT supported). B1+ = paid but supports Always On / no cold start.')
param apiPlanSku string = 'F1'

var suffix = uniqueString(resourceGroup().id)
var sqlServerName = '${namePrefix}-sql-${suffix}'
var sqlDbName = 'hfc'

// Map a plan SKU name to its tier, and decide Always-On eligibility.
// Always On is only valid on Basic (B1) and above — Azure REJECTS alwaysOn=true
// on Free (F1) / Shared (D1), so we must gate it on the tier.
var planTierMap = {
  F1: 'Free'
  D1: 'Shared'
  B1: 'Basic'
  B2: 'Basic'
  B3: 'Basic'
  S1: 'Standard'
  S2: 'Standard'
  S3: 'Standard'
  P0v3: 'PremiumV3'
  P1v3: 'PremiumV3'
  P2v3: 'PremiumV3'
}
var apiPlanTier = contains(planTierMap, apiPlanSku) ? planTierMap[apiPlanSku] : 'Basic'
var apiAlwaysOn = apiPlanTier != 'Free' && apiPlanTier != 'Shared'

// ── Observability (Q: logs vs metrics vs traces — App Insights ties them) ────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

// ── App Service plan (Linux) hosting the API ─────────────────────────────────
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  sku: { name: apiPlanSku, tier: apiPlanTier } // default F1/Free; deploy with apiPlanSku=B1 for Always On / no cold start
  kind: 'linux'
  properties: { reserved: true }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-api-${suffix}'
  location: location
  identity: { type: 'SystemAssigned' } // managed identity — zero secrets in config
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|9.0'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      // Keep the app resident so the first hit after idle doesn't cold-start (503/timeout).
      // Auto-true only on Basic+ — Azure rejects this on Free/Shared.
      alwaysOn: apiAlwaysOn
      appSettings: [
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        // Demo runs in Development so the built-in dev-login (no external IdP) works.
        { name: 'ASPNETCORE_ENVIRONMENT', value: 'Development' }
        // Cold start + EF create/seed on F1 can exceed the default 230s container
        // start limit and trip a crash-loop; give it generous headroom.
        { name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '900' }
        // SQL path: managed identity (Authentication=Active Directory Default), no password.
        // SQLite path (default): an EPHEMERAL file under /tmp. /tmp is wiped on each
        // container start, so every boot reseeds a clean DB — this sidesteps the
        // startup rebuild crash seen against a PERSISTED (/home) SQLite DB.
        { name: 'ConnectionStrings__Default', value: deploySql
            ? 'Server=tcp:${sqlServerName}${environment().suffixes.sqlServerHostname},1433;Database=${sqlDbName};Authentication=Active Directory Default;Encrypt=True;'
            : 'Data Source=/tmp/hfc-demo.db' }
      ]
    }
  }
}

// ── Storage account (required by Functions) ──────────────────────────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${namePrefix}${substring(suffix, 0, 8)}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// Consumption (Y1 Dynamic) plan — Functions can't share the F1 app plan.
resource funcPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-funcplan'
  location: location
  sku: { name: 'Y1', tier: 'Dynamic' }
  kind: 'linux'
  properties: { reserved: true }
}

// ── Function App (Durable Functions, dotnet-isolated, Consumption) ───────────
resource funcApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-func-${suffix}'
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: funcPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNET-ISOLATED|9.0'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'dotnet-isolated' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
      ]
    }
  }
}

// ── Azure SQL (serverless, Entra-only auth) — second pass only (deploySql) ───
resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = if (deploySql) {
  name: sqlServerName
  location: location
  properties: {
    minimalTlsVersion: '1.2'
    administrators: {
      administratorType: 'ActiveDirectory'
      login: sqlAadAdminLogin
      sid: sqlAadAdminObjectId
      azureADOnlyAuthentication: true // no SQL passwords — Entra only
      principalType: 'User'
    }
  }
}

resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = if (deploySql) {
  parent: sqlServer
  name: sqlDbName
  location: location
  sku: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose' } // serverless, 1 vCore
  properties: {
    autoPauseDelay: 60 // auto-pause after 1h idle to save cost
    minCapacity: json('0.5')
  }
}

// Allow other Azure services (the App Service / Function) to reach SQL.
resource sqlFirewall 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = if (deploySql) {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// NOTE: the Angular SPA is served by the API App Service itself (its prod build
// is copied into wwwroot at deploy time and ASP.NET Core serves it with an
// index.html fallback). A standalone Static Web App also works, but its CLI
// upload was blocked by a network proxy in the build environment, and
// single-origin hosting avoids the CORS hop — so the SPA rides with the API.

output apiHostName string = api.properties.defaultHostName
output funcHostName string = funcApp.properties.defaultHostName
output sqlServerFqdn string = deploySql ? '${sqlServerName}${environment().suffixes.sqlServerHostname}' : ''
output apiPrincipalId string = api.identity.principalId
output funcPrincipalId string = funcApp.identity.principalId
