#!/usr/bin/env bash
#
# run-api.sh — boot the HFC demo API for LOCAL DEVELOPMENT, safely.
#
# WHY THIS EXISTS (the footgun it removes):
#   The API seeds at startup and then builds the corporate read model:
#       Seed.Run(db)  →  Rollup.Recompute(db)  →  ReportingStore.EnsureCreated(db)
#   The schema is created with EF Core's db.Database.EnsureCreated(), which is a
#   NO-OP once api/hfc-demo.db already exists on disk — it does NOT apply model
#   changes. So after anyone edits a model (e.g. adds Brand.Archetype), a stale
#   local hfc-demo.db crashes boot inside Rollup.Recompute with, e.g.:
#       SQLite Error 1: 'no such column: b.Archetype'
#   CI never hits this because the "Smoke-test API" step does `rm -f api/hfc-demo.db`
#   on every run. Local devs had no such guard — this script is that guard.
#
# WHAT IT DOES:
#   1. rm -f the local SQLite DB (+ its -wal/-shm sidecars) so EnsureCreated()
#      rebuilds the FULL current schema from scratch — every boot starts clean.
#   2. Runs the API with ASPNETCORE_ENVIRONMENT=Development (mirrors CI). This is
#      required because --no-launch-profile skips launchSettings.json, which is the
#      only place the Development environment is otherwise set; without it the dev
#      token mint (/api/dev/token) and Development-only behavior are off.
#   3. dotnet run --no-launch-profile --urls http://localhost:<PORT> (default 5180,
#      matching the README quick-start, CI smoke, and the e2e drivers).
#
# NOTE: This is a DEV CONVENIENCE that rebuilds the DB on every boot — it is the
# right tradeoff for a demo with idempotent seeding, NOT a substitute for real EF
# migrations. The durable fix (migrate instead of EnsureCreated) lives in api/**
# and is tracked separately (routed to the api/** lane).
#
# USAGE:
#   scripts/dev/run-api.sh                # rm stale db, boot on :5180 (Development)
#   PORT=5171 scripts/dev/run-api.sh      # override the port
#   scripts/dev/run-api.sh --no-build     # pass extra args straight through to dotnet run
#
set -euo pipefail

# Resolve the repo root from the script's own location so this works from any cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if git -C "$REPO_ROOT" rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT="$(git -C "$REPO_ROOT" rev-parse --show-toplevel)"
fi

PORT="${PORT:-5180}"
DB="$REPO_ROOT/api/hfc-demo.db"

echo "▸ Clearing stale local DB so EnsureCreated() rebuilds the current schema…"
rm -f "$DB" "$DB-wal" "$DB-shm"

echo "▸ Booting API on http://localhost:${PORT} (ASPNETCORE_ENVIRONMENT=Development)"
cd "$REPO_ROOT"
ASPNETCORE_ENVIRONMENT=Development \
  exec dotnet run --project api/api.csproj --no-launch-profile \
    --urls "http://localhost:${PORT}" "$@"
