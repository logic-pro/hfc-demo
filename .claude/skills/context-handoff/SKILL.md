---
name: context-handoff
description: Checkpoint a long session before resetting it. Summarizes the work done and the live state, writes a focused continuation prompt to .pm/handoffs/latest.md, and tells you how to /clear and resume — so a fresh, fast session picks up exactly where this one left off. Use when context is large/slow, before a planned break, or when a watch hook nudges you.
---

# Context Handoff

A long session gets slow and lossy: every turn re-reads a growing transcript, and
auto-compaction eventually summarizes away detail you cared about. This skill makes
the reset *deliberate* instead of accidental — you decide what survives.

**Honest boundary:** a skill cannot clear or compact the session itself (only you can,
via `/clear` or `/compact`). What it does is produce the handoff artifact and the
exact resume step, so the reset is one keystroke and loses nothing important.

## When to run it
- A `context-watch` nudge fired ("transcript is large").
- The session feels slow, or you're about to step away.
- You just finished a milestone and the next chunk of work is cleanly separable.
- **Before** you'd otherwise hit auto-compaction — checkpoint on your terms.

## Steps

1. **Resolve the handoff dir** (shared across worktrees via git's common dir, so any
   window writes to the same place):
   ```bash
   PM="$(cd "$(dirname "$(git rev-parse --git-common-dir 2>/dev/null)")" 2>/dev/null && pwd)/.pm"
   mkdir -p "$PM/handoffs"
   ```
   If there is no `.pm` (not a worktree repo), fall back to `./.handoffs/`.

2. **Write the handoff** to a timestamped file AND overwrite `latest.md` (so resume is
   predictable). Keep it tight — this is a continuation prompt, not a diary:

   ```
   # Handoff — <UTC timestamp>  (branch <branch>, main <short-sha>)

   ## Mission (one line)
   <the durable goal — what we're ultimately doing>

   ## State now (ground truth, verifiable)
   - main is at <sha>; CI <green/red>; open PRs: <#n …>
   - <what is merged / deployed / running>
   - <key files touched this session and why>

   ## In flight / next actions (ordered, specific)
   1. <the very next concrete step — a command or a file:line>
   2. <then …>

   ## Open decisions / risks
   - <anything unresolved the next session must not re-litigate or must decide>

   ## Do-not-touch / constraints
   - <frozen contracts, paid actions needing confirmation, lane ownership, etc.>

   ## Resume prompt (paste this after /clear)
   > Continue the <mission>. Read .pm/handoffs/latest.md for full state. Next: <step 1>.
   ```

   Pull state from *reality*, not memory: `git log --oneline -8`, `gh pr list`,
   `git status`, the latest `.pm/inbox/` reports — don't hand-wave the current SHA.

3. **Write both files:**
   ```bash
   TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
   printf '%s\n' "$BODY" | tee "$PM/handoffs/${TS}__handoff.md" > "$PM/handoffs/latest.md"
   echo "handoff → $PM/handoffs/latest.md"
   ```

4. **Tell the user the reset+resume path explicitly**, e.g.:
   > Checkpoint written to `.pm/handoffs/latest.md`. Run **`/clear`** (full reset, fastest)
   > or **`/compact`** (keeps a thread). On the next session the SessionStart hook surfaces
   > this handoff automatically — or paste the **Resume prompt** above. Nothing is lost.

   Recommend `/clear` over `/compact` when the next chunk is cleanly separable (it's
   faster and cheaper); recommend `/compact` when you need conversational continuity.

## Pairs with
- **`context-watch` hook** (`.pm/hooks/context-watch.sh`) — nudges once when the
  transcript crosses a size threshold, so you run this *before* auto-compaction.
- **SessionStart handoff load** — a fresh session prints `latest.md` so resuming is
  read-then-go.
- **`worktree-continuation`** — for resuming a specific *lane's* task vs. the PM session.
