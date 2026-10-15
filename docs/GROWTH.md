# Growth contract

Split by **domain** (bounded context), then by **concern**. Date splits and technical layers (`controllers/`, `services/`, `utils/`) are never domains. Crowd decides **when** a folder earns its own file; the domain decides **what goes in it**.

Read before adding a root rule, lesson, spec, or path-scoped rule. Product-tree SoC: `docs/QUALITY.md` (or the `repo-scaffold` quality phase). This file owns **agent-file** growth only.

`AGENTS.md` is the portable instruction file. Every coding agent should read it. Harness-specific files are adapters, not a second source of truth.

## Target shape

```text
AGENTS.md                                 # global defaults only
<product>/<domain>/AGENTS.md              # delta: commands/boundaries that differ
memory/MEMORY.md                          # one-line index
memory/lessons/<domain>/<slug>.md
memory/patterns/<domain>/<key>.md
openspec/specs/<domain>/
docs/QUALITY.md
docs/GROWTH.md
```

`<product>/` keeps the stack name (`src/`, `app/`, `packages/`). `<domain>/` is a bounded context, not a layer.

Adapters (`CLAUDE.md`, `GEMINI.md`) exist **only at the repo root**, and only as a pointer to `AGENTS.md`. Never add one beside a nested `AGENTS.md`. Nested instruction lives in that folder's `AGENTS.md`.

<!-- agent-kit:chain:begin -->
## Chain gate

The commit script decides. A product folder needs its own `AGENTS.md` when it has **8 or more direct product entries** (files in that folder, plus immediate subfolders that contain product files). Crowd threshold is 8. Editing this file does not raise it. `trivial.md` does not skip it. There is no opt-out.

**Better to have the file than not.** At the threshold, write it even when the delta is one line — "run artifacts are generated, never hand-edit" is a real rule that belongs in that folder and nowhere else. The failure is an empty or copied file, not the file itself.

Count only product entries. Do not count `AGENTS.md`, kit dirs (`docs/`, `memory/`, `openspec/`, `tooling/`), submodules, or generated dirs (`node_modules`, `dist`, `build`). A folder below 8 is covered by the nearest ancestor `AGENTS.md`. A deep folder at 8 is not excused because some parent already has a file.

Every `AGENTS.md` has a `## Chain` section. Closest file still wins; the chain is how files find each other.
Explicit documentation and mapped sidecar AGENTS files join the chain without making their records product crowding. Child-owned AGENTS files stay outside the superproject chain.

```text
## Chain

- Up: (root)
- Down: `src/AGENTS.md`
```

- Root Up is exactly `(root)`. Nested Up is a backtick path to the nearest ancestor `AGENTS.md` (skip folders that are under the threshold and have no file of their own).
- Down is one backtick path per chain child, or exactly `- Down: (none)`. No other lines.
- A chain child is a folder that already has `AGENTS.md`, or a folder at the crowd threshold. Parent lists those children. Child points up. Extra or missing links fail the commit.

`.githooks/commit-gates` runs the chain gate in the `prepare-commit-msg` phase, which `git commit --no-verify` cannot skip, and rejects a forgotten file, a broken up/down link, or a `CLAUDE.md` anywhere but the repo root. Quality gates are dispatched by the same file. Re-run repo-scaffold init on an existing repo so the script and the hooks are installed.
<!-- agent-kit:chain:end -->

## Vendored growth — submodules

A git submodule is a **foreign repository**, not a domain. It is never product growth.

- Never create `AGENTS.md`, a lesson, or any kit file inside a submodule path. The checker fails the commit. An OpenCode plugin blocks the write only when `tooling/agent-kit/INSTALL.md` says that plugin is active.
- Knowledge about a submodule lives in the superproject: `docs/SUBMODULES.md` plus mapped sidecars holding AGENTS / MEMORY / LESSONS / DECISIONS / NOTES / RUNBOOK / STEERS / HISTORY and daily logs. The committed mapping preserves existing folders; default `docs/submodules/<slug>/`.
- Need behavior to change inside one? Bump the pinned commit, wrap it at your boundary, or file it upstream. Never a local edit.
- Regenerate the register with `tooling/agent-kit/submodules.sh` after any pointer bump, and re-stamp a sidecar you re-read with `--review <path>`.
- Existing drift warns. A new/bumped pointer requires changed daily evidence, current NOTES/MEMORY and reviewed distillation; the staged knowledge gate rejects omissions in both commit phases.

Detail: `docs/SUBMODULES.md`.

## Triggers — split that class now

| Artifact | Split when |
|----------|------------|
| Root `AGENTS.md` | ≥60 lines, **or** a rule applies to only one domain |
| Nested `AGENTS.md` | Direct product entries ≥ 8, or that folder already has `AGENTS.md` |
| `memory/lessons/` | 3+ lessons share one domain |
| `openspec/specs/` | A capability belongs to one domain |
| `docs/submodules/<slug>/` | A submodule needs integration notes (never inside it) |
| Product file | Two concerns or over budget → `docs/QUALITY.md`, not this file |

If root is long from duplication, **delete first**. Nesting is not a filing cabinet.

After any split or new lesson/pattern/daily file, run `tooling/agent-kit/check.sh`. A red check is a failed change.

## How — AGENTS.md

1. Root keeps repo-wide commands, global Never, and pointers.
2. Move domain-only rules into `<product>/<domain>/AGENTS.md` as a **delta** — do not copy root. Add `## Chain`: Up to the nearest ancestor, Down to each chain child.
3. Closest `AGENTS.md` wins. User prompt overrides files. The chain still has to connect; a closer file that is not linked is a broken commit.
4. File-type conventions that differ by directory belong in that nested `AGENTS.md`, not in a vendor rules folder.

## How — memory

1. Copy `memory/templates/lesson.md` → `memory/lessons/<domain>/<slug>.md`. Unknown domain → `memory/lessons/_unsorted/<slug>.md`, sort within a week.
2. Index: `- [slug](lessons/<domain>/<slug>.md) — <domain>/<pattern-key> — one line`
3. Never chronological names. Never one growing `lessons.md`.

## How — specs

`openspec/specs/<domain>/`. Changes stay `openspec/changes/<name>/`.

## SoC ladder

| Level | Splits | Wrong |
|-------|--------|-------|
| Repo | domains | one AGENTS.md owns every package CLI |
| Domain | concepts | billing lesson under `auth/` |
| File | one concern | lesson file is a week of chat |
| Nested AGENTS.md | one domain’s delta | restating root, or a vendor-only rules dump |

## Huge repos

- Hot layer (root AGENTS.md) stays ≤80 lines. Cold files load on demand.
- Do not pre-create nested files below the crowd threshold. At 8 direct product entries, add `AGENTS.md` and link it before more files.
- Large monorepos nest AGENTS.md per package because commands differ — not to store essays.

## Never

- Nested AGENTS.md that restates root, or a threshold-triggered file that adds no rule of its own
- A crowded folder with no `AGENTS.md`, or a `## Chain` link that skips a required parent or child
- Treating `git commit --no-verify` as a way past the chain gate
- A `CLAUDE.md` or `GEMINI.md` anywhere but the repo root (root adapters point at `AGENTS.md` and carry no rules)
- A second instruction body in a vendor file (keep root adapters as pointers/symlinks)
- Chronological memory filenames
- `utils`, `helpers`, `common`, `misc` as domain names
- Split by date, `part-2` suffixes, or a layer named after a framework
- Auto-write root AGENTS.md without user approval
- Any kit file inside a git submodule; treating a submodule as a domain
