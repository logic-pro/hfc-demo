#!/usr/bin/env bash
# OPT-IN PreToolUse hook: block edits outside the current lane's allowed_paths.
# Turns advisory ownership (registry.json) into a deterministic boundary.
#
# FAILS OPEN by design — allows the edit whenever anything is uncertain (no
# registry, branch not in registry, empty allowed_paths, parse error, PM/main).
# So enabling it can never brick legitimate work; it only blocks clear out-of-lane
# edits for branches that declare allowed_paths.
#
# Enable (round 2, NOT mid-round) in <repo>/.claude/settings.json:
#   { "hooks": { "PreToolUse": [ { "matcher": "Edit|Write|NotebookEdit",
#       "hooks": [ { "type": "command",
#         "command": "$CLAUDE_PROJECT_DIR/.pm/hooks/lane-guard.sh" } ] } ] } }
set -euo pipefail

INPUT="$(cat)"   # PreToolUse JSON on stdin
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
REG="$ROOT/.pm/registry.json"

# fail open if no registry / no python
[ -f "$REG" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
# PM / trunk → never restrict
case "$BRANCH" in main|master|""|HEAD) exit 0;; esac

python3 - "$REG" "$BRANCH" <<'PY' <<<"$INPUT" 2>/dev/null || exit 0
import sys, json, fnmatch
reg_path, branch = sys.argv[1], sys.argv[2]
data = json.load(open(reg_path))
ev = json.load(sys.stdin)
path = (ev.get("tool_input") or {}).get("file_path") or (ev.get("tool_input") or {}).get("notebook_path")
if not path:
    sys.exit(0)  # fail open
import os
root = os.environ.get("CLAUDE_PROJECT_DIR","")
rel = os.path.relpath(path, root) if root and path.startswith("/") else path
slots = data.get("slots") or data.get("lanes") or []
slot = next((s for s in slots if s.get("branch")==branch), None)
if not slot:
    sys.exit(0)                       # unknown branch → fail open
allowed = slot.get("allowed_paths") or []
if not allowed:
    sys.exit(0)                       # no declared ownership → fail open
def matches(rel, pat):
    pat = pat.rstrip("/")
    return (fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(rel, pat+"/*")
            or rel == pat or rel.startswith(pat.replace("/**","")+"/"))
if any(matches(rel, p) for p in allowed):
    sys.exit(0)                       # in lane → allow
# out of lane → block (exit 2 = deny; stderr shown to the model)
sys.stderr.write(f"lane-guard: '{rel}' is outside {slot.get('name',branch)}'s allowed_paths "
                 f"({allowed}). Edit your own lane, or route a request to .pm/inbox/ for the PM.\n")
sys.exit(2)
PY
