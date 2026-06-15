#!/usr/bin/env node
// drive-franchisee.mjs — driver + screenshotter for the Franchisee OPERATOR
// dashboard (/dashboard), reached as a FRANCHISEE-scope persona.
//
// Since #26 login is the /login persona picker; the Franchisee tier mints a
// tenant-scoped token and routes straight to /dashboard. This is the bottom of
// the RBAC hierarchy: one tenant's own read-model (vs the network command center
// drive-dashboard.mjs pins at the top). A blank dashboard fails loudly.
//
// Flow:
//   1. /login -> click a Franchisee persona -> /dashboard (operator)
//   2. assert the operator KPI tiles render (tenant scope, not blank)
//   3. open the first action row -> detail drawer; screenshot (when rows exist)
//   4. desktop + mobile (390px) screenshots; exit non-zero on any console/page error
//
// Usage: node e2e/drive-franchisee.mjs [franchiseeName] [outDir]  (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, arg, loginPersona } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
// Dash-agnostic brand substring: live chip names use an em-dash ("Budget Blinds
// — Irvine"). Matching the brand picks the seeded budget-blinds-irvine tenant
// (where smoke-api books appointments) so the dashboard has data to render.
const franchiseeName = arg(2, "Budget Blinds");
const KPIS = 'section[aria-label="Key performance indicators"] button';

const { browser, page, errors } = await launch({ width: 1280, height: 900, api });
const shot = shotter(page, dir);

try {
  if (api) console.log(`API base override: ${api}`);
  // 1. sign in as a franchisee persona -> routes to the operator dashboard
  const who = await loginPersona(page, web, { tier: "Franchisee", name: franchiseeName });
  console.log(`signed in as "${who}" (franchisee scope)`);
  await page.waitForSelector("h1:has-text('Operations Dashboard')", { timeout: 15000 });

  // 2. operator KPI tiles must render (a blank read-model fails loudly)
  await page.waitForSelector(KPIS, { timeout: 12000 });
  const kpiCount = await page.locator(KPIS).count();
  console.log(`operator dashboard loaded; KPI tiles: ${kpiCount}`);
  if (!kpiCount) throw new Error("operator dashboard rendered no KPI tiles — blank read-model?");

  // 3. desktop screenshot
  await page.waitForTimeout(400); // let the trend/funnel charts settle
  await shot("franchisee-1-desktop.png");

  // open the first action row -> detail drawer
  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  if (rowCount) {
    await rows.first().click();
    await page.waitForSelector("[role='dialog']", { timeout: 5000 });
    console.log(`opened detail drawer (${rowCount} action rows)`);
    await shot("franchisee-2-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[role='dialog']", { state: "detached", timeout: 5000 });
  } else {
    // No follow-up rows for this franchisee/period (clean funnel). Don't fake a
    // drawer shot — record why it's absent so the gap is visible, not silent.
    console.log("no action rows for this franchisee/period — skipping drawer screenshot");
  }

  // 4. mobile viewport (responsive reflow)
  await page.waitForSelector(KPIS, { timeout: 10000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot("franchisee-3-mobile.png");

  const made = ["franchisee-1-desktop.png", rowCount ? "franchisee-2-drawer.png" : null, "franchisee-3-mobile.png"]
    .filter(Boolean).join(", ");
  console.log(`\nSaved screenshots to ${dir}/: ${made}`);
  if (errors.length) { console.error("console errors:", errors); process.exitCode = 2; }
} catch (e) {
  await shot("franchisee-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved franchisee-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
