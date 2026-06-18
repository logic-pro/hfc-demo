# Status: bravo
_Updated 2026-06-17T20-23-07Z (branch fix/operator-dashboard)_

bravo — Operator dashboard correctness fixes: DONE, PR #57 (fix/operator-dashboard -> main), CI running.

Scope: web/src/app/franchisee/** ONLY (2 files). Disjoint from charlie/chore. No api/**, no app.routes/shell.

## Both assigned bugs fixed
- Bug 1 (HIGH) stale detail-drawer: setPeriod()/setTerritory() now call a shared clearDrawer()
  (selectedRow.set(null) + depositError.set(null)) before the reload. Matches existing close/pay clear.
- Bug 2 (MED) flat sparkline: sparkPoints() returns empty when max===min, so a degenerate trend
  [5,5,5,5] renders the empty spacer instead of a misleading flat line at y=30. kpi-card.component.ts.

## Honesty logic untouched (per DO-NOT): measured-zero dash, no red, no spark — not regressed.

## Gate
- cd web && npx ng build --configuration development -> GREEN (5.1s).
- Local Playwright drive NOT run: in-sandbox Chromium cannot launch (missing libnspr4, no sudo —
  same blocker echo documented). drive-franchisee.mjs is browser-based; runs in post-deploy-e2e CI.
- Prettier SCOPED to the 2 changed files, NOT the whole folder: prettier --write franchisee/**
  reformatted 16 untouched files (+800 lines pure formatting churn) that would bury a 2-bug fix.
  Reverted those to origin/main; kept format-what-you-touch on the 2 edited files.

## Cross-lane suggestion (PM to route to echo, e2e/**):
  extend drive-franchisee.mjs to lock in Bug 1: open drawer -> change period -> assert drawer closed.
  Out of my allowed_paths; flagging only.

Next: awaiting CI green -> merge, then next assignment.
