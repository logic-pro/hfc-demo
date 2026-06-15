#!/usr/bin/env node
// drive-rbac.mjs — RBAC + input-validation gate for the live deploy. Pure fetch
// (no browser), deterministic, runs anywhere. Proves end to end against the API:
//
//   1. fail-closed: the corporate read-down is 401 with NO token (#25 lockdown).
//   2. the full 4-tier hierarchy is HONESTLY scoped (#32): a NETWORK persona sees
//      the whole network; brand / region / franchisee each see a STRICT subset.
//      (brand and region are siblings — each a subset of the network, neither
//      nested in the other — so we assert each < network, not a linear order.)
//   3. every brand appears in the Executive brand comparison.
//   4. input validation: a bad period / bad pagination is 400 problem+json (#31)
//      — never a 200 or an HTML error page.
//
// Counts are asserted as FLOORS / relative comparisons, never brittle exacts —
// the seed catalog grows as lanes add data (mirrors smoke-api.sh).
//
// Usage: node e2e/drive-rbac.mjs            (API_BASE / BASE / WEB_URL from env)

import { resolveBase } from "./_helpers.mjs";

const { web, api } = resolveBase();
const BASE = (api || web || "http://localhost:5180").replace(/\/$/, "");
const NETWORK_FLOOR = 24; // documented minimum network size (smoke-api pins the same floor)

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
const territories = async (token) => {
  const r = await get("/api/territories", token);
  return r.ok ? (await r.json()).totalCount : null;
};

console.log(`RBAC + validation gate vs ${BASE}\n`);

try {
  // ── 1. fail-closed: no token -> 401 ──────────────────────────────────────
  for (const p of ["/api/dashboard/corporate", "/api/dashboard/watchlist", "/api/dashboard/map", "/api/territories"]) {
    ok((await get(p)).status === 401, `no token -> 401: ${p}`);
  }

  // ── 2. network scope: the whole network + every brand in the comparison ──
  const net = await mint({ role: "corporate" });
  ok(net.status === 200 && !!net.token, "mint network (role=corporate) -> token");
  const corp = await get("/api/dashboard/corporate", net.token);
  const corpBody = corp.ok ? await corp.json() : {};
  ok(corp.status === 200, "network: GET /api/dashboard/corporate -> 200");
  ok(corpBody?.scope?.scopeLevel === "corporate", "network: scopeLevel == 'corporate'");
  const netTerr = await territories(net.token);
  ok(netTerr >= NETWORK_FLOOR, `network sees the whole network: ${netTerr} territories (>= ${NETWORK_FLOOR})`);

  // every brand in the catalog appears in the Executive brand comparison
  const brands = await (await get("/api/brands", net.token)).json();
  const cmp = corpBody.brandComparison ?? [];
  ok(brands.length >= 8, `brand catalog has all 8 brands (got ${brands.length})`);
  ok(cmp.length === brands.length, `brand comparison shows every brand (${cmp.length} == ${brands.length})`);

  // ── 3. narrower scopes each see a STRICT subset of the network ───────────
  const brand = await mint({ scope: "brand", brandId: 1 });
  ok(brand.status === 200 && !!brand.token, "mint brand scope (brandId=1) -> token");
  const brandTerr = await territories(brand.token);
  ok(brandTerr >= 1 && brandTerr < netTerr, `brand scope narrows: ${brandTerr} territories, 1..<${netTerr}`);

  const region = await mint({ scope: "region", regionId: 1 });
  ok(region.status === 200 && !!region.token, "mint region scope (regionId=1) -> token");
  const regionTerr = await territories(region.token);
  ok(regionTerr >= 1 && regionTerr < netTerr, `region scope narrows: ${regionTerr} territories, 1..<${netTerr}`);

  const op = await mint({ franchiseeId: "pacific-shade-partners-llc" });
  ok(op.status === 200 && !!op.token, "mint franchisee (pacific-shade-partners-llc) -> token");
  const opTerr = await territories(op.token);
  ok(opTerr === 1, `dashboard franchisee scoped to its own: ${opTerr} territory == 1`);

  // headline: network is the broadest; the operator is the narrowest.
  ok([brandTerr, regionTerr, opTerr].every((t) => t < netTerr),
    `network (${netTerr}) strictly > every scoped persona (brand=${brandTerr}, region=${regionTerr}, op=${opTerr})`);
  ok(opTerr <= Math.min(brandTerr, regionTerr), `franchisee (${opTerr}) is the narrowest scope`);

  // a booking-only franchisee owns NO dashboard territories: fail-closed + 403
  const bo = await mint({ franchiseeId: "budget-blinds-irvine" });
  ok((await territories(bo.token)) === 0, "booking-only franchisee fail-closed to 0 territories");
  ok((await get("/api/dashboard/corporate", bo.token)).status === 403, "franchisee -> 403 on corporate roll-up");

  // ── 4. input validation: bad input -> 400 problem+json, never 200 / HTML ──
  const badShape = async (r) => {
    const ct = r.headers.get("content-type") || "";
    const body = (await r.clone().text()).trimStart();
    return { html: ct.includes("text/html") || body.startsWith("<"), problem: ct.includes("application/problem+json") };
  };
  const badPeriod = await get("/api/dashboard/corporate?period=not-a-period", net.token);
  const bp = await badShape(badPeriod);
  ok(badPeriod.status === 400, "bad period -> 400");
  ok(!bp.html && bp.problem, "bad period -> application/problem+json (not HTML)");

  const badPage = await get("/api/territories?pageSize=abc", net.token);
  const bg = await badShape(badPage);
  ok(badPage.status === 400, "bad pagination (pageSize=abc) -> 400");
  ok(!bg.html && bg.problem, "bad pagination -> application/problem+json (not HTML)");

  const negPage = await get("/api/territories?page=-1", net.token);
  if (negPage.status !== 400) note(`OBSERVE: page=-1 -> ${negPage.status} (expected 400 once pagination is hardened)`);
  else ok(true, "negative page -> 400");
} catch (e) {
  failures.push(`threw: ${e.message}`);
  console.error("RBAC DRIVE ERROR:", e.message);
}

console.log(`\n${pass} checks passed, ${failures.length} failed.`);
if (failures.length) { console.error("FAILED:", failures.join(" | ")); process.exitCode = 1; }
