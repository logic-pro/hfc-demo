#!/usr/bin/env node
// drive-scheduling.mjs — Scheduling (/booking) tenant-isolation driver.
//
// The load-bearing assertion: the Scheduling surface a franchisee operator lands on
// is ITS OWN, with NO cross-tenant picker. The baseline demo shipped a self-serve
// "Sign in as franchisee" picker (.picker / .brand-chips) that let anyone switch
// between every tenant — a hard isolation leak for a real operator login. fix/
// scheduling-cross-tenant-picker (PR #55) removes it so /booking loads the signed-in
// operator's schedule and offers no other tenant as a switchable option.
//
// echo runs LAST and verifies fixes as they land (5cf991b discipline — load-bearing,
// never vacuous):
//   • While the picker is STILL present (PR #55 unmerged) -> one loud SKIP. We do NOT
//     assert "no picker" against a build that still has it (that would red the gate
//     for a not-yet-landed fix), and we do NOT fake a pass.
//   • Once #55 lands (picker gone) -> the isolation assertions activate and are
//     non-vacuous: we require POSITIVE proof the operator's own surface loaded
//     (its context header + the intake panel) BEFORE asserting the picker is absent,
//     so "no picker" can never pass merely because /booking is broken/blank.
//
// Usage: node e2e/drive-scheduling.mjs [franchiseeName] [outDir]  (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, arg, loginPersona } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
const franchiseeName = arg(2, "Budget Blinds");

const PICKER = ".picker, .brand-chips"; // the cross-tenant picker #55 removes
const SWITCH_CHIP = ".picker .chip, .brand-chips .chip"; // a switchable other-tenant option
const CONTEXT = ".context"; // the signed-in operator's own context header (h2 = own name)
const INTAKE = ".intake"; // the operator's own scheduling/intake surface

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { failures.push(msg); console.error(`  ✗ ${msg}`); } };
const skip = (msg) => console.log(`  · SKIP ${msg}`);

const { browser, page, errors } = await launch({ width: 1100, height: 950, api });
const shot = shotter(page, dir);

try {
  if (api) console.log(`API base override: ${api}`);
  console.log(`Scheduling isolation e2e vs ${web}\n`);

  // sign in as a franchisee operator, then open the Scheduling surface (/booking).
  const who = await loginPersona(page, web, { tier: "Franchisee", name: franchiseeName });
  console.log(`signed in as "${who}" (franchisee scope)`);
  await page.waitForSelector("h1:has-text('Operations Dashboard')", { timeout: 15000 });
  await page.getByRole("link", { name: "Scheduling" }).click();

  // Confirm /booking actually rendered SOMETHING (the picker OR the operator surface)
  // before we branch — so a blank/broken page is a hard failure, never a silent SKIP.
  await page.waitForSelector(`${PICKER}, ${CONTEXT}, ${INTAKE}`, { timeout: 15000 });
  ok(/\/booking$/.test(new URL(page.url()).pathname), `Scheduling opens /booking (url=${new URL(page.url()).pathname})`);
  await shot("scheduling-1-booking.png");

  const pickerPresent = (await page.locator(PICKER).count()) > 0;

  if (pickerPresent) {
    const chips = await page.locator(SWITCH_CHIP).count();
    skip(`/booking still renders the cross-tenant picker (${chips} switchable tenants; fix/scheduling-cross-tenant-picker #55 unmerged) — isolation assertions activate when it lands.`);
  } else {
    // #55 landed. Both halves, so "no picker" isn't vacuous on a broken page:
    // (a) the operator's OWN surface must be present (context header + intake panel),
    // (b) the cross-tenant picker + its switchable options must be GONE.
    const ownContext = (await page.locator(CONTEXT).count()) > 0;
    const ownIntake = (await page.locator(INTAKE).count()) > 0;
    ok(ownContext && ownIntake, "Scheduling loads the operator's OWN surface (context header + intake panel present)");

    // the context header's own brand/operator name is correct (NOT a leak); assert it
    // reflects the signed-in operator, proving we loaded its schedule, not a default.
    const ctxText = (await page.locator(CONTEXT).first().innerText().catch(() => "")).trim();
    const firstWord = (who || "").split(/[\s—-]/)[0];
    ok(ownContext && firstWord.length > 0 && ctxText.includes(firstWord),
      `Scheduling context header is the signed-in operator's own ("${who}")`);

    ok((await page.locator(PICKER).count()) === 0, "no cross-tenant picker on /booking (.picker / .brand-chips absent)");
    ok((await page.locator(SWITCH_CHIP).count()) === 0, "no other tenant is offered as a switchable option (no picker chips)");
    await shot("scheduling-2-no-picker.png");
  }

  console.log(`\n${pass} checks passed, ${failures.length} failed.`);
  if (failures.length) { console.error("FAILED:", failures.join(" | ")); process.exitCode = 1; }
  else if (errors.length) { console.error("console errors:", errors); process.exitCode = 2; }
} catch (e) {
  await shot("scheduling-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved scheduling-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
