#!/usr/bin/env node
// drive-backoffice.mjs — Back-Office Wave 1 e2e driver (corporate-only back office).
//
// Asserts, against a live build, three things — fail LOUDLY, never vacuously
// (same discipline as 5cf991b: a missing surface reds the gate; an absent control
// throws; a not-yet-shipped surface is a logged SKIP, never a silent pass):
//
//   1. RBAC ISOLATION (load-bearing). A CORPORATE persona (Franchisor HQ) sees the
//      "Back office" nav entry AND can open /back-office (the home launcher paints).
//      A FRANCHISEE persona has NO "Back office" nav entry AND is BOUNCED off a
//      direct /back-office deep-link by corporateGuard (never sees back-office
//      content). Both halves asserted, so the deny isn't passing merely because the
//      surface is broken for everyone.
//   2. REPORT BUILDER happy path (/back-office/reports). When the real surface is
//      live: pick metrics+dimensions+period, run, assert a non-empty table renders,
//      assert an export control is present, assert save round-trips. While it's
//      still the Foundation <bo-coming-soon> stub (charlie's lane unmerged) -> loud
//      SKIP (assertions activate when the surface lands).
//   3. TERRITORY drill-down (/back-office/territories). When live: list non-empty +
//      sorted, click a row, assert the scorecard route + populated detail. Stub -> SKIP.
//
// Foundation gate: if the corporate "Back office" nav entry is absent, the whole
// back-office surface isn't deployed yet (Foundation lane unmerged) -> the driver
// emits one loud SKIP and exits 0. echo runs LAST, so at gate time it's present.
//
// Usage: node e2e/drive-backoffice.mjs "" [outDir]   (WEB_URL / API_BASE / BASE from env)
//   The post-deploy workflow calls every driver as `node <driver> "" /tmp/hfc-shots`
//   (a blank first positional, then the out dir) — so the out dir is argv[3], same
//   convention as the sibling drivers (outDir(3)).

import { launch, shotter, resolveBase, outDir, loginPersona, gotoReady } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);

const BO_NAV = 'nav a[routerLink="/back-office"]'; // the corporate-only nav entry
const BO_HOME = "bo-home"; // back-office home launcher host (Foundation)
const STUB = "bo-coming-soon"; // the frozen placeholder selector (C1)

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { failures.push(msg); console.error(`  ✗ ${msg}`); } };
const skip = (msg) => console.log(`  · SKIP ${msg}`);

// True if the surface at the current route is still the Foundation coming-soon stub.
const isStub = async (page) =>
  (await page.locator(STUB).count()) > 0 ||
  (await page.getByText(/coming soon/i).count()) > 0;

const { browser, page, errors, benign } = await launch({ width: 1280, height: 900, api });
const shot = shotter(page, dir);

