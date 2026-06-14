#!/usr/bin/env bash
# Claim/check/release an advisory area lock so two lanes don't edit the same major
# area at once. NOTE: locks are a *secondary* signal — the primary conflict-prevention
# is disjoint ownership (registry allowed_paths + the lane-guard hook). Use a lock
# only when two lanes genuinely must touch one shared area in sequence.
#
# Usage:
#   scripts/pm/claim-lock.sh claim   <area> <lane> [hours]   # default 4h expiry
#   scripts/pm/claim-lock.sh release <area> <lane>
#   scripts/pm/claim-lock.sh check   <area>
set -euo pipefail

ACTION="${1:?usage: claim-lock.sh claim|release|check <area> [lane] [hours]}"
AREA="${2:?missing <area> (e.g. api-program, angular-shell, seed)}"
LOCKS="$(cd "$(dirname "$(git rev-parse --git-common-dir 2>/dev/null)")" 2>/dev/null && pwd)/.pm/locks"; mkdir -p "$LOCKS"
LOCK="$LOCKS/${AREA}.lock"

case "$ACTION" in
  check)
    if [ -f "$LOCK" ]; then echo "HELD:"; cat "$LOCK"; else echo "FREE: $AREA"; fi ;;
  claim)
    LANE="${3:?claim needs <lane>}"; HOURS="${4:-4}"
    if [ -f "$LOCK" ]; then
      owner="$(grep -m1 '^owner:' "$LOCK" | cut -d' ' -f2- || echo '?')"
      if [ "$owner" != "$LANE" ]; then echo "DENIED — $AREA held by $owner:"; cat "$LOCK"; exit 1; fi
    fi
    TS="$(date -u +%Y-%m-%dT%H-%M-%SZ 2>/dev/null || echo unknown)"
    { echo "area: $AREA"; echo "owner: $LANE"; echo "claimed: $TS"; echo "expires_hint: +${HOURS}h"; } > "$LOCK"
    echo "CLAIMED $AREA for $LANE"; cat "$LOCK" ;;
  release)
    LANE="${3:?release needs <lane>}"
    if [ -f "$LOCK" ]; then
      owner="$(grep -m1 '^owner:' "$LOCK" | cut -d' ' -f2- || echo '?')"
      [ "$owner" = "$LANE" ] || { echo "REFUSED — $AREA owned by $owner, not $LANE" >&2; exit 1; }
      rm -f "$LOCK"; echo "RELEASED $AREA"
    else echo "already free: $AREA"; fi ;;
  *) echo "unknown action: $ACTION" >&2; exit 2 ;;
esac
