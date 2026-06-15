#!/usr/bin/env bash
# smoke-api.sh — assert the API's auth / multi-tenant / concurrency / idempotency
# guarantees against a running instance. Exits non-zero on the first failure.
# Tenant now comes from a VERIFIED token claim, not a header: we mint a dev token
# per franchisee (the /api/dev/token endpoint stands in for B2C/Entra login).
#
#   API_BASE=http://localhost:5180 ./e2e/smoke-api.sh
set -euo pipefail
B=${API_BASE:-http://localhost:5180}
pass=0
chk() { if [ "$1" = "$2" ]; then echo "  ✓ $3"; pass=$((pass+1)); else echo "  ✗ $3 (got '$1', want '$2')"; exit 1; fi; }

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
# Mint a token for a franchisee (dev login stand-in).
tok() { curl -s -X POST "$B/api/dev/token" -H 'Content-Type: application/json' \
          -d "{\"franchiseeId\":\"$1\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"; }
# Mint a CORPORATE (franchisor) token — role-based, no tenant. Backs the executive
# dashboard read-down now that the corporate endpoints are auth-gated.
corptok() { curl -s -X POST "$B/api/dev/token" -H 'Content-Type: application/json' \
          -d '{"role":"corporate"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"; }

echo "Smoke-testing $B"

# 8 brands in the catalog (untenanted)
n=$(curl -s "$B/api/brands" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$n" "8" "brand catalog returns 8 brands"

# at least the 16 operational franchisees (two per brand); dashboard lanes seed more.
# Assert a floor, not an exact count — the catalog grows as lanes add seed data.
fn=$(curl -s "$B/api/franchisees" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$([ "$fn" -ge 16 ] && echo ok || echo "$fn")" "ok" "franchisee catalog returns >=16 franchisees (got $fn)"

# auth gating: no token -> 401 (fail-closed at the edge)
chk "$(code "$B/api/slots")" "401" "slots without a token -> 401"

# two franchisees of the SAME brand — the isolation boundary
BB=$(tok budget-blinds-irvine)
TU=$(tok budget-blinds-tustin)

# pick a fresh open slot for budget-blinds-irvine
SID=$(curl -s -H "Authorization: Bearer $BB" "$B/api/slots" | python3 -c "import sys,json;d=json.load(sys.stdin);print([s['id'] for s in d if not s['isBooked']][0])")

# booking -> 201
chk "$(code -X POST "$B/api/appointments" -H "Authorization: Bearer $BB" -H 'Content-Type: application/json' -d "{\"slotId\":$SID,\"customerName\":\"Smoke\",\"service\":\"t\"}")" "201" "book open slot -> 201"

# double-book same slot -> 409 (optimistic concurrency)
chk "$(code -X POST "$B/api/appointments" -H "Authorization: Bearer $BB" -H 'Content-Type: application/json' -d "{\"slotId\":$SID,\"customerName\":\"Smoke2\",\"service\":\"t\"}")" "409" "re-book same slot -> 409"

# same-brand, different franchisee cannot book Irvine's slot -> 404 (write isolation)
chk "$(code -X POST "$B/api/appointments" -H "Authorization: Bearer $TU" -H 'Content-Type: application/json' -d "{\"slotId\":$SID,\"customerName\":\"Intruder\",\"service\":\"t\"}")" "404" "other franchisee can't book this slot -> 404"

# idempotent deposit: same key twice keeps the amount
AID=$(curl -s -H "Authorization: Bearer $BB" "$B/api/appointments" | python3 -c "import sys,json;print(json.load(sys.stdin)[-1]['id'])")
curl -s -X POST "$B/api/appointments/$AID/deposit" -H "Authorization: Bearer $BB" -H 'Idempotency-Key: smoke-key' -H 'Content-Type: application/json' -d '{"amountCents":5000}' >/dev/null
amt=$(curl -s -X POST "$B/api/appointments/$AID/deposit" -H "Authorization: Bearer $BB" -H 'Idempotency-Key: smoke-key' -H 'Content-Type: application/json' -d '{"amountCents":5000}' | python3 -c "import sys,json;print(json.load(sys.stdin)['depositCents'])")
chk "$amt" "5000" "deposit retried with same key does not double-charge"

# missing idempotency key -> 400
chk "$(code -X POST "$B/api/appointments/$AID/deposit" -H "Authorization: Bearer $BB" -H 'Content-Type: application/json' -d '{"amountCents":5000}')" "400" "deposit without Idempotency-Key -> 400"

# cross-franchisee isolation: another franchisee cannot see this appointment
seen=$(curl -s -H "Authorization: Bearer $TU" "$B/api/appointments" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$seen" "0" "other franchisee sees 0 of budget-blinds-irvine's appointments"

# ── Dashboard API (D6–D9 + v1.1 map): RBAC scope is sourced from the token claim,
# never a header. The franchisor read-down is now AUTH-GATED (feat/corporate-role):
#   • no token  -> 401 (the old anonymous corporate-lens bypass is closed)
#   • corporate role token -> the corporate lens (sees all)
#   • franchisee token -> hard-scoped to its own territories (fail-closed) ────────
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }

CORP=$(corptok)

# 0) HOLE CLOSED: every franchisor read-down endpoint rejects an anonymous caller.
chk "$(code "$B/api/dashboard/corporate")" "401" "corporate: no token -> 401 (anon bypass closed)"
chk "$(code "$B/api/dashboard/watchlist")" "401" "watchlist: no token -> 401"
chk "$(code "$B/api/dashboard/map")"       "401" "map: no token -> 401"
chk "$(code "$B/api/territories")"          "401" "territories: no token -> 401"
chk "$(code "$B/api/territories/1/health-score")" "401" "health-score: no token -> 401"

# 1) corporate vital signs — a corporate-role token resolves to the corporate lens
sl=$(curl -s -H "Authorization: Bearer $CORP" "$B/api/dashboard/corporate" | jget "['scope']['scopeLevel']")
chk "$sl" "corporate" "dashboard/corporate: corporate token -> corporate lens"

# 2) territory registry — corporate sees the whole network (floor, not a brittle exact count)
tc=$(curl -s -H "Authorization: Bearer $CORP" "$B/api/territories" | jget "['totalCount']")
chk "$([ "$tc" -ge 24 ] && echo ok || echo "$tc")" "ok" "territories: corporate sees the full network (>=24, got $tc)"

# 3) health-score — present for a known territory
chk "$(code -H "Authorization: Bearer $CORP" "$B/api/territories/1/health-score")" "200" "health-score: territory 1 -> 200"

# 4) watchlist — returns the pre-computed flag rows
chk "$(code -H "Authorization: Bearer $CORP" "$B/api/dashboard/watchlist")" "200" "watchlist -> 200"

# 5) map (v1.1, additive) — a dot per territory, corporate sees the whole network
mc=$(curl -s -H "Authorization: Bearer $CORP" "$B/api/dashboard/map" | jget "['totalCount']")
chk "$([ "$mc" -ge 24 ] && echo ok || echo "$mc")" "ok" "map: corporate sees a dot per territory (>=24, got $mc)"

# a franchisee token cannot reach the corporate-only watchlist/map -> 403
chk "$(code -H "Authorization: Bearer $TU" "$B/api/dashboard/watchlist")" "403" "watchlist: franchisee -> 403 (corporate-only)"
chk "$(code -H "Authorization: Bearer $TU" "$B/api/dashboard/map")"       "403" "map: franchisee -> 403 (corporate-only)"

# unknown-id fail-closed: a non-existent territory -> 404 (never another's row)
chk "$(code -H "Authorization: Bearer $CORP" "$B/api/territories/9999/health-score")" "404" "health-score: unknown territory -> 404"

# RBAC boundary — a franchisee token is scoped from the CLAIM (not a header):
# A booking-only operational franchisee (budget-blinds-irvine) owns NO dashboard
# territories, so its franchisee lens is fail-closed to 0 — and it still can't
# open corporate or read any territory's score.
FT=$(tok budget-blinds-irvine)
ftc=$(curl -s -H "Authorization: Bearer $FT" "$B/api/territories" | jget "['totalCount']")
chk "$ftc" "0" "territories: non-dashboard franchisee fail-closed (own only)"
# franchisee cannot open the corporate roll-up -> 403
chk "$(code -H "Authorization: Bearer $FT" "$B/api/dashboard/corporate")" "403" "corporate roll-up: franchisee -> 403"
# franchisee cannot read a territory outside its scope -> 403 (cross-tenant)
chk "$(code -H "Authorization: Bearer $FT" "$B/api/territories/1/health-score")" "403" "health-score: cross-tenant -> 403"

# Franchisee lens on REAL data (slug↔read-model reconciled, INTEGRATION.md #1):
# the read model carries each row's franchisee_slug, so a DASHBOARD operator's
# token (the claim IS that slug) is hard-scoped to exactly its own territories.
# Pacific Shade Partners LLC operates only Orange County North (territory 1).
OP=$(tok pacific-shade-partners-llc)
opc=$(curl -s -H "Authorization: Bearer $OP" "$B/api/territories" | jget "['totalCount']")
chk "$opc" "1" "territories: dashboard franchisee scoped to its own (1)"
# it CAN read its own territory's score -> 200
chk "$(code -H "Authorization: Bearer $OP" "$B/api/territories/1/health-score")" "200" "health-score: own territory -> 200"
# but NOT a territory it does not operate -> 403 (cross-tenant)
chk "$(code -H "Authorization: Bearer $OP" "$B/api/territories/2/health-score")" "403" "health-score: non-own territory -> 403"
# and still cannot open the corporate roll-up -> 403
chk "$(code -H "Authorization: Bearer $OP" "$B/api/dashboard/corporate")" "403" "corporate roll-up: dashboard franchisee -> 403"
# NPS: record a post-service response for budget-blinds-irvine's appointment -> 201
chk "$(code -X POST "$B/api/appointments/$AID/nps" -H "Authorization: Bearer $BB" -H 'Content-Type: application/json' -d '{"score":9,"comment":"great"}')" "201" "record NPS response -> 201"

# the measured feed carries the clean score, territory-resolved (no join needed)
score=$(curl -s -H "Authorization: Bearer $BB" "$B/api/nps" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(s['score'] for s in d if s['appointmentId']==$AID))")
chk "$score" "9" "NPS feed returns the recorded score"

# cross-franchisee isolation also covers NPS: a same-brand sibling franchisee
# (budget-blinds-tustin) cannot read budget-blinds-irvine's NPS responses
nseen=$(curl -s -H "Authorization: Bearer $TU" "$B/api/nps" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$nseen" "0" "other franchisee sees 0 of budget-blinds-irvine's NPS responses"

echo "All $pass checks passed."
