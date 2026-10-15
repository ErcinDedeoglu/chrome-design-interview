# {{DATE}}

Append-only raw log. Do not load into AGENTS.md. Distill into `lessons/` only after verification.

Append checkout context from `knowledge_context.py` per session/revision (sidecar:
`--module <path>`; project: `--project <id>`). Tag each new bullet with branch/revision
from `knowledge_context.py . --entry-tag`. Describe working/index changes and actual checks; unknown merge
intent stays unknown. Local verification does not establish merge or deployment.
Use the owning project/date file, not a session-ID or branch directory. Serialize
same-project/shared-file writes and re-read current content before changing it.

- 
