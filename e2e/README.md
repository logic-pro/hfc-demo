# e2e — post-deploy drivers + API smoke

These run against a **live, same-origin** build (the prod/CI model: the SPA is served
from the API's `wwwroot`, so the browser and the API share one origin and there's no
CORS/`__API_BASE__` split). The post-deploy-e2e workflow runs `smoke-api.sh` then every
`drive-*.mjs` against the deployed URL. You can now run the exact same gate **locally**.

## What's here

| file | what it does |
|------|--------------|
| `smoke-api.sh` | curl-level API contract + RBAC + tenant-isolation smoke (no browser). The fast first gate. |
| `drive-*.mjs` | Playwright drivers, one per surface (`dashboard`, `franchisee`, `intake`, `rbac`, `backoffice`). Picked up by the `drive-*.mjs` glob. |
| `_helpers.mjs` | shared plumbing (base-URL-from-env, networkidle+retry nav, console capture, persona login). Imported, never run. |
| `with-browser-libs.sh` | runs a driver locally by provisioning Chromium's runtime libs into a user prefix (no sudo). |

## Run the API smoke (no browser)

```bash
BASE=http://localhost:5180 bash e2e/smoke-api.sh
```

## Run the Playwright drivers LOCALLY (same-origin)

Chromium needs `libnss3` / `libnspr4` / `libasound2t64`, which aren't installed in this
sandbox. `with-browser-libs.sh` apt-get **downloads** them (no sudo) into
`~/.local/pw-libs`, unpacks them, and exports `LD_LIBRARY_PATH` — idempotent, so it only
provisions on the first run.

1. **Build the SPA and serve it same-origin from the API:**
   ```bash
   ( cd web && npm ci && npm run build )
   rm -f api/hfc-demo.db*                      # fresh seed
   cp -r web/dist/web/browser/* api/wwwroot/
   ( cd api && dotnet run --no-launch-profile --urls http://localhost:5180 ) &
   # wait for http://localhost:5180/api/health to return 200
   ```

2. **Drive a surface** (BASE makes WEB_URL == API_BASE == one origin):
   ```bash
   WEB_URL=BASE=http://localhost:5180 \
     e2e/with-browser-libs.sh node e2e/drive-backoffice.mjs "" /tmp/hfc-shots
   ```
   Screenshots land in the out dir (3rd positional; the workflow passes `"" /tmp/hfc-shots`).

This is a **real pre-merge check now**, not CI-only — run the relevant `drive-*.mjs`
before opening/merging a PR that touches a surface.

## Discipline

Assertions are **load-bearing, never vacuous** (a missing surface reds the gate; an
absent control throws). A not-yet-shipped surface is a logged `SKIP`, never a silent
pass — so the gate stays green in the pre-merge window without faking coverage, and
every assertion activates automatically the moment the surface lands.
