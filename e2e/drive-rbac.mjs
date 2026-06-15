#!/usr/bin/env node
// drive-rbac.mjs — RBAC + input-validation gate for the live deploy. Unlike the
// Playwright drivers this is pure fetch (no browser), so it runs anywhere and is
// fully deterministic. It proves, end to end against the deployed API:
//
//   1. fail-closed: the corporate read-down is 401 with NO token (#25 lockdown).
//   2. scope SHRINKS down the hierarchy: a NETWORK persona sees the whole network
//      (24 territories); a FRANCHISEE persona sees only its own (1) — and a
//      booking-only franchisee fail-closes to 0 and is 403 on corporate.
//   3. input validation: a bad period / bad pagination is 400 — NOT a 200 or an
//      HTML error page (the validation bugs bravo is hardening).
//
// The middle BRAND/REGION tiers are forward-compatible: their scope tokens aren't
// implemented server-side yet (the /login picker hides those tiers too), so we
// PROBE and slot them into the shrink chain only when they exist — never fail on
// their absence, but report it so the gap stays visible.
//
// Usage: node e2e/drive-rbac.mjs            (API_BASE / BASE / WEB_URL from env)

import { resolveBase } from "./_helpers.mjs";

const { web, api } = resolveBase();
const BASE = (api || web || "http://localhost:5180").replace(/\/$/, "");

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { failures.push(msg); console.error(`  ✗ ${msg}`); } };
const note = (msg) => console.log(`  · ${msg}`);

const mint = async (body) => {
  const r = await fetch(`${BASE}/api/dev/token`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, token: r.ok ? (await r.json()).token : null };
};
const get = (path, token) =>
  fetch(`${BASE}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
const territoriesCount = async (token) => {
  const r = await get("/api/territories", token);
  if (!r.ok) return { status: r.status, count: null };
  return { status: r.status, count: (await r.json()).totalCount };
};

console.log(`RBAC + validation gate vs ${BASE}\n`);

try {
  // ── 1. fail-closed: no token -> 401 (anonymous read-down bypass is closed) ──
  for (const p of ["/api/dashboard/corporate", "/api/dashboard/watchlist", "/api/dashboard/map", "/api/territories"]) {
    ok((await get(p)).status === 401, `no token -> 401: ${p}`);
  }

  // ── 2. scope shrinks down the hierarchy ──────────────────────────────────
  const net = await mint({ role: "corporate" });
  ok(net.status === 200 && !!net.token, "mint network (role=corporate) -> token");
  const corp = await get("/api/dashboard/corporate", net.token);
  const corpBody = corp.ok ? await corp.json() : {};
  ok(corp.status === 200, "network: GET /api/dashboard/corporate -> 200");
  ok(corpBody?.scope?.scopeLevel === "corporate", "network: scopeLevel == 'corporate'");
  const netTerr = (await territoriesCount(net.token)).count;
  ok(netTerr === 24, `network sees the whole network: ${netTerr} territories == 24`);

  // optional BRAND / REGION tiers — probe; slot into the chain only if supported
  const chain = [{ tier: "network", count: netTerr }];
  for (const probe of [{ tier: "brand", body: { scope: "brand", brandId: 1 } },
                       { tier: "region", body: { scope: "region", regionId: 1 } }]) {
    const m = await mint(probe.body);
    if (m.status === 200 && m.token) {
      const c = (await territoriesCount(m.token)).count;
      chain.push({ tier: probe.tier, count: c });
      note(`${probe.tier} scope present -> ${c} territories`);
    } else {
      note(`${probe.tier} scope NOT deployed (mint -> ${m.status}); tier hidden in /login too — skipping`);
    }
  }

  // FRANCHISEE tier — a dashboard operator is hard-scoped to its OWN territory.
  const op = await mint({ franchiseeId: "pacific-shade-partners-llc" });
  ok(op.status === 200 && !!op.token, "mint franchisee (pacific-shade-partners-llc) -> token");
  const opTerr = (await territoriesCount(op.token)).count;
  ok(opTerr === 1, `dashboard franchisee scoped to its own: ${opTerr} territory == 1`);
  chain.push({ tier: "franchisee", count: opTerr });

  // the headline assertion: the territory count is monotonically NON-INCREASING
  // down the chain, and STRICTLY shrinks from network to franchisee (24 -> 1).
  const counts = chain.map((c) => c.count);
  const monotone = counts.every((c, i) => i === 0 || c <= counts[i - 1]);
  ok(monotone, `scope shrinks down the chain: ${chain.map((c) => `${c.tier}=${c.count}`).join(" >= ")}`);
  ok(netTerr > opTerr, `network (${netTerr}) strictly > franchisee (${opTerr}) — RBAC scope is visible`);

  // a booking-only franchisee owns NO dashboard territories: fail-closed + 403
  const bo = await mint({ franchiseeId: "budget-blinds-irvine" });
  ok((await territoriesCount(bo.token)).count === 0, "booking-only franchisee fail-closed to 0 territories");
  ok((await get("/api/dashboard/corporate", bo.token)).status === 403, "franchisee -> 403 on corporate roll-up");

  // ── 3. input validation: bad input -> 400, never 200 or an HTML error page ──
  const isHtml = async (r) =>
    (r.headers.get("content-type") || "").includes("text/html") || (await r.clone().text()).trimStart().startsWith("<");
  const badPeriod = await get("/api/dashboard/corporate?period=not-a-period", net.token);
  ok(badPeriod.status === 400, "bad period -> 400");
  ok(!(await isHtml(badPeriod)), "bad period -> not an HTML error page");

  const badPage = await get("/api/territories?pageSize=abc", net.token);
  ok(badPage.status === 400, "bad pagination (pageSize=abc) -> 400");
  ok(!(await isHtml(badPage)), "bad pagination -> not an HTML error page");

  // observation only — a negative page is currently accepted (clamped); flag it,
  // don't fail the gate on a value bravo's hardening may still be landing.
  const negPage = await get("/api/territories?page=-1", net.token);
  if (negPage.status !== 400) note(`OBSERVE: page=-1 -> ${negPage.status} (expected 400 once pagination is hardened)`);
} catch (e) {
  failures.push(`threw: ${e.message}`);
  console.error("RBAC DRIVE ERROR:", e.message);
}

console.log(`\n${pass} checks passed, ${failures.length} failed.`);
if (failures.length) { console.error("FAILED:", failures.join(" | ")); process.exitCode = 1; }
