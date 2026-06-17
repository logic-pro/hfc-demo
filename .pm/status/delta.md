# Status: delta
_Updated 2026-06-17T04-43-59Z (branch chore/deploy-hardening)_

delta — DONE: deploy hardening + back-office CI gate (PR #49, CI green, MERGEABLE/CLEAN).

infra/deploy.sh:
- Region reconciliation: for an existing RG, recreate idempotently at its OWN
  metadata location (no-op, never errors) + detect the REAL resource location
  (az resource list) and pass it to Bicep as location= — fixes the eastus2(RG-meta)
  vs centralus(resources) mismatch that failed the 2026-06-16 deploy twice
  (InvalidResourceGroupLocation / InvalidResourceLocation). New RG -> created at $LOCATION.
- --code-only / CODE_ONLY=1 mode: skips Bicep/SQL/Functions, runs build SPA ->
  bundle -> publish API -> zip-deploy -> health-gate -> dispatch post-deploy-e2e
  (the manual recovery sequence). Discovers live *-api app from RG (override API_NAME=).
- Steps 4-8 factored into reusable functions; added --help. Resource names unchanged.

.github/workflows/ci.yml:
- ng build compiles whole web/src -> backoffice/** covered (red backoffice build
  fails the PR). Added dedicated prettier check scoped to src/app/backoffice/**.
- That backoffice lint check is NON-blocking for now: PR #48 landed 8 backoffice
  files with format drift I cannot fix (web/** out of lane). Pre-wired to flip to
  hard gate once cleaned. Cross-lane note routed: .pm/inbox/delta-to-web__backoffice-prettier-drift.md

Confirmed unchanged/working: post-deploy-e2e auto-dispatch (deploy.sh step 8) +
keep-warm cron. Gate met: bash -n clean, all workflow YAML valid, dry-run/explain
in PR body, NO az/Bicep run against live infra, no web/api changes.

Rebased onto origin/main (picked up #48). Ready to merge.
ASK: after this merges, the backoffice lint gate can be flipped to blocking once
the web lane runs prettier --write on the 8 files (delta can do the 1-line follow-up).
