#!/usr/bin/env bash
# deploy.sh — provision Azure infra and push the HFC demo to it.
#
# YOU run this (it needs YOUR Azure credentials). Claude can't `az login` for you.
#
#   az login                       # opens a browser, signs you in
#   az account set --subscription "<your-sub>"   # if you have more than one
#   ./infra/deploy.sh              # full deploy (infra + code), from the hfc-demo/ root
#   ./infra/deploy.sh --code-only  # code-only redeploy to the EXISTING App Service
#
# Idempotent: re-running updates the deployment in place; resource names are stable
# (derived from uniqueString(resourceGroup().id)) and are never changed here.
# Tear down with:  az group delete -n hfc-demo-rg --yes
#
# ─────────────────────────────────────────────────────────────────────────────
# REGION RECONCILIATION (why this script no longer hardcodes the Bicep location)
# ─────────────────────────────────────────────────────────────────────────────
# A resource group has its OWN metadata `location`, which is independent of where
# the resources inside it actually live. On the live demo these DIVERGED:
#   • RG `hfc-demo-rg` metadata location = eastus2
#   • its resources (hfcdemo-api-pkz2lysbqoabq, hfcdemo-func-…) live in centralus
# main.bicep defaults `param location = resourceGroup().location`, so a naive
# `az deployment group create` would target eastus2 and COLLIDE with the existing
# centralus resources (InvalidResourceLocation). And `az group create -l centralus`
# on an RG whose metadata says eastus2 fails with InvalidResourceGroupLocation —
# you cannot relocate an existing RG.
# Fix: for an existing RG we (1) recreate it idempotently at its OWN metadata
# location (a no-op, never errors), and (2) detect where the resources ACTUALLY
# live and pass that to Bicep as `location=…`, so deployments always target the
# real resource region regardless of the RG metadata.
#
# ─────────────────────────────────────────────────────────────────────────────
# CODE-ONLY MODE  (--code-only  |  CODE_ONLY=1)
# ─────────────────────────────────────────────────────────────────────────────
# Skips Bicep + SQL + Functions provisioning and does ONLY the app push:
#   build SPA → bundle into API/wwwroot → publish API → zip-deploy → health gate
#   → dispatch post-deploy-e2e.
# This is exactly the manual sequence that had to be run by hand when the redesign
# deploy failed on the region mismatch above. It assumes infra already exists and
# discovers the live API app name from the resource group (override with API_NAME=…).
set -euo pipefail

RG=${RG:-hfc-demo-rg}
# NOTE: free subscriptions often have 0 App Service quota in popular regions
# (eastus2/eastus/westus2 all returned quota=0 on this account); centralus had
# quota. This is only the location used to CREATE a brand-new RG; for an existing
# RG the real location is auto-detected (see REGION RECONCILIATION above).
LOCATION=${LOCATION:-centralus}
PREFIX=${PREFIX:-hfcdemo}
# App Service plan SKU. F1 (Free) = cheapest but cold-starts after ~20min idle and
# CANNOT run Always On. Set SKU=B1 (or higher) for Always On / no cold start (paid).
SKU=${SKU:-F1}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Mode: --code-only flag or CODE_ONLY=1 env both select code-only.
CODE_ONLY=${CODE_ONLY:-0}
for arg in "$@"; do
  case "$arg" in
    --code-only) CODE_ONLY=1 ;;
    -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg (use --code-only or --help)" >&2; exit 2 ;;
  esac
done

command -v az >/dev/null || { echo "Azure CLI (az) not found."; exit 1; }
az account show >/dev/null 2>&1 || { echo "Run 'az login' first."; exit 1; }

# Azure stores locations normalized (e.g. "centralus"), but some surfaces echo the
# display name ("Central US"); normalize to be safe before comparing/using.
normloc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' '; }

# ─── Reusable steps (shared by full + code-only) ────────────────────────────

# 4. Build the Angular SPA (same-origin: it will be served BY the API) and copy
#    it into the API's wwwroot, so one App Service serves both SPA and API.
build_and_bundle_spa() {
  echo "Building SPA (same-origin) + bundling into the API..."
  # Same-origin API base + LIVE executive dashboard (else it renders fixtures, ignoring
  # the real seeded/scoped data — 3 fixture brands incl. a non-seeded "Mister Sparky").
  { echo "window.__API_BASE__='';"; echo "window.__DASHBOARD_LIVE__=true;"; } > "$ROOT/web/public/api-base.js"
  (cd "$ROOT/web" && npm ci && npx ng build --configuration production)
  rm -rf "$ROOT/api/wwwroot" && mkdir -p "$ROOT/api/wwwroot"
  cp -r "$ROOT/web/dist/web/browser/." "$ROOT/api/wwwroot/"
}

