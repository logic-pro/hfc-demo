#!/usr/bin/env node
// drive-franchisee.mjs — driver + screenshotter for the Franchisee OPERATOR
// dashboard (/dashboard), reached as a FRANCHISEE-scope persona.
//
// Since #26 login is the /login persona picker; the Franchisee tier mints a
// tenant-scoped token and routes straight to /dashboard. This is the bottom of
// the RBAC hierarchy: one tenant's own read-model (vs the network command center
// drive-dashboard.mjs pins at the top). A blank dashboard fails loudly.
//
// Flow:
//   1. /login -> click a Franchisee persona -> /dashboard (operator)
//   2. assert the operator KPI tiles render (tenant scope, not blank)
//   2b. lock in the PR #38 fixes so they can't silently regress:
//       - delta arrow direction agrees with the delta sign (Expired/abandoned +delta -> ▲)
//       - measured-zero deposit tiles show the neutral empty-state (no red $0, no spark)
//       - h1 + section h2s render a dark/legible colour (not the near-white ghost)
//   3. open the first action row -> detail drawer; screenshot (when rows exist)
//   4. desktop + mobile (390px) screenshots; exit non-zero on any console/page error
//      (benign CSP font-load noise is filtered in _helpers; real errors still fail)
//
// Usage: node e2e/drive-franchisee.mjs [franchiseeName] [outDir]  (WEB_URL/BASE from env)

import { launch, shotter, resolveBase, outDir, arg, loginPersona } from "./_helpers.mjs";

const { web, api } = resolveBase();
const dir = outDir(3);
// Pin a deterministic operator whose live read-model exercises the PR #38 fixes:
// Carolina Light & Shade (a Budget Blinds operator) has bookings (dashboard
// renders), measured-ZERO deposits (the empty-state path), and a POSITIVE
// expired-abandoned delta (the ▲ direction-glyph fix). Overridable via argv[2].
const franchiseeName = arg(2, "Carolina Light & Shade");
const KPIS = 'section[aria-label="Key performance indicators"] button';

const { browser, page, errors, benign } = await launch({ width: 1280, height: 900, api });
const shot = shotter(page, dir);

