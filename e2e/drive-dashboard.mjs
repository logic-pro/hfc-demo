#!/usr/bin/env node
// drive-dashboard.mjs — headless e2e driver + screenshotter for Slice D, the
// Franchisee Operations Dashboard. Drives the REAL running stack against the
// live read-model (DashboardApiService.USE_MOCK = false) and saves PNGs:
//   1. load the SPA, pick a brand (sets the tenant)
//   2. navigate to /dashboard  -> live GET /api/dashboard (+ /territories)
//   3. screenshot the dashboard (desktop)
//   4. open an action row -> detail drawer; screenshot
//   5. exercise "Send deposit link" -> ApiService.deposit(...) -> read-model reload
//   6. screenshot at a mobile viewport (responsive reflow, no reload)
//
// Prereqs: API on :5180 and `ng serve` on :4200 (see run-hfc-demo SKILL.md).
// Usage:   node e2e/drive-dashboard.mjs [brandName] [outDir]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const WEB = process.env.WEB_URL ?? "http://localhost:4200";
const API_BASE = process.env.API_BASE ?? null; // override the SPA's API base if set
const brandName = process.argv[2] ?? "Budget Blinds";
const outDir = resolve(process.argv[3] ?? "/tmp/hfc-shots");
mkdirSync(outDir, { recursive: true });

const shot = (page, name) => page.screenshot({ path: resolve(outDir, name), fullPage: true });
const KPIS = 'section[aria-label="Key performance indicators"] button';

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
// Point the SPA at a specific API before any app code runs (parallel worktrees
// may hold :5180; CORS is open so a cross-origin base is fine).
if (API_BASE) {
  await page.addInitScript((base) => { window.__API_BASE__ = base; }, API_BASE);
  console.log(`API base override: ${API_BASE}`);
}
const fails = [];
page.on("console", (m) => { if (m.type() === "error") fails.push(m.text()); });

try {
  // 1. load SPA + pick the tenant (brand)
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForSelector(".chip", { timeout: 15000 });
  await page.getByRole("button", { name: brandName, exact: true }).click();
  console.log(`selected tenant "${brandName}"`);

  // 2. go to the dashboard (stay in the SPA so the tenant signal persists)
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.waitForSelector("h1:has-text('Operations Dashboard')", { timeout: 10000 });
  await page.waitForSelector(KPIS, { timeout: 10000 });
  const kpiCount = await page.locator(KPIS).count();
  console.log(`dashboard loaded; KPI tiles: ${kpiCount}`);

  // 3. desktop screenshot
  await page.waitForTimeout(400); // let the sparklines/funnel settle
  await shot(page, "dashboard-1-desktop.png");

  // 4. open an action row -> detail drawer
  const rows = page.locator("table tbody tr");
  if (await rows.count()) {
    await rows.first().click();
    await page.waitForSelector("[role='dialog']", { timeout: 5000 });
    console.log("opened detail drawer");
    await shot(page, "dashboard-2-drawer.png");

    // 5. exercise the live deposit wiring if the row is unpaid
    const send = page.getByRole("button", { name: /Send deposit link/ });
    if (await send.count()) {
      await send.first().click();
      await page.waitForSelector("[role='dialog']", { state: "detached", timeout: 8000 });
      console.log("sent deposit -> drawer closed, read-model reloaded");
    } else {
      await page.keyboard.press("Escape");
    }
  } else {
    console.log("no action rows for this brand/period (clean funnel)");
  }

  // 6. mobile viewport (responsive reflow — no reload, keeps the tenant signal)
  await page.waitForSelector(KPIS, { timeout: 10000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot(page, "dashboard-3-mobile.png");

  console.log(`\nSaved screenshots to ${outDir}/dashboard-{1-desktop,2-drawer,3-mobile}.png`);
  if (fails.length) { console.error("console errors:", fails); process.exitCode = 2; }
} catch (e) {
  await shot(page, "dashboard-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved dashboard-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
