# Deploying the HFC demo to Azure

The deploy path is automated in [infra/deploy.sh](infra/deploy.sh); this doc covers
the decisions, the cost picture, and the manual SQL grant.

## What gets provisioned ([infra/main.bicep](infra/main.bicep))

| Resource | SKU (default) | Role |
|---|---|---|
| App Service plan (Linux) | **F1 Free** | hosts the API |
| Web App (`*-api-*`) | DOTNETCORE\|9.0, system-assigned MI | the ASP.NET Core API |
| Function App (`*-func-*`) | Consumption, dotnet-isolated, MI | Durable Functions |
| Storage account | Standard_LRS | required by Functions |
| Azure SQL server + db | **GP_S_Gen5_1 serverless**, auto-pause 1h, Entra-only auth | tenant data |
| Static Web App (`*-web`) | **Free** | the Angular SPA |
| Log Analytics + App Insights | PerGB2018 | logs/metrics/traces |

## Run it

```bash
az login
az account set --subscription "<your-subscription>"   # if you have more than one
./infra/deploy.sh
```

`deploy.sh` will: read your signed-in identity as the SQL Entra admin, create
`hfc-demo-rg`, deploy the Bicep, zip-deploy the API, `func azure functionapp publish`
the Functions, build the Angular prod bundle (pointed at the deployed API), and push
it to the Static Web App.

## The one manual step — SQL managed-identity grant

Managed identity → SQL is a *data-plane* grant Bicep can't do. After the DB is up,
run this once (portal Query editor, or `sqlcmd -G`), as the Entra admin, against db
`hfc` — `deploy.sh` prints the exact block with your API's name filled in:

```sql
CREATE USER [<your-api-app-name>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<your-api-app-name>];
ALTER ROLE db_datawriter ADD MEMBER [<your-api-app-name>];
```

The API's connection string uses `Authentication=Active Directory Default` — **no
password anywhere**. That's the managed-identity story to tell in the interview.

## Cost on a free account

- App Service **F1**, Functions **Consumption**, Static Web App **Free**, storage,
  and App Insights (low volume) are effectively free / pennies.
- **Azure SQL serverless is the one that costs** once free credits lapse — it
  auto-pauses after 1h idle (so you pay ~storage when not in use), but it is not
  free forever. To run the demo at **zero** cost, skip SQL: the API already works on
  SQLite, so containerize it (the repo has a Dockerfile pattern) or point
  `ConnectionStrings__Default` at a file path and drop the SQL resources from the
  Bicep. Use SQL only when you specifically want to demo managed-identity-to-SQL.

## Teardown

```bash
az group delete -n hfc-demo-rg --yes --no-wait
```
