# MEMORY.md

Index only. Keep ≤200 lines / 25 KB. Details live in linked files. Memory is a hint — verify against code.

## How to use

- Do not load this file every session. Open it when a Pattern-Key, path, or user correction matches the task.
- Read a linked lesson only when that match holds.
- After a verified outcome, copy `templates/lesson.md` to `lessons/<domain>/<slug>.md` and index it in LESSONS.md. Unknown domain → `lessons/_unsorted/`.
- After 3 recurrences of one Pattern-Key, copy `templates/pattern.md` to `patterns/<domain>/<key>.md` and propose one AGENTS.md rule (nested if domain-only). Do not write AGENTS.md without approval.
- Daily log: copy `templates/daily.md` to `daily/YYYY-MM-DD.md`.
- When a lesson is wrong, mark it superseded in place or delete it. Do not leave contradictions.

## Project

- Name: chrome-design-interview
- Stack: n/a
- Constraints: n/a

## Lessons

Read [LESSONS.md](LESSONS.md) for verified findings and [DECISIONS.md](DECISIONS.md) for consequential choices. Keep only current task-relevant pointers here; do not duplicate the detailed indexes.

## Patterns

_None yet._

## Do not store

- Secrets, tokens, .env values
- Chat transcripts or daily logs (those belong in `daily/`)
- Commands already in AGENTS.md
- Unverified guesses

<!-- agent-kit:repository-index:begin -->
- [AGENTS.md](AGENTS.md)
- [NOTES.md](NOTES.md)
- [RUNBOOK.md](RUNBOOK.md)
- [STEERS.md](STEERS.md)
- [HISTORY.md](HISTORY.md)
- [LESSONS.md](LESSONS.md)
- [DECISIONS.md](DECISIONS.md)
- [Daily evidence](daily/)
- [Lesson files](lessons/)
- [Patterns](patterns/)
- [Templates](templates/)
<!-- agent-kit:repository-index:end -->
