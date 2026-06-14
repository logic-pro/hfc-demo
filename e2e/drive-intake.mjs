#!/usr/bin/env node
// drive-intake.mjs — driver + screenshotter for Slice B (AI-assisted intake),
// which now lives on the Scheduling page (`/booking`).
//
// The OLD version waited for a `.chip` brand picker on the LANDING page and a
// `.intake textarea` there — both moved when the landing became the Executive
// command center. Now intake is tenant-scoped: you sign in as a franchisee
// (a `.chip` on the Scheduling page mints a token), and the intake panel appears.
//
// Flow:
//   1. shell -> Scheduling -> click a franchisee chip (mints a scoped token)
//   2. type a free-text request, "Draft with AI" -> reviewable extracted draft
//   3. screenshot the typed draft (the Slice B assertion: fields were extracted)
//   4. best-effort: "Use this -> book a slot" -> book the first open slot
//      (best-effort because live slot inventory can run out across CI runs; the
//       draft is the hard assertion, booking is a bonus screenshot)
//   5. exit non-zero on any console/page error
//
// Usage: node e2e/drive-intake.mjs [franchiseeLabel] [outDir]  (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, arg, gotoReady } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
const label = arg(2, ""); // "" -> first chip (any franchisee can run intake)

const REQUEST =
  "Hi, this is Dana in Tustin — my water heater burst overnight and flooded " +
  "the garage. I need someone out ASAP, and mornings work best for me.";

const { browser, page, errors } = await launch({ width: 1100, height: 950, api });
const shot = shotter(page, dir);

try {
  // 1. Scheduling surface, then sign in as a franchisee (chip -> /api/dev/token).
  await gotoReady(page, web, "nav.nav");
  if (api) console.log(`API base override: ${api}`);
  await page.getByRole("link", { name: "Scheduling" }).click();
  await page.waitForSelector(".chip", { timeout: 20000 });
  console.log(`scheduling surface; franchisee chips: ${await page.locator(".chip").count()}`);

  await page.locator(".chip", { hasText: label }).first().click();
  await page.waitForSelector(".context", { timeout: 10000 });
  await page.waitForSelector(".intake textarea", { timeout: 10000 });
  console.log(`signed in${label ? ` as "${label}"` : " (first franchisee)"}`);

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