# 5. Publish the API (now includes the SPA in wwwroot) via zip deploy.
publish_api() {
  local api_name="$1"
  echo "Publishing API + SPA to $api_name..."
  rm -rf "$ROOT/api/publish" "$ROOT/api/api.zip"
  dotnet publish "$ROOT/api/api.csproj" -c Release -o "$ROOT/api/publish" >/dev/null
  # `zip` may be absent; fall back to python.
  if command -v zip >/dev/null; then (cd "$ROOT/api/publish" && zip -qr ../api.zip .);
  else python3 -c "import shutil;shutil.make_archive('$ROOT/api/api','zip','$ROOT/api/publish')"; fi
  az webapp deploy -g "$RG" -n "$api_name" --src-path "$ROOT/api/api.zip" --type zip -o none
}

# 7. Post-deploy HEALTH GATE — don't declare success until the API answers /health.
#    (App settings that make this "just work" — ASPNETCORE_ENVIRONMENT=Development,
#    ConnectionStrings__Default=Data Source=/tmp/hfc-demo.db,
#    WEBSITES_CONTAINER_START_TIME_LIMIT=900 — are baked into main.bicep and applied
#    by the `az deployment group create` in step 2, so no manual `az webapp config` needed.)
health_gate() {
  local api_host="$1"
  echo "Waiting for the API to report healthy (https://${api_host}/health)..."
  local code
  for i in $(seq 1 60); do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${api_host}/health" || echo 000)
    echo "  health[$i/60]: $code"
    [ "$code" = "200" ] && { echo "✅ API healthy."; return 0; }
    sleep 10
  done
  echo "❌ Deploy FAILED the health gate: https://${api_host}/health never returned 200." >&2
  echo "   Inspect logs with: az webapp log tail -g $RG -n $(basename "$api_host" .azurewebsites.net)" >&2
  return 1
}

# 8. Self-verify: dispatch the post-deploy e2e suite against the LIVE url (best-effort).
dispatch_e2e() {
  local api_host="$1"
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    echo "Triggering post-deploy-e2e against https://${api_host} ..."
    if gh workflow run post-deploy-e2e.yml -f base_url="https://${api_host}"; then
      echo "   post-deploy-e2e dispatched (watch: gh run watch)."
    else
      echo "   (could not dispatch post-deploy-e2e — run it manually from the Actions tab)."
    fi
  else
    echo "ℹ️  gh CLI not authenticated — skipping auto e2e. Run it manually with:"
    echo "   gh workflow run post-deploy-e2e.yml -f base_url=https://${api_host}"
  fi
}

# ─── CODE-ONLY MODE ─────────────────────────────────────────────────────────
if [ "$CODE_ONLY" = "1" ]; then
  echo "▶ CODE-ONLY redeploy (skipping Bicep / SQL / Functions provisioning)."
  az group exists -n "$RG" | grep -qi true || {
    echo "❌ Resource group '$RG' does not exist — run a full deploy first (drop --code-only)." >&2
    exit 1; }
  # Discover the live API app (the *-api app, not the *-func app), unless pinned.
  API_NAME=${API_NAME:-$(az webapp list -g "$RG" \
    --query "[?starts_with(name, '${PREFIX}-api')].name | [0]" -o tsv 2>/dev/null)}
  [ -n "${API_NAME:-}" ] || {
    echo "❌ Could not find a '${PREFIX}-api*' web app in '$RG'. Pin it: API_NAME=… $0 --code-only" >&2
    exit 1; }
  API_HOST="${API_NAME}.azurewebsites.net"
  echo "Target API: $API_NAME ($API_HOST)"

  build_and_bundle_spa
  publish_api "$API_NAME"
  health_gate "$API_HOST"
  dispatch_e2e "$API_HOST"

  echo "
✅ Done (code-only).
   App (SPA + API) : https://${API_HOST}   (Swagger at /swagger)
"
  exit 0
fi

# ─── FULL DEPLOY ────────────────────────────────────────────────────────────

# 1. SQL admin = the signed-in user (Entra-only auth, no passwords).
ADMIN_OID=$(az ad signed-in-user show --query id -o tsv)
ADMIN_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
echo "SQL admin will be: $ADMIN_UPN ($ADMIN_OID)"

