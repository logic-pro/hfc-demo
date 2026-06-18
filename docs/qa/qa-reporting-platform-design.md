# QA / Integration-Test Reporting Platform — Design Notes

**Status:** Design exploration (no build yet) · **Date:** 2026-06-17
**Author:** session with Claude (enterprise-architecture lens)
**Related:** [2026-06-17 live integration test run](./2026-06-17-live-integration/REPORT.md)

## Goal

A reusable QA / integration-test reporting surface that works across **many repos
and multiple GitHub organizations**, unifying heterogeneous test sources and adding
what Playwright alone can't: cross-suite status, run-over-run trends, flaky-test
tracking, and links to traces/screenshots.

### Agreed scope (from this session)
- **Build depth:** both layers — reuse Playwright's built-ins *and* build an aggregation layer on top.
- **Sources to unify:** Playwright `@playwright/test` specs · `smoke-api.sh` (bash API smoke) · `drive-*.mjs` (node browser drivers) · .NET integration tests (`tests/*.cs`, TRX).
- **Reusability requirement:** must work for all repos across different orgs. User asked: "should each app get its own interface, or central?"

## Core insight

**Per-app vs central is a false fork.** Reusability comes from a **standard results
contract** + a **shared viewer package**, not from where it's deployed. With those
two, you get both scopes from one codebase:

```
 PRODUCERS (per repo)              CONTRACT                 VIEWERS (one shared pkg)
 Playwright specs ─┐                                        ┌─ per-repo scoped view
 smoke-api.sh ─────┼─► adapters ─► normalized JSON ─► store ┤
 drive-*.mjs ──────┤                                        └─ central portfolio view
 .NET TRX ─────────┘    (link out to Playwright trace viewer / screenshots)
```

"Each app gets its own interface" = the **same shared viewer, scoped to that app** —
NOT a hand-built UI per repo (that's N dashboards to maintain = anti-pattern).
One package, N scoped deployments + one aggregate.

## Build vs. reuse (do NOT reinvent)

1. **Contract → adopt CTRF, don't invent one.** [CTRF (Common Test Report Format)](https://ctrf.io)
   is a standard JSON schema for test results across frameworks. Playwright has a
   CTRF reporter; bash/node/.NET each need a small emitter. Inventing a bespoke
   schema locks every repo into our dialect — the biggest risk here.
2. **Viewer → try off-the-shelf aggregator first.** [ReportPortal](https://reportportal.io)
   (self-hostable, multi-project, RBAC — most of the cross-org requirement out of
   the box), [Allure](https://allurereport.org) (history/trends/flaky), or
   [Currents](https://currents.dev)/Testmo. Build a custom Angular dashboard ONLY
   if their UX doesn't fit — and even then it consumes CTRF, staying reusable.
3. **Never rebuild Playwright's trace viewer or HTML report.** Link out to them
   (`show-trace`, hosted HTML report). Custom layer owns aggregation/trends/
   cross-suite status; Playwright owns deep per-test debugging.

## Topology & data ownership

**Hub-and-spoke, hub is a pure read model:**
- **Each repo owns its raw results** (CTRF JSON + Playwright artifacts) in its own CI. Source of truth stays with the repo.
- **Central hub owns only the aggregated read model** (history, trends, flaky stats). It ingests; it never writes back into repos. Avoids shared-DB / cross-service-mutation anti-pattern.
- **Orgs are a security boundary.** Cross-org aggregation needs auth: each repo's CI **pushes** CTRF to the hub with an org-scoped token (don't grant the hub broad cross-org pull). Viewer enforces RBAC on who sees which org's slice. Treat test results as sensitive — they leak endpoints, data shapes, marker emails.

## Recommended phased shape

1. **Contract:** CTRF (non-negotiable foundation).
2. **Adapters:** Playwright CTRF reporter (config one-liner) + CTRF emitters for `smoke-api.sh` and `drive-*.mjs` + TRX→CTRF converter for .NET.
3. **Publish:** each repo's CI uploads CTRF + trace/screenshot artifacts; posts summary to hub.
4. **Viewer v1:** stand up ReportPortal (or Allure history) self-hosted — cross-org, multi-project, trends, flaky-tracking with NO custom UI.
5. **Viewer v2 (only if needed):** shared Angular dashboard package reading CTRF, deployed per-repo + central — built *after* feeling ReportPortal's gaps.

Value lands at step 4 before any dashboard code; step 5 becomes an informed decision.

## Open decision (gates everything downstream)

**Build a custom dashboard, or adopt an off-the-shelf aggregator (ReportPortal/
Allure) first?** Recommendation: **adopt first, build only the gaps.**

## Next step when resuming

Prove the contract on ONE repo: add the CTRF reporter to hfc-demo's Playwright
config + write a CTRF emitter for `smoke-api.sh`, so two heterogeneous suites land
in one JSON file. That single artifact de-risks the whole platform.
Alternative: spike ReportPortal locally to eyeball the off-the-shelf UI before
deciding build-vs-buy.

## Biggest risk

Inventing a bespoke results schema (or a per-app bespoke UI) before validating
against CTRF / ReportPortal — rebuilding, worse, what already exists.
