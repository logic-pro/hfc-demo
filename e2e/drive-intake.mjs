#!/usr/bin/env node
// drive-intake.mjs — driver + screenshotter for Slice B (AI-assisted intake) on
// the Scheduling page (/booking), reached as a FRANCHISEE-scope persona.
//
// Since #26, /booking is behind the franchisee guard: sign in via the /login
// persona picker first, then the booking page opens already tenant-scoped (the
// in-page chip picker reflects the signed-in franchisee) and the intake panel is
// live. The OLD driver waited for a `.chip` brand picker on a public landing page
// that no longer exists.
//
// Flow:
//   1. /login -> Franchisee persona -> /dashboard, then nav to Scheduling
//   2. type a free-text request, "Draft with AI" -> reviewable extracted draft
//   3. screenshot the typed draft (asserts the Service field was extracted)
//   4. best-effort: "Use this -> book a slot" -> book the first open slot
//   5. exit non-zero on any console/page error
//
// Usage: node e2e/drive-intake.mjs [franchiseeName] [outDir]  (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, arg, loginPersona } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
const franchiseeName = arg(2, "Budget Blinds");

const REQUEST =
  "Hi, this is Dana in Tustin — my water heater burst overnight and flooded " +
  "the garage. I need someone out ASAP, and mornings work best for me.";

const { browser, page, errors } = await launch({ width: 1100, height: 950, api });
const shot = shotter(page, dir);

try {
  if (api) console.log(`API base override: ${api}`);
  // 1. sign in as a franchisee, then go to the Scheduling surface
  const who = await loginPersona(page, web, { tier: "Franchisee", name: franchiseeName });
  console.log(`signed in as "${who}" (franchisee scope)`);
  await page.waitForSelector("h1:has-text('Operations Dashboard')", { timeout: 15000 });
  await page.getByRole("link", { name: "Scheduling" }).click();
  // Already tenant-scoped from login, so the intake panel renders without a
  // second pick; if it lags, nudge it by clicking the active franchisee chip.
  try {
    await page.waitForSelector(".intake textarea", { timeout: 8000 });
  } catch {
    await page.locator(".chip").first().click();
    await page.waitForSelector(".intake textarea", { timeout: 8000 });
  }
  console.log("scheduling surface ready (intake panel live)");

  // 2. free-text -> AI/heuristic draft
  await page.locator(".intake textarea").fill(REQUEST);
  await page.getByRole("button", { name: /Draft with AI/ }).click();

  // 3. the reviewable extracted draft (AI when keyed, else local heuristic fallback)
  await page.waitForSelector(".draft .fields", { timeout: 20000 });
  const service = await page.locator('.fields label:has(span:text("Service")) input').inputValue();
  const urgency = await page.locator('.fields label:has(span:text("Urgency")) select').inputValue();
  const badge = (await page.locator(".src-badge").innerText()).trim().replace(/\s+/g, " ");
  console.log(`drafted -> service="${service}" urgency="${urgency}" [${badge}]`);
  if (!service.trim()) throw new Error("draft rendered but Service field is empty — extraction failed");
  await shot("intake-1-draft.png");

  // 4. best-effort booking (don't red the gate on live slot exhaustion)
  try {
    await page.getByRole("button", { name: /Use this/ }).click();
    await page.waitForSelector(".banner.notice", { timeout: 8000 });
    const slotBtn = page.locator(".slot .btn.primary").first();
    if (await slotBtn.count()) {
      await slotBtn.click();
      await page.waitForSelector(".appt", { timeout: 8000 });
      const appt = (await page.locator(".appt").first().innerText()).trim().replace(/\s+/g, " ");
      console.log("booked:", appt);
      await shot("intake-2-booked.png");
    } else {
      console.log("no open slots for this franchisee — skipping booking screenshot");
    }
  } catch (e) {
    console.warn(`booking step skipped (non-fatal): ${e.message}`);
  }

  console.log(`\nSaved screenshots to ${dir}/: intake-1-draft.png (+ intake-2-booked.png if slots open)`);
  if (errors.length) { console.error("console errors:", errors); process.exitCode = 2; }
} catch (e) {
  await shot("intake-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved intake-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
