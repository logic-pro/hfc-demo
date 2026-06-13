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

echo "Smoke-testing $B"

# 8 brands in the catalog (untenanted)
n=$(curl -s "$B/api/brands" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$n" "8" "brand catalog returns 8 brands"

# 16 franchisees in the catalog (untenanted) — two per brand
fn=$(curl -s "$B/api/franchisees" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$fn" "16" "franchisee catalog returns 16 franchisees"

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
