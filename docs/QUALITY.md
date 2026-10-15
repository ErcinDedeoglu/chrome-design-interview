# Quality contract

Repository: chrome-design-interview (empty repo scaffold, class=empty).
Agent instruction entry file: AGENTS.md. This contract is linked from AGENTS.md and read before structural changes.

This contract codifies the repo-scaffold scaffold constraints and the budgets they enforce. The repo is empty (no product code, no manifest, lockfile, or source), so all product-structure checks are recorded as n/a; the enforced rules govern the scaffold files themselves.

## Budget table (split-review / hard maximum, lines / bytes / words)

| Artifact class | Split review | Hard maximum | Also |
|---|---:|---:|---|
| Root agent entry file (`AGENTS.md`) | 60 lines | 80 lines | 8 KiB, 1,000 words |
| Scoped agent entry file (`memory/AGENTS.md`) | 120 lines | 200 lines | 12 KiB, 1,500 words |
| Memory index (`memory/MEMORY.md`) | n/a | 200 lines / 25 KB | n/a |

## Always-on scaffold rules

1. Root `AGENTS.md` stays ≤80 lines; reaching 60 requires an explicit cohesion review before further growth. [size-hard root entry]
2. `memory/MEMORY.md` stays ≤200 lines / 25 KB. [size-hard memory index]
3. `memory/AGENTS.md` stays ≤200 lines. [size-hard scoped entry]
4. One concern per file; names state domain + role. No generic names (utils, helpers, common, misc, shared) that need opening to explain. [naming]
5. No loose files at repository root beyond tooling-mandated entry files (AGENTS.md, adapters, opencode.json, README.md, .gitignore, docs/, memory/, openspec/, tooling/, .githooks/, .opencode/, .github/). [no-loose-files]
6. Pointers over duplicated prose; never restate linter-enforced rules or README content in AGENTS.md. [pointers]
7. No kit file, AGENTS.md, lesson, or pattern inside a git submodule. No .gitmodules present in this repo; any future submodule is structurally excluded from budgets, baseline, and reviews. [submodules]
8. A claim is true when a command exits green. [verification]
9. Quality contract: docs/QUALITY.md — read before structural changes. [maintenance]

## Exclusions (`.qualityignore`)

No entries. This repo has no generated, vendored, or unchangeable paths to exclude. If an entry is added later it must carry a reason comment and explicit user authorization; ignored paths are re-checked every run and entries that no longer apply are dropped.

## Enforcement wiring

- `tooling/agent-kit/check.sh` checks the agent-file kit (AGENTS.md caps, `## Chain`, memory shape, submodule register, lesson/daily shape).
- `.githooks/check-quality.sh` checks product structure and scaffold constraints codified above, dispatched from `.githooks/commit-gates` in both hook phases.
- Structural rules run in `prepare-commit-msg` too, so `git commit --no-verify` cannot skip them.
- `core.hooksPath=.githooks` is set.
- Hook skips non-regular staged paths and submodule paths.

## Baseline and reviews

- `quality/size-baseline.json`: empty `[]` — no scaffold violations exist at adoption; nothing sealed.
- `quality/cohesion-reviews.json`: empty `[]` — no file is at or above its split-review threshold.

Ratchet: baseline entries are shrink-only and never regenerated to bless growth. No baseline entry may be inside a git submodule.

## Rules marked enforced-by-review

None — every codified rule above is hook-enforced by `check-quality.sh` or `check.sh`.