try {
  if (api) console.log(`API base override: ${api}`);
  // 1. sign in as a franchisee persona -> routes to the operator dashboard
  const who = await loginPersona(page, web, { tier: "Franchisee", name: franchiseeName });
  console.log(`signed in as "${who}" (franchisee scope)`);
  await page.waitForSelector("h1:has-text('Operations Dashboard')", { timeout: 15000 });

  // 2. operator KPI tiles must render (a blank read-model fails loudly)
  await page.waitForSelector(KPIS, { timeout: 12000 });
  const kpiCount = await page.locator(KPIS).count();
  console.log(`operator dashboard loaded; KPI tiles: ${kpiCount}`);
  if (!kpiCount) throw new Error("operator dashboard rendered no KPI tiles — blank read-model?");

  // ── Lock in the PR #38 franchisee-dashboard fixes (assert, don't trust) ────
  await page.waitForTimeout(300); // let the KPI grid paint
  // Pull each KPI card's shape in one pass: label, delta glyph + label, value,
  // empty-state markers, accent colour, whether a sparkline rendered.
  const cards = await page.$$eval('section[aria-label="Key performance indicators"] button', (btns) =>
    btns.map((b) => {
      // The delta chip is the rounded pill carrying the glyph + "+N%" label. NB:
      // the status accent bar is ALSO .rounded-full, so disambiguate by .font-medium
      // (the accent bar has none) — match it by its aria-hidden glyph child.
      const glyphEl = b.querySelector("span.rounded-full.font-medium span[aria-hidden='true']");
      const chip = glyphEl?.parentElement ?? null;
      const glyph = glyphEl?.textContent?.trim() ?? "";
      return {
        label: (b.querySelector("p.font-medium") ?? b.querySelector("p"))?.textContent?.trim() ?? "",
        glyph,
        deltaLabel: chip ? chip.textContent.replace(glyph, "").trim() : "",
        value: b.querySelector("p.text-3xl")?.textContent?.trim() ?? "",
        emptyLabel: [...b.querySelectorAll("span")].find((s) => /No deposits this period/.test(s.textContent))?.textContent?.trim() ?? "",
        accent: b.querySelector("span.absolute")?.className ?? "",
        hasSpark: !!b.querySelector("polyline"),
      };
    }),
  );

  // (1) Delta arrow direction agrees with the delta SIGN on every chip — the
  //     glyph (▲/▼) is derived from the same deltaPercent as the "+N%"/"−N%"
  //     label, so they can never disagree. ▲⟺"+", ▼⟺"−" (U+2212).
  let chipsChecked = 0;
  for (const c of cards) {
    if (c.glyph !== "▲" && c.glyph !== "▼") continue; // empty / no-comparison tiles
    chipsChecked++;
    const pos = c.deltaLabel.startsWith("+");
    const neg = c.deltaLabel.startsWith("−") || c.deltaLabel.startsWith("-");
    const agree = (c.glyph === "▲" && pos) || (c.glyph === "▼" && neg);
    if (!agree) throw new Error(`delta glyph/sign mismatch on "${c.label}": glyph="${c.glyph}" label="${c.deltaLabel}"`);
  }
  // the specific bug: "Expired / abandoned" carries a POSITIVE delta for this
  // operator and MUST render ▲ (the pre-fix bug showed ▼). Assert the chip is
  // actually present + parsed — never let a missing selector pass vacuously.
  const expired = cards.find((c) => /expired/i.test(c.label));
  if (!expired) throw new Error("could not find the 'Expired / abandoned' KPI card");
  if (!expired.deltaLabel.startsWith("+")) {
    throw new Error(`Expired/abandoned delta not positive as expected (glyph="${expired.glyph}" label="${expired.deltaLabel}") — chip unparsed or data drift`);
  }
  if (expired.glyph !== "▲") {
    throw new Error(`Expired/abandoned has a +delta but renders "${expired.glyph}" (regressed: must be ▲)`);
  }
  console.log(`delta glyph/sign agree on ${chipsChecked} chips; Expired/abandoned: "${expired.glyph} ${expired.deltaLabel}"`);

  // (2) Deposit empty-state honesty: a measured-zero deposit tile shows the
  //     neutral "No deposits this period" treatment — value "—", no red accent,
  //     sparkline suppressed — never a red $0/0% alarm.
  const deposits = cards.filter((c) => /deposit/i.test(c.label));
  if (deposits.length < 2) throw new Error(`expected 2 deposit KPI tiles, found ${deposits.length}`);
  const isDash = (v) => /^[—–-]$/.test(v); // em / en / hyphen — the empty placeholder
  for (const d of deposits) {
    // This operator's deposits are a measured zero -> the tile MUST take the
    // neutral empty-state, not a red $0/0%. A non-dash value here means either a
    // regression or a stale build that predates the fix — fail loudly either way.
    if (!isDash(d.value)) throw new Error(`deposit "${d.label}" shows "${d.value}" not the neutral "—" empty-state (regressed or pre-#38 build)`);
    if (d.emptyLabel !== "No deposits this period") throw new Error(`empty deposit "${d.label}" missing neutral label (got "${d.emptyLabel}")`);
    if (/bg-red-/.test(d.accent)) throw new Error(`empty deposit "${d.label}" shows a RED accent — false alarm`);
    if (d.hasSpark) throw new Error(`empty deposit "${d.label}" still drew a sparkline (should be suppressed)`);
  }
  console.log(`deposit empty-state honest on ${deposits.length} measured-zero tiles (neutral "—", no red, no spark)`);

  // (3) Headings are legible on the light canvas: h1 + section h2s render a DARK
  //     colour, not the near-white that ghosted them before the contrast fix.
  const headings = await page.evaluate(() => {
    const dark = (el) => {
      const m = getComputedStyle(el).color.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
      return { text: el.textContent.trim().slice(0, 32), rgb: m, near: 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] };
    };
    const out = [{ tag: "h1", ...dark(document.querySelector("h1")) }];
    document.querySelectorAll("h2.text-slate-900").forEach((h) => out.push({ tag: "h2", ...dark(h) }));
    return out;
  });
  for (const h of headings) {
    if (h.near > 140) throw new Error(`${h.tag} "${h.text}" is near-white (luma ${h.near.toFixed(0)}, rgb ${h.rgb}) — contrast regressed`);
  }
  console.log(`headings legible: ${headings.map((h) => `${h.tag}(luma ${h.near.toFixed(0)})`).join(", ")}`);

  // 3. desktop screenshot
  await page.waitForTimeout(400); // let the trend/funnel charts settle
  await shot("franchisee-1-desktop.png");

  // open the first action row -> detail drawer
  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  if (rowCount) {
    await rows.first().click();
    await page.waitForSelector("[role='dialog']", { timeout: 5000 });
    console.log(`opened detail drawer (${rowCount} action rows)`);
    await shot("franchisee-2-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[role='dialog']", { state: "detached", timeout: 5000 });
  } else {
    // No follow-up rows for this franchisee/period (clean funnel). Don't fake a
    // drawer shot — record why it's absent so the gap is visible, not silent.
    console.log("no action rows for this franchisee/period — skipping drawer screenshot");
  }

  // 4. mobile viewport (responsive reflow)
  await page.waitForSelector(KPIS, { timeout: 10000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot("franchisee-3-mobile.png");

  const made = ["franchisee-1-desktop.png", rowCount ? "franchisee-2-drawer.png" : null, "franchisee-3-mobile.png"]
    .filter(Boolean).join(", ");
  console.log(`\nSaved screenshots to ${dir}/: ${made}`);
  if (benign.length) console.log(`(filtered ${benign.length} benign CSP font-load console warnings)`);
  if (errors.length) { console.error("console errors:", errors); process.exitCode = 2; }
} catch (e) {
  await shot("franchisee-error.png").catch(() => {});
  console.error("DRIVE FAILED:", e.message, "\n(saved franchisee-error.png)");
  process.exitCode = 1;
} finally {
  await browser.close();
}
