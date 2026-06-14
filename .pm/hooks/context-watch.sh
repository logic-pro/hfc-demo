#!/usr/bin/env bash
# UserPromptSubmit hook: watch the session transcript's size as a cheap proxy for
# "context is getting heavy / slow," and nudge ONCE past a threshold to run
# /context-handoff before auto-compaction summarizes detail away.
#
# Token count isn't exposed to hooks, so we use transcript bytes — a rough but
# reliable proxy (it grows with every turn + tool output). Tune HFC_CTX_WARN_MB.
# Nags at most once per crossing (marker file), resets when the transcript shrinks
# (a /clear starts a fresh, small transcript). Read-only; FAILS OPEN everywhere.
set -euo pipefail
INPUT="$(cat 2>/dev/null || true)"

# transcript_path comes in the hook's JSON payload.
TP="$(printf '%s' "$INPUT" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("transcript_path",""))' 2>/dev/null || true)"
[ -n "$TP" ] && [ -f "$TP" ] || exit 0

BYTES="$(wc -c < "$TP" 2>/dev/null || echo 0)"
WARN_MB="${HFC_CTX_WARN_MB:-12}"
THRESH=$(( WARN_MB * 1024 * 1024 ))

# Marker lives next to the transcript so it's per-session, not global.
MARK="${TP}.ctxwarned"

if [ "$BYTES" -lt "$THRESH" ]; then
  # Below threshold (e.g. right after /clear) — clear any stale marker, stay silent.
  rm -f "$MARK" 2>/dev/null || true
  exit 0
fi
# Already nudged for this session? stay silent.
[ -f "$MARK" ] && exit 0
: > "$MARK" 2>/dev/null || true

MB=$(( BYTES / 1024 / 1024 ))
REASON="🧠 Context is getting heavy (~${MB}MB transcript, threshold ${WARN_MB}MB). Good moment to checkpoint: run /context-handoff to write a focused continuation prompt, then /clear for a fast fresh session (or /compact to keep the thread). This nudge fires once."

# UserPromptSubmit: additionalContext is injected for the model to act on this turn.
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$REASON"
