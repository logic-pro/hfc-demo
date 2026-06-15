// _helpers.mjs — shared plumbing for the post-deploy Playwright drivers.
//
// NOT a driver: the post-deploy-e2e workflow runs `for d in e2e/drive-*.mjs`,
// so this `_`-prefixed file is imported, never executed standalone. It exists so
// every driver gets the SAME robustness the live gate needs:
//   - base URL from env (WEB_URL / API_BASE / BASE — same-origin live deploy)
//   - networkidle navigation with ONE retry (cold Azure app / transient 5xx)
//   - a key-selector wait so a blank 200 fails loudly instead of screenshotting white
//   - console + pageerror capture so a real client error reds the gate
// Drivers stay thin and each asserts its own surface.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// The workflow exports WEB_URL=API_BASE=$BASE; locally WEB_URL defaults to ng serve.
// Accept a bare BASE too so any caller can point all drivers at one origin.
export function resolveBase() {
  const web = process.env.WEB_URL || process.env.BASE || "http://localhost:4200";
  const api = process.env.API_BASE || process.env.BASE || null;
  return { web, api };
}

export function outDir(argIndex, fallback = "/tmp/hfc-shots") {
  const dir = resolve(process.argv[argIndex] ?? fallback);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// argv slot that may arrive as "" (the workflow passes an empty first positional);
// treat blank as "unset" so defaults apply.
export const arg = (i, dflt) => {
  const v = process.argv[i];
  return v && v.trim() ? v : dflt;
};

export async function launch({ width = 1280, height = 900, api = null } = {}) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width, height } });
  // Point the SPA at a specific API origin before any app code runs.
  if (api) await page.addInitScript((base) => { window.__API_BASE__ = base; }, api);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // Callers build their own shotter(page, dir) with the dir they chose.
  return { browser, page, errors };
}

// A screenshotter bound to a page + output dir.
export const shotter = (page, dir) => (name) =>
  page.screenshot({ path: resolve(dir, name), fullPage: true });

// Navigate, wait for the network to settle, then wait for a selector that only
// exists once the SPA has actually rendered. One retry covers a cold app or a
// transient hiccup. Throws (reds the gate) only if BOTH attempts fail.
export async function gotoReady(page, url, keySelector, { timeout = 25000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout });
      if (keySelector) await page.waitForSelector(keySelector, { timeout, state: "visible" });
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`  navigation attempt ${attempt}/2 failed: ${e.message}`);
      await page.waitForTimeout(2000);
    }
  }
  throw lastErr;
}

// Drive the /login persona picker (the single 4-tier entry point: `/` and any
// unknown path redirect here). `tier` matches the tier <h2> heading
// ("Franchisor HQ" | "Brand" | "Region" | "Franchisee"); `name` is a substring
// of the chip's name (blank -> first chip in that tier). Picking a chip mints a
// scoped token and routes: network/brand/region -> /corporate, franchisee ->
// /dashboard. Returns the persona name actually clicked.
export async function loginPersona(page, web, { tier, name = "" } = {}) {
  // Root redirects to /login; the chips only render once franchisees() resolves
  // (proves the API is reachable), so wait on a chip, not just the card.
  await gotoReady(page, web, ".login .chip");
  const tierBlock = page.locator(".tier", { has: page.locator("h2", { hasText: tier }) });
  await tierBlock.waitFor({ state: "visible", timeout: 15000 });
  const chip = tierBlock.locator(".chip", { hasText: name }).first();
  const label = (await chip.locator(".chip-name").innerText().catch(() => name)).trim();
  await chip.click();
  return label;
}

// True if the live persona picker is rendering a given tier (brand/region tiers
// stay hidden until their catalogs/scope-tokens exist server-side). Lets a driver
// drive an optional tier only when it's actually present — forward-compatible.
export async function tierPresent(page, tier, { timeout = 4000 } = {}) {
  const block = page.locator(".tier", { has: page.locator("h2", { hasText: tier }) });
  return block.first().isVisible({ timeout }).catch(() => false);
}
