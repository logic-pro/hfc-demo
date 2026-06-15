#!/usr/bin/env node
// drive-dashboard.mjs — driver + screenshotter for the EXECUTIVE command center
// (/corporate), driving TWO corporate personas to prove RBAC scope narrows in the
// real UI (not just at the API — that's drive-rbac.mjs):
//
//   • NETWORK persona (HFC CEO)  -> the whole network; every brand in the
//     Brand Comparison table; Active Territories at the network total.
//   • BRAND persona (Budget Blinds President) -> the SAME command center re-scoped
//     server-side: Active Territories shrinks to that brand's slice (< network).
//
// Since #25 the read-down is auth-gated and since #26 login is the /login persona
// picker. Territory counts are asserted as FLOORS / relative comparisons, never
// brittle exacts — the seed catalog grows as lanes add data.
//
// Flow: /login (CEO) -> command center -> assert KPIs + 8 brands + capture network
//       territory count; sign out -> /login (Brand) -> command center -> assert the
//       same metric SHRANK. Screenshots for each scope. Non-zero on any error.
//
// Usage: node e2e/drive-dashboard.mjs [unused] [outDir]   (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, loginPersona } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
const HERO = 'section[aria-label="Network vital signs"]';
const TILES = `${HERO} ec-kpi-tile`;
const NUMERIC = `${HERO} ec-kpi-tile .tile-value.tnum`;
const BRAND_ROWS = "ec-brand-table table.bt tbody tr";
const NETWORK_FLOOR = 24; // documented minimum network size (smoke-api pins the same)

// Read the "Active Territories" hero tile's rendered number (count-up settled).
const activeTerritories = async (page) => {
  const tile = page.locator(TILES, { hasText: "Active Territories" }).first();
  const txt = (await tile.locator(".tile-value").innerText().catch(() => "")).trim();
  return { n: parseInt(txt.replace(/[^0-9]/g, ""), 10), txt };
};

const { browser, page, errors } = await launch({ width: 1280, height: 900, api });
const shot = shotter(page, dir);

const waitCommandCenter = async () => {
  await page.waitForSelector("h1:has-text('Network Operations Command Center')", { timeout: 15000 });
  await page.waitForSelector(TILES, { timeout: 20000 });
  await page.waitForSelector(NUMERIC, { timeout: 15000 });
  await page.waitForTimeout(800); // count-up + sparklines settle
};

try {
  if (api) console.log(`API base override: ${api}`);

  // ── NETWORK persona ──────────────────────────────────────────────────────
  const ceo = await loginPersona(page, web, { tier: "Franchisor HQ", name: "HFC CEO" });
  console.log(`signed in as "${ceo}" (network scope)`);
  await waitCommandCenter();
  const numericCount = await page.locator(NUMERIC).count();
  console.log(`command center: ${await page.locator(TILES).count()} KPI tiles, ${numericCount} with numbers`);
  if (!numericCount) throw new Error("hero KPIs rendered but none show a number — blank read-model?");

  const eyebrow = (await page.locator(".dash-head .eyebrow").first().innerText().catch(() => "")).trim();
  console.log(`scope eyebrow: "${eyebrow}"`);
  if (!/network/i.test(eyebrow)) throw new Error(`network scope not reflected in eyebrow: "${eyebrow}"`);

  const net = await activeTerritories(page);
  console.log(`Active Territories (network): ${net.n}`);
  if (!(net.n >= NETWORK_FLOOR)) throw new Error(`network should see the whole network (>= ${NETWORK_FLOOR}), saw ${net.n} ("${net.txt}")`);

  // every brand appears in the Executive brand comparison
  await page.waitForSelector(BRAND_ROWS, { timeout: 10000 });
  const brandRows = await page.locator(BRAND_ROWS).count();
  console.log(`brand comparison rows: ${brandRows}`);
  if (!(brandRows >= 8)) throw new Error(`expected all 8 brands in the comparison, saw ${brandRows}`);

  await shot("dashboard-1-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot("dashboard-3-mobile.png");
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── BRAND persona: same surface, re-scoped → fewer territories ────────────
  await page.locator("button.signout").click();
  await page.waitForSelector(".login .chip", { timeout: 15000 });
  const pres = await loginPersona(page, web, { tier: "Brand", name: "Budget Blinds" });
  console.log(`\nsigned in as "${pres}" (brand scope)`);
  await waitCommandCenter();
  const brandEyebrow = (await page.locator(".dash-head .eyebrow").first().innerText().catch(() => "")).trim();
  console.log(`scope eyebrow: "${brandEyebrow}"`);

  const brand = await activeTerritories(page);
  console.log(`Active Territories (brand): ${brand.n}`);
  if (!(brand.n >= 1 && brand.n < net.n)) {
    throw new Error(`brand scope should narrow (1..<${net.n}), saw ${brand.n} ("${brand.txt}")`);
  }
  console.log(`RBAC scope narrows in the UI: network ${net.n} -> brand ${brand.n}`);
  await shot("dashboard-4-brand-scope.png");

  console.log(`\nSaved screenshots to ${dir}/: dashboard-1-desktop.png, dashboard-3-mobile.png, dashboard-4-brand-scope.png`);
  if (errors.length) { console.error("console errors:", errors); process.exitCode = 2; }
} catch (e) {
  await shot("dashboard-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved dashboard-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