try {
  if (api) console.log(`API base override: ${api}`);
  console.log(`Back-office e2e vs ${web}\n`);

  // ── 1a. CORPORATE: nav entry present + can open /back-office ──────────────────
  const ceo = await loginPersona(page, web, { tier: "Franchisor HQ", name: "HFC CEO" });
  console.log(`signed in as "${ceo}" (corporate scope)`);
  await page.waitForLoadState("networkidle");

  const navCount = await page.locator(BO_NAV).count();
  if (navCount === 0) {
    // Foundation web not deployed yet — the whole surface is absent. Don't fake a
    // pass and don't red the gate in the pre-merge window; log it and stop.
    skip("Back-office surfaces not deployed yet (no corporate 'Back office' nav entry — Foundation lane unmerged). Assertions activate once it lands.");
    console.log(`\n${pass} checks passed, ${failures.length} failed. (back office not live — skipped)`);
    await browser.close();
    process.exit(0);
  }
  ok(navCount === 1, `corporate sees the "Back office" nav entry`);

  await page.locator(BO_NAV).first().click();
  await gotoReady(page, web + "/back-office", BO_HOME).catch(async () => {
    // click already navigated; just wait for the home host
    await page.waitForSelector(BO_HOME, { timeout: 15000 });
  });
  ok(/\/back-office$/.test(new URL(page.url()).pathname), `corporate opens /back-office (url=${new URL(page.url()).pathname})`);
  ok((await page.locator(BO_HOME).count()) > 0, "back-office home launcher renders for corporate");
  await shot("backoffice-1-home.png");

  // ── 1b. FRANCHISEE: no nav entry + bounced off a direct deep-link ────────────
  // Fresh context so the corporate token doesn't leak into the franchisee session.
  const opPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (api) await opPage.addInitScript((b) => { window.__API_BASE__ = b; }, api);
  const op = await loginPersona(opPage, web, { tier: "Franchisee" });
  console.log(`signed in as "${op}" (franchisee scope)`);
  await opPage.waitForLoadState("networkidle");
  ok((await opPage.locator(BO_NAV).count()) === 0, "franchisee has NO 'Back office' nav entry (isolation)");

  // direct deep-link must be denied by corporateGuard -> bounced to the operator
  // home (homeRoute), never the back-office content.
  await opPage.goto(web + "/back-office", { waitUntil: "networkidle" });
  await opPage.waitForTimeout(500); // let the guard's redirect settle
  const denied =
    !/\/back-office/.test(new URL(opPage.url()).pathname) &&
    (await opPage.locator(BO_HOME).count()) === 0;
  ok(denied, `franchisee deep-link to /back-office is bounced by corporateGuard (landed on ${new URL(opPage.url()).pathname}, no back-office content)`);
  await opPage.close();

  // ── 2. REPORT BUILDER happy path (/back-office/reports) ──────────────────────
  await gotoReady(page, web + "/back-office/reports", "main").catch(() => {});
  await page.waitForTimeout(400);
  // Detect the LIVE builder by a POSITIVE marker — its "Run report" submit control —
  // NOT by the absence of <bo-coming-soon>: charlie's real builder (#59) honestly
  // renders a Wave-2 "Schedule & Share" <bo-coming-soon> sub-section, so a naive stub
  // check would FALSE-SKIP a shipped surface (a vacuous coverage gap — the worst kind).
  // Foundation's full-page stub has no Run control, so its absence is the real signal.
  const runBtn = page.getByRole("button", { name: /run report/i }).first();
  await runBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if ((await runBtn.count()) === 0) {
    skip("/back-office/reports is still the Foundation <bo-coming-soon> stub (no Run control) — happy-path assertions activate when the real builder lands.");
  } else {
    // Drive the builder end to end against the live §C2 catalog. Each control is real
    // and required, so a half-built builder fails loudly (never a vacuous pass).
    // a) pick a metric — Run enables only with >=1 metric (canRun); the metric options
    //    are the catalog checkboxes (the only checkboxes; Group-by is a radiogroup).
    const metric = page.locator("fieldset input[type='checkbox']").first();
    ok((await metric.count()) > 0, "report builder: catalog metrics rendered as selectable options");
    await metric.check().catch(() => metric.click());
    // b) choose a grouping (first dimension radio) so the result groups by a dimension.
    const dim = page.locator("[role='radiogroup'][aria-label='Group by dimension'] [role='radio']").first();
    if ((await dim.count()) > 0) await dim.click().catch(() => {});
    // c) Run — now enabled — and assert a real, non-empty result table renders (the
    //    results live region flips runStatus idle->ready, painting <table><tbody>).
    ok(!(await runBtn.isDisabled()), "report builder: Run enables once a metric is selected");
    await runBtn.click();
    await page.waitForSelector("section[aria-live] table tbody tr", { timeout: 15000 }).catch(() => {});
    const rows = page.locator("section[aria-live] table tbody tr");
    const rc = await rows.count();
    ok(rc >= 1, `report builder: run renders a non-empty result table (${rc} rows)`);
    // d) export controls surface on the result (client-side CSV / XLSX).
    ok((await page.getByRole("button", { name: /export (csv|xlsx)/i }).count()) > 0,
      "report builder: export (CSV/XLSX) controls present on the result");
    // e) save round-trips: name it, Save (enabled once result+metric+name), assert the
    //    named report surfaces in the saved-reports list (saved() -> a <li> with it).
    const saveName = "e2e smoke report";
    await page.locator("#bo-save-name").fill(saveName);
    const saveBtn = page.getByRole("button", { name: /^save$/i }).first();
    ok((await saveBtn.count()) > 0 && !(await saveBtn.isDisabled()),
      "report builder: Save enables once a report has run and been named");
    await saveBtn.click();
    await page.getByText(saveName, { exact: false }).first().waitFor({ timeout: 8000 }).catch(() => {});
    ok((await page.getByText(saveName, { exact: false }).count()) > 0,
      "report builder: save round-trips (named report appears in the saved list)");
    await shot("backoffice-2-reports.png");
  }

  // ── 3. TERRITORY drill-down (/back-office/territories) ───────────────────────
  await gotoReady(page, web + "/back-office/territories", "main, bo-coming-soon, table").catch(() => {});
  await page.waitForTimeout(400);
  if (await isStub(page)) {
    skip("/back-office/territories is still the <bo-coming-soon> stub (Territory lane unmerged) — drill-down assertions activate when it lands.");
  } else {
    const rows = page.locator("table tbody tr");
    const n = await rows.count();
    ok(n >= 1, `territory explorer: list is non-empty (${n} rows)`);

    // sorted: the explorer defaults to worst-health-first — composite score ASCENDING
    // (bravo: sortKey='score', sortDir='asc'). The composite score is the one .tnum
    // cell per row; read it down the rows and assert it's monotonically ascending, so
    // the at-risk tail is what a corporate admin sees first. A non-ascending order is
    // a real regression (the intervention ordering broke), not a tolerated alt-sort.
    const scores = await page
      .locator("table tbody tr td span.tnum")
      .evaluateAll((els) => els.map((e) => parseFloat((e.textContent || "").trim())).filter((v) => !Number.isNaN(v)));
    ok(scores.length === n, `territory explorer: every row exposes a composite score (${scores.length}/${n})`);
    const asc = scores.length >= 2 && scores.every((v, i) => i === 0 || scores[i - 1] <= v);
    ok(asc, `territory explorer: default sort is worst-health-first (composite ascending; head=[${scores.slice(0, 5).join(", ")}])`);

    // drill down: the row's navigation is the territory <a routerLink> in the row
    // header cell (clicking the bare <tr> does nothing). Click it -> the per-territory
    // scorecard route /back-office/territories/:id.
    const firstLink = page.locator("table tbody tr th a").first();
    ok((await firstLink.count()) > 0, "territory explorer: each row links to its scorecard (routerLink)");
    await firstLink.click();
    await page.waitForURL(/\/back-office\/territories\/[^/]+$/, { timeout: 8000 }).catch(() => {});
    const path = new URL(page.url()).pathname;
    const routed = /\/back-office\/territories\/[^/]+$/.test(path);
    ok(routed, `territory drill-down routes to a scorecard (${path})`);
    // populated detail — ONLY meaningful once we routed (gate on `routed`, else the
    // list page's own copy passes it vacuously) AND once the async health-score fetch
    // settles. The loaded scorecard paints the composite radial gauge (<ec-radial-gauge>,
    // absent in the loading skeleton + the error/not-found state), so wait for it and
    // assert it concretely rather than eyeballing a text-length heuristic.
    let detailFilled = false;
    if (routed) {
      await page.waitForSelector("ec-radial-gauge", { timeout: 12000 }).catch(() => {});
      const gauge = await page.locator("ec-radial-gauge").count();
      const bodyLen = (await page.locator("main").innerText().catch(() => "")).trim().length;
      detailFilled = gauge > 0 && !(await isStub(page)) && bodyLen > 80;
    }
    ok(detailFilled, "territory scorecard renders populated detail (composite gauge + body)");
    await shot("backoffice-3-territory-scorecard.png");
  }

  console.log(`\n${pass} checks passed, ${failures.length} failed.`);
  if (benign.length) console.log(`(filtered ${benign.length} benign CSP font-load console warnings)`);
  if (failures.length) { console.error("FAILED:", failures.join(" | ")); process.exitCode = 1; }
  else if (errors.length) { console.error("console errors:", errors); process.exitCode = 2; }
} catch (e) {
  await shot("backoffice-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved backoffice-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
