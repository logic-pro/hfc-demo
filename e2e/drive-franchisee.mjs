#!/usr/bin/env node
// drive-franchisee.mjs — driver + screenshotter for the Franchisee OPERATOR
// dashboard (Slice D) at /dashboard. Tenant-scoped: it reads the franchisee's
// own read-model, resolved server-side from the bearer token. So we sign in AS a
// franchisee first (a `.chip` on the Scheduling page mints a scoped token via
// /api/dev/token), then stay inside the SPA so the in-memory token survives the
// route change.
//
// Flow:
//   1. shell -> Scheduling -> click a franchisee chip (login stand-in)
//   2. SPA-navigate to Operator (router link, NOT a reload — a reload would wipe
//      the in-memory TenantService token and the read-model would 401)
//   3. assert the KPI tiles render (a blank dashboard fails loudly), screenshot desktop
//   4. open the first action row -> detail drawer; screenshot (when rows exist)
//   5. screenshot at a mobile viewport (390px reflow — no reload, token kept)
//   6. exit non-zero on ANY console/page error
//
// Usage: node e2e/drive-franchisee.mjs [franchiseeLabel] [outDir]  (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, arg, gotoReady } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
// Dash-agnostic brand substring: live chip names use an em-dash ("Budget Blinds
// — Irvine"). Matching on the brand alone picks the seeded budget-blinds-irvine
// tenant (where smoke-api books appointments) so the action table — and the
// drawer screenshot — actually populate.
const franchiseeLabel = arg(2, "Budget Blinds");
const KPIS = 'section[aria-label="Key performance indicators"] button';

const { browser, page, errors } = await launch({ width: 1280, height: 900, api });
const shot = shotter(page, dir);

try {
  // 1. shell -> Scheduling, then sign in as the franchisee (mints a scoped token)
  await gotoReady(page, web, "nav.nav");
  if (api) console.log(`API base override: ${api}`);
  await page.getByRole("link", { name: "Scheduling" }).click();
  await page.waitForSelector(".chip", { timeout: 20000 });
  console.log(`scheduling surface; franchisee chips: ${await page.locator(".chip").count()}`);

  await page.locator(".chip", { hasText: franchiseeLabel }).first().click();
  await page.waitForSelector(".context", { timeout: 10000 }); // signed-in context renders
  console.log(`signed in as "${franchiseeLabel}"`);

  // 2. SPA-navigate to the Operator dashboard (router link keeps the token alive)
  await page.getByRole("link", { name: "Operator" }).click();
  await page.waitForSelector("h1:has-text('Operations Dashboard')", { timeout: 12000 });
  await page.waitForSelector(KPIS, { timeout: 12000 });
  const kpiCount = await page.locator(KPIS).count();
  console.log(`operator dashboard loaded; KPI tiles: ${kpiCount}`);
  if (!kpiCount) throw new Error("operator dashboard rendered no KPI tiles — blank read-model?");

  // 3. desktop screenshot
  await page.waitForTimeout(400); // let the trend/funnel charts settle
  await shot("franchisee-1-desktop.png");

  // 4. open the first action row -> detail drawer
  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  if (rowCount) {
    await rows.first().click();
    await page.waitForSelector("[role='dialog']", { timeout: 5000 });
    console.log(`opened detail drawer (${rowCount} action rows)`);
    await shot("franchisee-2-drawer.png");
    await page.keyboard.press("Escape"); // clean slate before the mobile shot
    await page.waitForSelector("[role='dialog']", { state: "detached", timeout: 5000 });
  } else {
    // No follow-up rows for this franchisee/period (clean funnel). Don't fake a
    // drawer shot — record why it's absent so the gap is visible, not silent.
    console.log("no action rows for this franchisee/period — skipping drawer screenshot");
  }

  // 5. mobile viewport (responsive reflow — no reload, keeps the tenant token)
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
