# {{SLUG}}

- **Domain:** {{DOMAIN}}
- **Date:** {{DATE}}
- **Pattern-Key:** {{PATTERN_KEY}}
- **Confidence:** low | medium | high
- **Evidence:** {{EVIDENCE_PATH_OR_COMMAND}}
- **Status:** active | superseded by {{OTHER}}

Paste a context block from `python3 tooling/agent-kit/knowledge_context.py .` here
(project-owned: add `--project <id>`; store in that project's lessons directory).
Active means active within that scope, not merged/deployed. Explain reusable scope
if independent of the branch; otherwise retain checkout scope.

## Situation

What was happening.

## Decision

What was chosen. Name rejected alternatives in one line.

## Reasoning

Why this path. Cite a file or command, not a vibe.

If this came from the user steering you, quote them **verbatim** here with the
date. A paraphrase loses the reasoning and the rule gets re-litigated later.

> user, YYYY-MM-DD: "<their exact words>"

## Outcome

What actually happened after verification.

## Lesson

One imperative the next agent can apply.
