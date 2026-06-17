# scripts/dev — local developer conveniences

Small helpers for running the demo on a workstation. They do **not** touch app code
(`api/**`, `web/**`); they only wrap the documented run path with the guards CI already
has but local devs don't.

## `run-api.sh` — boot the API without the stale-DB footgun

```bash
scripts/dev/run-api.sh                # rm stale db → boot on http://localhost:5180 (Development)
PORT=5171 scripts/dev/run-api.sh      # override the port
scripts/dev/run-api.sh --no-build     # extra args pass straight through to `dotnet run`
```

**Why prefer this over `cd api && dotnet run …`:** the API seeds at startup
(`Seed.Run` → `Rollup.Recompute` → `ReportingStore.EnsureCreated`). The schema is
created with EF Core `EnsureCreated()`, which is a **no-op once `api/hfc-demo.db`
exists** — it never applies model changes. So after any model edit, a stale local DB
crashes boot, e.g.:

```
SQLite Error 1: 'no such column: b.Archetype'   (in Rollup.Recompute)
```

CI never hits this because its **Smoke-test API** step runs `rm -f api/hfc-demo.db`
every time. `run-api.sh` gives local devs the same guard: it removes the local SQLite
DB (and `-wal`/`-shm` sidecars) so `EnsureCreated()` rebuilds the full current schema,
then runs with `ASPNETCORE_ENVIRONMENT=Development` (required because
`--no-launch-profile` skips `launchSettings.json`, the only other place that's set).

> This is a dev convenience that rebuilds the DB every boot — fine for a demo with
> idempotent seeding. The durable fix (real EF **migrations** instead of
> `EnsureCreated`) lives in `api/**` and is tracked in that lane, not here.
