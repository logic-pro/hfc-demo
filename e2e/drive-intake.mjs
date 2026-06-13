#!/usr/bin/env node
// drive-intake.mjs — driver + screenshotter for Slice B (AI-assisted intake).
//
// Drives the REAL running stack through the intake flow and saves PNGs:
//   1. load the SPA, pick a brand (Lightspeed — the emergency-restoration case)
//   2. type a free-text request and click "Draft with AI"
//   3. screenshot the extracted, reviewable typed draft
//   4. click "Use this" -> book the first open slot (sentence -> structured booking)
//   5. screenshot the booked appointment
//
// Prereqs: API on :5180 and `ng serve` on :4200 (see SKILL.md).
// Usage:   node e2e/drive-intake.mjs [brandName] [outDir]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const WEB = process.env.WEB_URL ?? "http://localhost:4200";
const brandName = process.argv[2] ?? "Lightspeed Restoration";
const outDir = resolve(process.argv[3] ?? "/tmp/hfc-shots");
mkdirSync(outDir, { recursive: true });

const REQUEST =
  "Hi, this is Dana in Tustin — my water heater burst overnight and flooded " +
  "the garage. I need someone out ASAP, and mornings work best for me.";

const shot = (page, name) => page.screenshot({ path: resolve(outDir, name), fullPage: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const fails = [];
page.on("console", (m) => { if (m.type() === "error") fails.push(m.text()); });

try {
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForSelector(".chip", { timeout: 15000 });

  // 1. pick the tenant
  await page.getByRole("button", { name: brandName, exact: true }).click();
  await page.waitForSelector(".intake textarea", { timeout: 8000 });
  console.log(`selected "${brandName}"`);

  // 2. type the free-text request and draft
  await page.locator(".intake textarea").fill(REQUEST);
  await page.getByRole("button", { name: /Draft with AI/ }).click();

  // 3. the reviewable typed draft appears
  await page.waitForSelector(".draft .fields", { timeout: 12000 });
  const service = await page.locator('.fields label:has(span:text("Service")) input').inputValue();
  const urgency = await page.locator('.fields label:has(span:text("Urgency")) select').inputValue();
  const badge = (await page.locator(".src-badge").innerText()).trim().replace(/\s+/g, " ");
  console.log(`drafted -> service="${service}" urgency="${urgency}" [${badge}]`);
  await shot(page, "intake-1-draft.png");

  // 4. accept the draft and book the first open slot
  await page.getByRole("button", { name: /Use this/ }).click();
  await page.waitForSelector(".banner.notice", { timeout: 8000 });
  await page.locator(".slot .btn.primary").first().click();
  await page.waitForSelector(".appt", { timeout: 8000 });
  const appt = (await page.locator(".appt").first().innerText()).trim().replace(/\s+/g, " ");
  console.log("booked:", appt);
  await shot(page, "intake-2-booked.png");

  console.log(`\nSaved screenshots to ${outDir}/intake-1-draft.png and intake-2-booked.png`);
  if (fails.length) { console.error("console errors:", fails); process.exitCode = 2; }
} catch (e) {
  await shot(page, "intake-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved intake-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
