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

echo "
✅ Done.
   App (SPA + API) : https://${API_HOST}   (Swagger at /swagger)
   Functions       : https://${FUNC_HOST}
"
