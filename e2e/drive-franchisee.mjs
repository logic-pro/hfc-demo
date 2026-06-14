#!/usr/bin/env node
// drive-franchisee.mjs — headless e2e driver + screenshotter for the Franchisee
// Operations Dashboard (Slice D, merge #5) at /dashboard. Unlike the corporate
// surface, this dashboard is tenant-scoped: it reads the franchisee's own
// read-model, resolved server-side from the bearer token. So we sign in AS a
// franchisee first (the dev-token endpoint, modelled on e2e/drive.mjs), then
// stay inside the SPA so the in-memory token survives the route change.
//
// Flow:
//   1. load the SPA shell, go to /booking, click a franchisee chip
//      -> POST /api/dev/token mints a franchisee-scoped token (login stand-in)
//   2. SPA-navigate to /dashboard (router link, NOT a reload — a full reload
//      would wipe the in-memory TenantService token and the read-model 401s)
//      -> live GET /api/dashboard?period=… (token attached) + /api/dashboard/territories
//   3. screenshot the dashboard (desktop)
//   4. open the first action row -> detail drawer; screenshot it open
//   5. screenshot at a mobile viewport (390px reflow — no reload, token kept)
//   6. exit non-zero on ANY console error (so CI fails loudly)
//
// Prereqs: API on :5180 and `ng serve` on :4200 (see run-hfc-demo SKILL.md).
// Usage:   node e2e/drive-franchisee.mjs [franchiseeLabel] [outDir]
//          node e2e/drive-franchisee.mjs "Budget Blinds · Irvine" /tmp/hfc-shots
// The label is matched against the chip text "{brandName} · {region}".

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const WEB = process.env.WEB_URL ?? "http://localhost:4200";
const API_BASE = process.env.API_BASE ?? null; // override the SPA's API base if set
const franchiseeLabel = process.argv[2] ?? "Budget Blinds · Irvine";
const outDir = resolve(process.argv[3] ?? "/tmp/hfc-shots");
mkdirSync(outDir, { recursive: true });

const shot = (page, name) => page.screenshot({ path: resolve(outDir, name), fullPage: true });
const KPIS = 'section[aria-label="Key performance indicators"] button';

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Point the SPA at a specific API before any app code runs (parallel worktrees
// may hold :5180; CORS is open so a cross-origin base is fine).
if (API_BASE) {
  await page.addInitScript((base) => { window.__API_BASE__ = base; }, API_BASE);
  console.log(`API base override: ${API_BASE}`);
}
const fails = [];
page.on("console", (m) => { if (m.type() === "error") fails.push(m.text()); });

try {
  // 1. load the shell, then SPA-navigate to /booking where the tenant picker lives
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Scheduling" }).click();
  await page.waitForSelector(".chip", { timeout: 15000 });
  console.log("loaded booking surface; franchisee chips:", await page.locator(".chip").count());

  // sign in as the franchisee (mints a scoped token via /api/dev/token)
  await page.locator(".chip", { hasText: franchiseeLabel }).first().click();
  await page.waitForSelector(".context", { timeout: 8000 }); // signed-in context renders
  console.log(`signed in as "${franchiseeLabel}"`);

  // 2. SPA-navigate to the operator dashboard (router link keeps the token alive)
  await page.getByRole("link", { name: "Operator" }).click();
  await page.waitForSelector("h1:has-text('Operations Dashboard')", { timeout: 10000 });
  await page.waitForSelector(KPIS, { timeout: 10000 });
  console.log(`dashboard loaded; KPI tiles: ${await page.locator(KPIS).count()}`);

  // 3. desktop screenshot
  await page.waitForTimeout(400); // let the trend/funnel charts settle
  await shot(page, "franchisee-1-desktop.png");

  // 4. open the first action row -> detail drawer
  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  if (rowCount) {
    await rows.first().click();
    await page.waitForSelector("[role='dialog']", { timeout: 5000 });
    console.log(`opened detail drawer (${rowCount} action rows)`);
    await shot(page, "franchisee-2-drawer.png");
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
  await shot(page, "franchisee-3-mobile.png");

  const made = ["franchisee-1-desktop.png", rowCount ? "franchisee-2-drawer.png" : null, "franchisee-3-mobile.png"]
    .filter(Boolean).join(", ");
  console.log(`\nSaved screenshots to ${outDir}/: ${made}`);
  if (fails.length) { console.error("console errors:", fails); process.exitCode = 2; }
} catch (e) {
  await shot(page, "franchisee-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved franchisee-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
