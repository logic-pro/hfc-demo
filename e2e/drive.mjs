#!/usr/bin/env node
// drive.mjs — headless end-to-end driver + screenshotter for the HFC demo.
//
// Drives the REAL running stack through a real user flow and saves a PNG:
//   1. load the SPA (http://localhost:4200)
//   2. sign in as a franchisee (mints a token → sets the tenant) and screenshot
//   3. book the first open slot  -> proves the booking path
//   4. pay the deposit           -> proves the idempotent-payment path
//   5. screenshot the result
//
// Prereqs: API on :5180 and `ng serve` on :4200 (see SKILL.md).
// Usage:   node e2e/drive.mjs [franchiseeLabel] [outDir]
//          node e2e/drive.mjs "Budget Blinds · Irvine" /tmp
// The label is matched against the chip text "{brand} · {region}".

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const WEB = process.env.WEB_URL ?? "http://localhost:4200";
const franchiseeLabel = process.argv[2] ?? "Budget Blinds · Irvine";
const outDir = resolve(process.argv[3] ?? "/tmp");
mkdirSync(outDir, { recursive: true });

const shot = (page, name) => page.screenshot({ path: resolve(outDir, name), fullPage: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const fails = [];
page.on("console", (m) => { if (m.type() === "error") fails.push(m.text()); });

try {
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForSelector(".chip", { timeout: 15000 });
  console.log("loaded SPA; franchisee chips:", await page.locator(".chip").count());

  // 2. sign in as the franchisee (mints a token, sets the tenant)
  await page.locator(".chip", { hasText: franchiseeLabel }).first().click();
  await page.waitForSelector(".slot, .muted", { timeout: 8000 });
  const openBefore = await page.locator(".slot").count();
  console.log(`signed in as "${franchiseeLabel}"; open slots: ${openBefore}`);
  await shot(page, "hfc-1-schedule.png");

  // 3. book the first open slot
  await page.locator(".slot .btn.primary").first().click();
  await page.waitForSelector(".banner.notice", { timeout: 8000 });
  console.log("booked:", (await page.locator(".banner.notice").innerText()).trim());
  await page.waitForSelector(".appt", { timeout: 8000 });

  // 4. pay the deposit
  await page.locator(".appt .btn", { hasText: "deposit" }).first().click();
  await page.waitForSelector(".paid", { timeout: 8000 });
  console.log("deposit:", (await page.locator(".banner.notice").innerText()).trim());
  await shot(page, "hfc-2-booked-paid.png");

  console.log(`\nSaved screenshots to ${outDir}/hfc-1-schedule.png and hfc-2-booked-paid.png`);
  if (fails.length) { console.error("console errors:", fails); process.exitCode = 2; }
} catch (e) {
  await shot(page, "hfc-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved hfc-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
