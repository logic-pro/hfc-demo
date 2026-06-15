#!/usr/bin/env node
// drive-dashboard.mjs — driver + screenshotter for the EXECUTIVE command center
// (/corporate) reached as the NETWORK-scope persona (HFC CEO).
//
// Since #25 the corporate read-down is auth-gated (anonymous -> 401) and since
// #26 login is a 4-tier persona picker at /login. So this driver now signs in as
// the Franchisor HQ persona, lands on the command center, and asserts the NETWORK
// scope is visible: the hero KPIs render real numbers and "Active Territories"
// shows the whole network (24). drive-rbac.mjs proves the scope SHRINKS for
// narrower personas; here we pin the top of that hierarchy through the real UI.
//
// Flow:
//   1. /login -> click the "HFC CEO" persona (Franchisor HQ tier) -> /corporate
//   2. assert the command center + hero-8 KPI tiles render WITH NUMBERS
//   3. assert the network scope is visible (eyebrow names the network; Active
//      Territories == 24 — the whole network, not a slice)
//   4. screenshot desktop + mobile; exit non-zero on any console/page error
//
// Usage: node e2e/drive-dashboard.mjs [unused] [outDir]   (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, gotoReady, loginPersona } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
const HERO = 'section[aria-label="Network vital signs"]';
const TILES = `${HERO} ec-kpi-tile`;
const NUMERIC = `${HERO} ec-kpi-tile .tile-value.tnum`;
const NETWORK_TERRITORIES = 24; // seeded network total (smoke-api pins the same)

const { browser, page, errors } = await launch({ width: 1280, height: 900, api });
const shot = shotter(page, dir);

try {
  if (api) console.log(`API base override: ${api}`);
  // 1. sign in as the network-scope persona (HFC CEO) -> command center
  const who = await loginPersona(page, web, { tier: "Franchisor HQ", name: "HFC CEO" });
  console.log(`signed in as "${who}" (network scope)`);
  await page.waitForSelector("h1:has-text('Network Operations Command Center')", { timeout: 15000 });

  // 2. hero tiles must render data, not skeletons (skeletons are .tile.skeleton;
  //    real data renders <ec-kpi-tile>).
  await page.waitForSelector(TILES, { timeout: 20000 });
  await page.waitForSelector(NUMERIC, { timeout: 15000 });
  await page.waitForTimeout(800); // count-up + sparklines settle
  const tileCount = await page.locator(TILES).count();
  const numericCount = await page.locator(NUMERIC).count();
  console.log(`command center: ${tileCount} KPI tiles, ${numericCount} with numbers`);
  if (!numericCount) throw new Error("hero KPIs rendered but none show a number — blank read-model?");

  // 3. network scope is VISIBLE: the eyebrow names the network scope, and Active
  //    Territories shows the whole network (the top of the RBAC hierarchy).
  const eyebrow = (await page.locator(".dash-head .eyebrow").first().innerText().catch(() => "")).trim();
  console.log(`scope eyebrow: "${eyebrow}"`);
  if (!/network/i.test(eyebrow)) throw new Error(`network scope not reflected in eyebrow: "${eyebrow}"`);

  const terrTile = page.locator(`${TILES}`, { hasText: "Active Territories" }).first();
  const terrText = (await terrTile.locator(".tile-value").innerText().catch(() => "")).trim();
  const terr = parseInt(terrText.replace(/[^0-9]/g, ""), 10);
  console.log(`Active Territories (network): ${terr}`);
  if (terr !== NETWORK_TERRITORIES) {
    throw new Error(`network scope should see all ${NETWORK_TERRITORIES} territories, saw ${terr} ("${terrText}")`);
  }

  // 4. screenshots
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
