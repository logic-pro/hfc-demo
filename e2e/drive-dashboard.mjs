#!/usr/bin/env node
// drive-dashboard.mjs — driver + screenshotter for the EXECUTIVE command center
// (the franchisor read-down surface at `/corporate`, which `/` redirects to).
//
// This is the anonymous corporate lens: no sign-in. The server resolves an
// unauthenticated request to the corporate roll-up (see smoke-api.sh
// "dashboard/corporate: anonymous -> corporate lens"), so the hero KPIs load
// straight away. The OLD version of this driver waited for a `.chip` brand
// picker on the landing page — that picker is gone (chips now live on the
// Scheduling page), which is why the live gate was timing out. The franchisee
// Operator surface is covered separately by drive-franchisee.mjs.
//
// Flow:
//   1. load the SPA shell, click the "Executive" nav (default surface anyway)
//   2. wait for the command center + hero-8 KPI tiles to RENDER WITH NUMBERS
//      (skeletons render plain .tile.card.skeleton; real data renders <ec-kpi-tile>)
//   3. screenshot desktop + mobile (390px reflow)
//   4. exit non-zero on any console/page error, or if no KPI ever shows a number
//
// Usage: node e2e/drive-dashboard.mjs [unused] [outDir]   (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, gotoReady } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
const HERO = 'section[aria-label="Network vital signs"]';
const TILES = `${HERO} ec-kpi-tile`;
const NUMERIC = `${HERO} ec-kpi-tile .tile-value.tnum`; // a rendered, real number

const { browser, page, errors } = await launch({ width: 1280, height: 900, api });
const shot = shotter(page, dir);

try {
  // 1. enter at the shell, then SPA-navigate to the Executive surface explicitly.
  await gotoReady(page, web, "nav.nav");
  if (api) console.log(`API base override: ${api}`);
  await page.getByRole("link", { name: "Executive" }).click();

  // 2. the command center + hero tiles must actually render data (not skeletons).
  await page.waitForSelector("h1:has-text('Network Operations Command Center')", { timeout: 15000 });
  await page.waitForSelector(TILES, { timeout: 20000 });
  const tileCount = await page.locator(TILES).count();
  await page.waitForSelector(NUMERIC, { timeout: 15000 }); // ≥1 KPI with a real value
  await page.waitForTimeout(700); // let the count-up + sparklines settle
  const numericCount = await page.locator(NUMERIC).count();
  console.log(`executive command center: ${tileCount} KPI tiles, ${numericCount} with numbers`);
  if (!numericCount) throw new Error("hero KPIs rendered but none show a number — blank read-model?");

  // 3. screenshots
  await shot("dashboard-1-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot("dashboard-3-mobile.png");

  console.log(`\nSaved screenshots to ${dir}/: dashboard-1-desktop.png, dashboard-3-mobile.png`);
  if (errors.length) { console.error("console errors:", errors); process.exitCode = 2; }
} catch (e) {
  await shot("dashboard-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved dashboard-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
