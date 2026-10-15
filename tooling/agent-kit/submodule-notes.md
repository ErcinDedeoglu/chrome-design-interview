<!--
NOTES.md — {{SUBMODULE_NAME}}. Agent-readable. Terse, factual.
OWNS: what this foreign repo IS and how we consume it.
Not here: verified run commands (RUNBOOK.md), user direction (STEERS.md),
mined git history (HISTORY.md), the pinned sha (docs/SUBMODULES.md).
Update trigger: whenever you learn something from its code.
-->

# {{SUBMODULE_NAME}}

Path: `{{SUBMODULE_PATH}}` — **foreign repo. Read-only. Never edit in place.**

<!-- agent-kit:reviewed-at: unreviewed -->

The stamp above is the submodule sha these notes were last verified against.
It establishes no upstream merge, parent-trunk adoption or deployment. Scope each
finding to parent checkout/child revision via context or its daily-session citation.
Update it in the same commit you update these notes:
`tooling/agent-kit/submodules.sh --review {{SUBMODULE_PATH}}`

## Provides

_One or two lines. What we depend on it for._

## Consumed by

| Our module | How |
|------------|-----|
| n/a | n/a |

## Gotchas

_Non-obvious behaviour that cost time. Cite a file or a command, not a vibe._

## If we need a change inside it

Pick one and record which: (a) bump to a version that has it, (b) wrap at our
boundary, (c) file upstream. Never a local edit — it vanishes on the next bump.
