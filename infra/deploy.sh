#!/usr/bin/env bash
# deploy.sh — provision Azure infra and push the HFC demo to it.
#
# YOU run this (it needs YOUR Azure credentials). Claude can't `az login` for you.
#
#   az login                       # opens a browser, signs you in
#   az account set --subscription "<your-sub>"   # if you have more than one
#   ./infra/deploy.sh              # run from the hfc-demo/ root
#
# Idempotent-ish: re-running updates the deployment. Tears down with:
#   az group delete -n hfc-demo-rg --yes
set -euo pipefail

RG=${RG:-hfc-demo-rg}
# NOTE: free subscriptions often have 0 App Service quota in popular regions
# (eastus2/eastus/westus2 all returned quota=0 on this account); centralus had
# quota. If deploy fails with SubscriptionIsOverQuotaForSku, try another region.
LOCATION=${LOCATION:-centralus}
PREFIX=${PREFIX:-hfcdemo}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

command -v az >/dev/null || { echo "Azure CLI (az) not found."; exit 1; }
az account show >/dev/null 2>&1 || { echo "Run 'az login' first."; exit 1; }

# 1. SQL admin = the signed-in user (Entra-only auth, no passwords).
ADMIN_OID=$(az ad signed-in-user show --query id -o tsv)
ADMIN_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
echo "SQL admin will be: $ADMIN_UPN ($ADMIN_OID)"

# 2. Resource group + infra.
az group create -n "$RG" -l "$LOCATION" -o none
echo "Deploying Bicep (this provisions ~10 resources; SQL serverless takes a few min)..."
OUT=$(az deployment group create \
  -g "$RG" \
  --template-file "$ROOT/infra/main.bicep" \
  --parameters namePrefix="$PREFIX" sqlAadAdminObjectId="$ADMIN_OID" sqlAadAdminLogin="$ADMIN_UPN" \
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

# 4. Build the Angular SPA (same-origin: it will be served BY the API) and copy
#    it into the API's wwwroot, so one App Service serves both SPA and API.
echo "Building SPA (same-origin) + bundling into the API..."
echo "window.__API_BASE__='';" > "$ROOT/web/public/api-base.js"
(cd "$ROOT/web" && npm ci && npx ng build --configuration production)
rm -rf "$ROOT/api/wwwroot" && mkdir -p "$ROOT/api/wwwroot"
cp -r "$ROOT/web/dist/web/browser/." "$ROOT/api/wwwroot/"

# 5. Publish the API (now includes the SPA in wwwroot) via zip deploy.
echo "Publishing API + SPA..."
rm -rf "$ROOT/api/publish" "$ROOT/api/api.zip"
dotnet publish "$ROOT/api/api.csproj" -c Release -o "$ROOT/api/publish" >/dev/null
# `zip` may be absent; fall back to python.
if command -v zip >/dev/null; then (cd "$ROOT/api/publish" && zip -qr ../api.zip .);
else python3 -c "import shutil;shutil.make_archive('$ROOT/api/api','zip','$ROOT/api/publish')"; fi
az webapp deploy -g "$RG" -n "$API_NAME" --src-path "$ROOT/api/api.zip" --type zip -o none

# 6. Publish the Durable Functions.
echo "Publishing Functions..."
(cd "$ROOT/functions" && func azure functionapp publish "$FUNC_NAME")

# 7. Post-deploy HEALTH GATE — don't declare success until the API answers /health.
#    (App settings that make this "just work" — ASPNETCORE_ENVIRONMENT=Development,
#    ConnectionStrings__Default=Data Source=/tmp/hfc-demo.db,
#    WEBSITES_CONTAINER_START_TIME_LIMIT=900 — are baked into main.bicep and applied
#    by the `az deployment group create` in step 2, so no manual `az webapp config` needed.)
echo "Waiting for the API to report healthy (https://${API_HOST}/health)..."
HEALTHY=0
for i in $(seq 1 60); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${API_HOST}/health" || echo 000)
  echo "  health[$i/60]: $code"
  if [ "$code" = "200" ]; then HEALTHY=1; break; fi
  sleep 10
done
if [ "$HEALTHY" -ne 1 ]; then
  echo "❌ Deploy FAILED the health gate: https://${API_HOST}/health never returned 200." >&2
  echo "   Inspect logs with: az webapp log tail -g $RG -n $API_NAME" >&2
  exit 1
fi
echo "✅ API healthy."

# 8. Self-verify: dispatch the post-deploy e2e suite against the LIVE url (best-effort).
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  echo "Triggering post-deploy-e2e against https://${API_HOST} ..."
  if gh workflow run post-deploy-e2e.yml -f base_url="https://${API_HOST}"; then
    echo "   post-deploy-e2e dispatched (watch: gh run watch)."
  else
    echo "   (could not dispatch post-deploy-e2e — run it manually from the Actions tab)."
  fi
else
  echo "ℹ️  gh CLI not authenticated — skipping auto e2e. Run it manually with:"
  echo "   gh workflow run post-deploy-e2e.yml -f base_url=https://${API_HOST}"
fi

echo "
✅ Done.
   App (SPA + API) : https://${API_HOST}   (Swagger at /swagger)
   Functions       : https://${FUNC_HOST}
"
