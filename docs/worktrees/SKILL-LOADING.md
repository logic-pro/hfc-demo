# Claude skill loading — where skills live & how to fix discovery

Hard-won notes from this repo. Claude Code discovers skills at **session start**
from a few roots; a skill added mid-session or placed in a *nested* repo may not be
seen until a reload.

## Where to put a skill
| Goal | Location |
|---|---|
| Ships with the repo (version-controlled, portable) | `hfc-demo/.claude/skills/<skill>/SKILL.md` |
| Available in every session / any project (current user) | `~/.claude/skills/<skill>/SKILL.md` |

For the worktree/PM suite we keep **both**: the repo copy ships; the global copy
guarantees it loads even when the active workspace root is the umbrella
(`interview-workspace` / `hfc-workspace`) rather than `hfc-demo`. We removed the
redundant `interview-workspace/.claude/skills` mirror (it caused double-listing).

## Why a skill sometimes "isn't found"
The session's **project root** drives project-skill discovery. If you opened the
**umbrella** (`hfc-workspace`/`interview-workspace`) — which has no `.claude/skills`
— a skill sitting in the *nested* `hfc-demo/.claude/skills/` may load at startup but
**`/reload-skills` won't re-scan that nested path**. The global `~/.claude/skills/`
copy is what makes it reliable in that case.

## If Claude doesn't see a skill — in order
1. `/reload-skills`
2. `/skills` (is it listed?)
3. Reload the VS Code window (Command Palette → **Developer: Reload Window**)
4. Verify the active workspace root — nested-repo `.claude/skills` may not be scanned; put a copy in `~/.claude/skills/`
5. Check the file is exactly `SKILL.md` with valid YAML frontmatter (`name:` optional → defaults to dir name; `description:` required)

## Invocation
A skill at `<root>/.claude/skills/<dir>/SKILL.md` is callable as `/<dir>` and is
also model-auto-invoked when a request matches its `description`. A new top-level
`.claude/skills/` dir created mid-session needs a restart to be watched.

## Keeping copies in sync
When editing a skill, update all of its copies (repo + global). We verify with
`md5sum` across roots. Double-listing in the menu = the same skill in two scanned
roots; de-dup by removing the extra mirror.