# 2. Resource group + infra — region-reconciled (see REGION RECONCILIATION header).
if az group exists -n "$RG" | grep -qi true; then
  RG_LOC=$(normloc "$(az group show -n "$RG" --query location -o tsv)")
  # Where the resources ACTUALLY live (ignore 'global' resources like some identities).
  RES_LOC=$(normloc "$(az resource list -g "$RG" \
    --query "[?location!='global'].location | [0]" -o tsv 2>/dev/null)")
  DEPLOY_LOC=${RES_LOC:-$RG_LOC}
  echo "Resource group '$RG' already exists (metadata location: ${RG_LOC:-unknown})."
  if [ -n "$RES_LOC" ] && [ "$RES_LOC" != "$RG_LOC" ]; then
    echo "⚠️  RG metadata ($RG_LOC) ≠ resource location ($RES_LOC) — deploying to the REAL"
    echo "    resource location '$RES_LOC' so Bicep doesn't collide with existing resources."
  fi
  # Idempotent no-op at the RG's OWN metadata location (never errors; never relocates).
  az group create -n "$RG" -l "$RG_LOC" -o none
else
  DEPLOY_LOC=$(normloc "$LOCATION")
  echo "Creating resource group '$RG' in '$DEPLOY_LOC'."
  az group create -n "$RG" -l "$DEPLOY_LOC" -o none
fi

echo "Deploying Bicep to '$DEPLOY_LOC' (this provisions ~10 resources; SQL serverless takes a few min)..."
OUT=$(az deployment group create \
  -g "$RG" \
  --template-file "$ROOT/infra/main.bicep" \
  --parameters location="$DEPLOY_LOC" namePrefix="$PREFIX" sqlAadAdminObjectId="$ADMIN_OID" sqlAadAdminLogin="$ADMIN_UPN" apiPlanSku="$SKU" \
  --query properties.outputs -o json)

API_HOST=$(echo "$OUT"  | python3 -c "import sys,json;print(json.load(sys.stdin)['apiHostName']['value'])")
FUNC_HOST=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['funcHostName']['value'])")
SQL_FQDN=$(echo "$OUT"  | python3 -c "import sys,json;print(json.load(sys.stdin)['sqlServerFqdn']['value'])")
API_NAME=$(basename "$API_HOST" .azurewebsites.net)
FUNC_NAME=$(basename "$FUNC_HOST" .azurewebsites.net)

# 3. (deploySql=true only) Grant the API's managed identity a login in SQL.
if [ -n "$SQL_FQDN" ]; then echo "
--- Run against $SQL_FQDN / db 'hfc' as the Entra admin (portal Query editor or sqlcmd -G): ---
CREATE USER [${API_NAME}] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [${API_NAME}];
ALTER ROLE db_datawriter ADD MEMBER [${API_NAME}];
GO
"; fi

# 3b. ALWAYS ON — keep the app resident so the first hit after idle doesn't cold-start.
#     bicep already sets siteConfig.alwaysOn for Basic+; this re-asserts it and, on
#     Free/Shared (where Always On is impossible), warns loudly instead of failing silently.
PLAN_TIER=$(az appservice plan show -g "$RG" -n "${PREFIX}-plan" --query sku.tier -o tsv 2>/dev/null || echo "")
case "$PLAN_TIER" in
  Free|Shared|"")
    echo "⚠️  App Service plan tier is '${PLAN_TIER:-unknown}' (SKU=$SKU) — Always On is NOT available below Basic."
    echo "    => the app cold-starts after ~20min idle; the first hit can 503/timeout."
    echo "    Kill cold starts by redeploying on Basic+:   SKU=B1 ./infra/deploy.sh"
    echo "    Meanwhile .github/workflows/keep-warm.yml pings /health on a cron to keep it warm (\$0)." ;;
  *)
    echo "Enabling Always On on the API (tier=$PLAN_TIER)..."
    az webapp config set -g "$RG" -n "$API_NAME" --always-on true -o none && echo "✅ Always On enabled — no cold starts." ;;
esac

# 4–5. Build the SPA, bundle it into the API, publish + zip-deploy.
build_and_bundle_spa
publish_api "$API_NAME"

# 6. Publish the Durable Functions.
echo "Publishing Functions..."
(cd "$ROOT/functions" && func azure functionapp publish "$FUNC_NAME")

# 7. Health gate, then 8. self-verify e2e.
health_gate "$API_HOST"
dispatch_e2e "$API_HOST"

echo "
✅ Done.
   App (SPA + API) : https://${API_HOST}   (Swagger at /swagger)
   Functions       : https://${FUNC_HOST}
"
