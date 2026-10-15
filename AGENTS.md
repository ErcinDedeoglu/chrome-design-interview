# AGENTS.md

**Precedence:** closest `AGENTS.md` wins. Explicit user prompts override files.

## Chain

- Up: (root)
- Down: `memory/AGENTS.md`

## Commands

| Task | Command |
|------|---------|
| Install | n/a |
| Dev | n/a |
| Test | n/a |
| Lint | n/a |
| Typecheck | n/a |
| Build | n/a |
| Agent kit | `tooling/agent-kit/check.sh` |

Leave `n/a` until the command exists and has been run once. Never guess. Agent kit is not `n/a`.

## Pointers

| Need | Read |
|------|------|
| Quality | `docs/QUALITY.md` |
| Install report | `tooling/agent-kit/INSTALL.md` |
| Growth | `docs/GROWTH.md` |
| Submodules | `docs/SUBMODULES.md` |
| Repository knowledge | `memory/AGENTS.md` → `memory/MEMORY.md` |
| Templates | `memory/templates/` |
| Lessons | `memory/lessons/` |
| Specs | `openspec/specs/` |
| Active change | `openspec/changes/` |

## MUST

These are gates, not suggestions. Git pre-commit and prepare-commit-msg enforce 1–2. `--no-verify` does not skip the chain gate. The OpenCode plugin enforces them only when `tooling/agent-kit/INSTALL.md` says it is active.

1. A product folder at the crowd threshold has its own `AGENTS.md` before more files there. `## Chain` links up to the parent and down to each child.
2. `tooling/agent-kit/check.sh` green before claiming done (paste output). Then read `tooling/agent-kit/STATUS.md`. Red = not done.
3. Owned-repo work → `memory/AGENTS.md`; integration work → mapped sidecar AGENTS/MEMORY in `docs/SUBMODULES.md`. Capture daily evidence; distill LESSONS/DECISIONS/MEMORY before handoff in the owning scope.
4. Read `docs/GROWTH.md` before adding a root-level folder.
5. Never write inside a git submodule — it is a foreign repo. Work in the superproject; see `docs/SUBMODULES.md`.

<!-- agent-kit:execution:begin -->
6. Before execution-heavy work, read `docs/EXECUTION.md`; on OpenCode load `background-work` once. Default to background: foreground only for proven-short checks; substantial, uncertain, or parallelizable jobs use background shells or subagents with explicit timeouts. Split independent units across jobs in the same turn; never end a turn with a required long job running foreground, never detach or poll completion. Before an idle wait on a required job, pause an active goal as the last call and resume it on the completion notification.
<!-- agent-kit:execution:end -->

## Boundaries

### Ask first
- New dependencies
- Public API, schema, or migration changes
- CI, secrets, production, force-push
- Promoting a lesson into this file
- Adding, removing, or bumping a submodule

### Never
- Commit secrets or `.env`
- Edit inside a submodule, generated, or vendored tree
- Duplicate docs into this file
- Auto-write rules here without user approval

## Memory loop

1. Capture → owning project/sidecar `daily/YYYY-MM-DD.md`; root daily for shared/self-contained work. Tag new entries by branch/revision; coordinate shared writes. No session-ID directories.
2. Distill → owning scoped LESSONS/DECISIONS/MEMORY; follow its evidence-scope policy. Verification ≠ merge/deployment. Refresh NOTES/RUNBOOK, quote STEERS; HISTORY is explicit-dig only. Bodies: `memory/lessons/<domain>/`.
3. After 3 recurrences of one Pattern-Key → copy `memory/templates/pattern.md`; propose one rule here; wait for approval
4. Prune stale entries; stale is worse than missing

Quality contract: `docs/QUALITY.md` — read before structural changes.
Growth contract: `docs/GROWTH.md` — crowd threshold is 8; `## Chain` links up and down.
