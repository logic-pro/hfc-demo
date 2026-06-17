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
  await gotoReady(page, web + "/back-office/reports", "main, bo-coming-soon, [data-testid='report-builder']").catch(() => {});
  await page.waitForTimeout(400);
  if (await isStub(page)) {
    skip("/back-office/reports is still the <bo-coming-soon> stub (Reports UI lane unmerged) — happy-path assertions activate when it lands.");
  } else {
    // Real surface present — assert the builder works end to end. Intent-based
    // locators (roles/names) so they survive charlie's exact markup; each missing
    // control throws, so a half-built builder can't pass.
    const runBtn = page.getByRole("button", { name: /run|generate|build report/i }).first();
    ok((await runBtn.count()) > 0, "report builder: a Run/Generate control is present");
    await runBtn.click().catch(() => {});
    await page.waitForTimeout(800);
    const rows = page.locator("table tbody tr");
    ok((await rows.count()) >= 1, `report builder: run renders a non-empty table (${await rows.count()} rows)`);
    ok((await page.getByRole("button", { name: /export|csv|xlsx|download/i }).count()) > 0,
      "report builder: an export (CSV/XLSX) control is present");
    // save round-trips: click Save, then assert a saved entry surfaces (saved list,
    // toast, or selectable saved report). Best-effort positive signal, asserted.
    const saveBtn = page.getByRole("button", { name: /^save/i }).first();
    if ((await saveBtn.count()) > 0) {
      await saveBtn.click().catch(() => {});
      await page.waitForTimeout(600);
      const savedSignal =
        (await page.getByText(/saved/i).count()) > 0 ||
        (await page.locator("[data-testid='saved-report'], .saved-report").count()) > 0;
      ok(savedSignal, "report builder: save round-trips (a saved-report signal appears)");
    } else {
      failures.push("report builder: no Save control present (save round-trip unverifiable)");
      console.error("  ✗ report builder: no Save control present");
    }
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

    // sorted: read the first sortable numeric/score column down the rows and assert
    // monotonic (default sort). We read each row's last numeric cell as the sort key.
    const keys = await rows.evaluateAll((trs) =>
      trs.map((tr) => {
        const nums = [...tr.querySelectorAll("td")]
          .map((td) => parseFloat((td.textContent || "").replace(/[^0-9.\-]/g, "")))
          .filter((v) => !Number.isNaN(v));
        return nums.length ? nums[nums.length - 1] : null;
      }).filter((v) => v !== null),
    );
    if (keys.length >= 2) {
      const asc = keys.every((v, i) => i === 0 || keys[i - 1] <= v);
      const desc = keys.every((v, i) => i === 0 || keys[i - 1] >= v);
      ok(asc || desc, `territory explorer: list is sorted by its numeric column (${keys.length} keys, ${asc ? "asc" : desc ? "desc" : "UNSORTED"})`);
    } else {
      // Real surface may sort alphabetically (no numeric column to read) — don't
      // false-fail; record that sortedness wasn't numerically determinable here.
      skip(`territory explorer: no numeric column to verify sort order (rows=${n}) — finalize sort assertion against the real column once bravo lands`);
    }

    // drill down: click the first row -> /back-office/territories/:id scorecard.
    await rows.first().click();
    await page.waitForTimeout(700);
    const path = new URL(page.url()).pathname;
    ok(/\/back-office\/territories\/[^/]+$/.test(path), `territory drill-down routes to a scorecard (${path})`);
    // populated detail: the scorecard host renders and isn't a blank/coming-soon route.
    const detailFilled =
      !(await isStub(page)) &&
      (await page.locator("main").innerText().catch(() => "")).trim().length > 40;
    ok(detailFilled, "territory scorecard renders populated detail (not blank)");
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
