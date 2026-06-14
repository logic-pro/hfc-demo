# Round-2 enabler — modularize the hub files (kill the merge lock)

> **Why:** Round 1 needed a single-writer merge lock because 4 lanes all edit the
> same hub files (`api/Program.cs`, `AppDb.cs`, `Seed.cs`) + the Angular shell.
> This lane refactors those into **per-feature files each lane can own**, so the
> next wave merges in parallel with no lock. Pure structure change — zero behavior.

## ⏱ Timing (critical)
Run this **after round 1 fully merges** (alpha → bravo → charlie → slice-d) and
branch from the settled `main`. Running it mid-round would conflict with the exact
files those lanes are editing — the worst possible collision. The worktree exists
(`hfc-demo-worktrees/chore-modularize`, branch `chore/modularize-endpoints`) but
**holds** until the conductor says round 1 is done.

## What it produces (the round-2 ownership model)
- `api/Endpoints/*.cs` — one file per feature, each a `IEndpointRouteBuilder` extension (`MapBooking`, `MapIntake`, `MapNps`, `MapDashboard`, `MapDevAuth`). `Program.cs` becomes thin: build + middleware + `app.MapBooking(); app.MapNps(); …`. → future lanes add a *new* endpoints file, never touch `Program.cs`.
- `api/Data/Config/*.cs` — per-entity `IEntityTypeConfiguration<T>`; `OnModelCreating` → `ApplyConfigurationsFromAssembly`. → future lanes add a *new* config file, never touch `AppDb.cs`. (Preserve the global query filter, read-model-tables-unfiltered rule, and concurrency tokens exactly.)
- `api/Seed/*.cs` — per-feature seeders called from `Seed.Run`. → future lanes add a *new* seeder.
- Angular (document only, don't refactor now): one shell owner + each feature a lazy route in its own folder.

## Hard constraint
**Pure refactor — no behavior change.** No endpoint added/removed/renamed, no route path change, no DTO change, no query-filter semantics change, identical DB schema produced. The public surface must be byte-identical; only file organization moves.

## Validation gate
`dotnet build api/api.csproj` (0/0) · `dotnet test tests/HfcDemo.Tests.csproj` (8/8) · `./e2e/smoke-api.sh` (green) · skim `git diff` to confirm it's moves-only (no signature/route/DTO edits).

## Copy-paste prompt
(Window order: this lane sorts after `charlie`, before `slice-a`.)

```text
You are the lead for chore-modularize (HFC demo; main = trunk). This lane makes ROUND 2 lock-free by splitting the hub files into per-feature files. PURE REFACTOR — zero behavior change.
Worktree: hfc-demo-worktrees/chore-modularize · branch chore/modularize-endpoints · base+target main

DO NOT START until the conductor confirms round 1 (alpha→bravo→charlie→slice-d) is fully merged. Then: git fetch origin && git rebase origin/main.

REFACTOR (move, don't change):
1. api/Program.cs → extract endpoint groups into api/Endpoints/*.cs as IEndpointRouteBuilder extension methods: MapBooking, MapIntake, MapNps, MapDashboard, MapDevAuth. Program.cs keeps only builder setup + middleware order + app.MapXxx() calls.
2. api/AppDb.cs → move per-entity config into api/Data/Config/*.cs (IEntityTypeConfiguration<T>); OnModelCreating calls modelBuilder.ApplyConfigurationsFromAssembly(...). PRESERVE exactly: the global query filter on FranchiseeId, read-model tables left OUT of the filter (ADR-19), and all concurrency tokens/indexes.
3. api/Seed.cs → split into api/Seed/*.cs per-feature seeders, called in order from Seed.Run.
4. Do NOT refactor Angular this lane — just add a short note in docs on the one-shell + lazy-feature pattern for future UI lanes.

HARD RULE: no endpoint/route/DTO/query-filter behavior change; identical schema + seed output. If a move would change behavior, stop and flag it.

VALIDATE: dotnet build api/api.csproj (0 warn/err) ; dotnet test tests/HfcDemo.Tests.csproj (8/8) ; ./e2e/smoke-api.sh (green) ; git diff sanity — moves only.
Conventional commit (chore:), open PR to main as a standalone after round 1. Don't touch api/Auth.cs semantics.

HANDOFF: confirm build/tests/smoke green and that the public API surface is byte-identical (same routes, same DTOs), only files reorganized.
```

## After this lands
Update `WORKTREE-GITFLOW.md` / `CONTRACT.md` with the new ownership rule: **a feature = one endpoints file + one EF-config file + one seeder + (UI) one lazy route**; lanes never edit `Program.cs`/`AppDb.cs`/`Seed.cs`/the shell. Result: round-2 lanes branch from current `main`, own disjoint files, and merge in any order — **no lock, no cross-lane dependency except genuine data→API→UI contract order.**
