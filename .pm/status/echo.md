# Status: echo
_Updated 2026-06-14T06-38-13Z (branch feat/franchisee-e2e)_

# echo — franchisee dashboard e2e driver: DONE (PR open, CI running)

**PR:** #13 · branch feat/franchisee-e2e (off origin/main) · https://github.com/logic-pro/hfc-demo/pull/13
**CI:** build · test · web · smoke — pending (gating the merge)

## What landed
- New file: e2e/drive-franchisee.mjs (103 lines). Scope: e2e/ ONLY — no web/ or api/ touched.
- Playwright driver for the Franchisee Operations Dashboard (Slice D, /dashboard):
  1. /booking -> click franchisee chip -> POST /api/dev/token (franchisee-scoped sign-in, modelled on drive.mjs)
  2. SPA-nav to /dashboard via router link (NOT reload — preserves in-memory tenant token; reload would 401 the read-model)
  3. live GET /api/dashboard?period=… (+ /api/dashboard/territories)
  4. screenshots: desktop (1280), detail drawer open, mobile (390px reflow)
  5. exits non-zero on any console error; drawer shot skipped+logged (not faked) when a franchisee/period has no action rows

## Validation
- AOT/TS compile CLEAN: ng build --configuration development succeeds (dashboard-page-component lazy chunk builds).
- Prod npm run build fails ONLY on Google-Fonts inlining over network (sandbox offline) — unrelated; e2e scripts arent in the Angular build graph.
- node --check passes.
- Chromium can NOT launch in this sandbox (missing libnspr4.so) — confirmed it dies at chromium.launch(). Runs in CI / networked machine. NOT faked as a pass.

## Notes / handoff
- Discovered (informational, no action from me — out of my lane): tenant.interceptor strips the token for URLs containing /api/dashboard/ , so the franchisee /api/dashboard/territories call goes UNauthenticated. The main /api/dashboard?… call keeps the token (no trailing slash). Driver still works via the live read-model; flag for whoever owns web/ if territories ever needs franchisee scoping.
- Idle-clean after this. Awaiting next assignment.
