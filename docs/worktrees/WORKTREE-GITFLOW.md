# Worktree Operating Prompt — Rapid-Integration GitHub Flow

> Paste this into each worktree lead's session. It's the standing rules of
> engagement so seven parallel branches integrate cleanly and fast. Pairs with
> [CONTRACT.md](CONTRACT.md) (what you own) and [INTEGRATION-PLAN.md](INTEGRATION-PLAN.md)
> (the first-sync order + decisions). Replace `{{BRANCH}}` / `{{LANE}}` per worktree.

---

You are the lead for the `{{BRANCH}}` worktree, owning **{{LANE}}**. We run a
**simplified fast-integration GitHub Flow** — optimize for small, frequent merges,
not long-lived branches. Follow these rules:

## The model
- **`main` is the single source of truth and is always deployable.** No `develop`,
  no `release` branches. Your worktree is one feature branch off `main`.
- **Integrate continuously.** A branch that lives for days diverges and conflicts.
  Merge to `main` the moment your slice is green; pull the rest back constantly.

## The five rules
1. **Sync to trunk early and often — rebase, don't merge.** At session start and
   before every push: `git fetch && git rebase origin/main`. Rebasing keeps history
   linear and surfaces conflicts in small doses instead of one cliff at the end.
2. **Stay in your lane.** Only edit files `{{LANE}}` owns (see CONTRACT.md). If you
   must touch a shared file, make the change **additive** (append a new endpoint /
   DbSet / route / component — don't rewrite a neighbor's block).
3. **Build to the frozen CONTRACT, not to each other.** Match §2 DTO shapes exactly.
   A contract change is a cross-stream event: edit CONTRACT.md, bump the version,
   ping the other leads — never diverge silently.
4. **Green before you PR.** API builds (`dotnet build`), web builds under AOT
   (`npm run build`), smoke passes (`./e2e/smoke-api.sh` if you touched the API),
   no tracked junk (`node_modules`/`bin`/`obj`/`dist` stay gitignored). Then open a
   small, single-purpose PR with `gh pr create --fill --base main`.
5. **After any merge to `main`, everyone re-syncs immediately.** That's the heartbeat
   — `git checkout main && git pull && git checkout {{BRANCH}} && git rebase main`.
   Don't keep working on a stale base.

## Conflict hotspots — coordinate / additive-only
`api/Program.cs`, `api/AppDb.cs`, `api/Domain.cs`, `api/Seed.cs`,
`web/src/app/app.routes.ts`, `web/src/index.html`, `web/src/main.ts`,
`web/src/styles.css`, `web/src/app/models.ts`. These are where everyone collides —
append in clearly separated regions; never reformat or restructure a neighbor's code.

## Don't re-introduce the two known forks
- **Tenancy:** build on Slice A's token-claim seam (`TenantResolver.Populate`,
  two-axis `franchiseeId` boundary + `brandId` grouping). **Do not delete `Auth.cs`**
  and **do not revert to `BrandId`-only** isolation.
- **Frontend shell:** there is **ONE** app shell with three routes —
  `/booking` (untouched), `/corporate` (franchisor), `/dashboard` (franchisee).
  Don't create a competing shell / bootstrap / `index.html` root element.

## Definition of Done (per PR)
- [ ] Rebased on latest `main`
- [ ] Builds green (API + web AOT); smoke passes if API touched
- [ ] Only `{{LANE}}` files changed, or shared-file changes are additive
- [ ] CONTRACT shapes unchanged (or version bumped + leads pinged)
- [ ] No secrets, no tracked build artifacts
- [ ] Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Cadence
```bash
# 1. start of session: sync to trunk
git fetch && git rebase origin/main

# 2. work in your lane … then prove it's green
dotnet build ./api/api.csproj           # if API touched
(cd web && npm run build)               # AOT typecheck
./e2e/smoke-api.sh                      # if API touched

# 3. integrate (small, frequent)
git push -u origin {{BRANCH}}
gh pr create --fill --base main

# 4. after it (or anyone) merges, re-sync everyone
git checkout main && git pull && git checkout {{BRANCH}} && git rebase main
```

After `main` syncs, it deploys to Azure (`./infra/deploy.sh`) for review — then we
re-evaluate and fix any integration issues on fresh branches. Keep branches short,
keep `main` green, keep moving.
