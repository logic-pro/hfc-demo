#!/usr/bin/env bash
# smoke-api.sh — assert the API's multi-tenant / concurrency / idempotency
# guarantees against a running instance. Exits non-zero on the first failure.
#
#   API_BASE=http://localhost:5180 ./e2e/smoke-api.sh
set -euo pipefail
B=${API_BASE:-http://localhost:5180}
pass=0
chk() { if [ "$1" = "$2" ]; then echo "  ✓ $3"; pass=$((pass+1)); else echo "  ✗ $3 (got '$1', want '$2')"; exit 1; fi; }

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "Smoke-testing $B"

# 8 brands in the catalog (untenanted)
n=$(curl -s "$B/api/brands" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$n" "8" "brand catalog returns 8 brands"

# tenant gating: no header -> 400
chk "$(code "$B/api/slots")" "400" "slots without X-Tenant-Id -> 400"

# pick a fresh open slot for budget-blinds
SID=$(curl -s -H "X-Tenant-Id: budget-blinds" "$B/api/slots" | python3 -c "import sys,json;d=json.load(sys.stdin);print([s['id'] for s in d if not s['isBooked']][0])")

# booking -> 201
chk "$(code -X POST "$B/api/appointments" -H 'X-Tenant-Id: budget-blinds' -H 'Content-Type: application/json' -d "{\"slotId\":$SID,\"customerName\":\"Smoke\",\"service\":\"t\"}")" "201" "book open slot -> 201"

# double-book same slot -> 409
chk "$(code -X POST "$B/api/appointments" -H 'X-Tenant-Id: budget-blinds' -H 'Content-Type: application/json' -d "{\"slotId\":$SID,\"customerName\":\"Smoke2\",\"service\":\"t\"}")" "409" "re-book same slot -> 409"

# idempotent deposit: same key twice keeps the amount
AID=$(curl -s -H "X-Tenant-Id: budget-blinds" "$B/api/appointments" | python3 -c "import sys,json;print(json.load(sys.stdin)[-1]['id'])")
curl -s -X POST "$B/api/appointments/$AID/deposit" -H 'X-Tenant-Id: budget-blinds' -H 'Idempotency-Key: smoke-key' -H 'Content-Type: application/json' -d '{"amountCents":5000}' >/dev/null
amt=$(curl -s -X POST "$B/api/appointments/$AID/deposit" -H 'X-Tenant-Id: budget-blinds' -H 'Idempotency-Key: smoke-key' -H 'Content-Type: application/json' -d '{"amountCents":5000}' | python3 -c "import sys,json;print(json.load(sys.stdin)['depositCents'])")
chk "$amt" "5000" "deposit retried with same key does not double-charge"

# missing idempotency key -> 400
chk "$(code -X POST "$B/api/appointments/$AID/deposit" -H 'X-Tenant-Id: budget-blinds' -H 'Content-Type: application/json' -d '{"amountCents":5000}')" "400" "deposit without Idempotency-Key -> 400"

# cross-tenant isolation: another tenant cannot see this appointment
seen=$(curl -s -H "X-Tenant-Id: aussie-pet" "$B/api/appointments" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$seen" "0" "other tenant sees 0 of budget-blinds' appointments"

# NPS: record a post-service response -> 201, then it shows up in the measured feed
chk "$(code -X POST "$B/api/appointments/$AID/nps" -H 'X-Tenant-Id: budget-blinds' -H 'Content-Type: application/json' -d '{"score":9,"comment":"great"}')" "201" "record NPS response -> 201"

# one survey per appointment: a second response -> 409
chk "$(code -X POST "$B/api/appointments/$AID/nps" -H 'X-Tenant-Id: budget-blinds' -H 'Content-Type: application/json' -d '{"score":8,"comment":"again"}')" "409" "duplicate NPS for same appointment -> 409"

# score is validated 0–10
chk "$(code -X POST "$B/api/appointments/$AID/nps" -H 'X-Tenant-Id: budget-blinds' -H 'Content-Type: application/json' -d '{"score":11}')" "400" "out-of-range NPS score -> 400"

# the measured feed carries the clean score, territory-resolved
score=$(curl -s -H "X-Tenant-Id: budget-blinds" "$B/api/nps" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(s['score'] for s in d if s['appointmentId']==$AID))")
chk "$score" "9" "NPS feed returns the recorded score"

# cross-tenant isolation also covers NPS
nseen=$(curl -s -H "X-Tenant-Id: aussie-pet" "$B/api/nps" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "$nseen" "0" "other tenant sees 0 of budget-blinds' NPS responses"

echo "All $pass checks passed."
