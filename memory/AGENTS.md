# Repository knowledge

## Chain

- Up: `../AGENTS.md`
- Down: (none)

## Scope

This directory carries knowledge about the repository the agent is working on,
including shared decisions across integrations. Submodule-specific evidence belongs
in its mapped sidecar; link it rather than duplicating it here.

## Maintenance

- Read MEMORY and matching records before relevant work; verify claims against code.
- Capture work, checks, uncertainty, and blockers in `daily/YYYY-MM-DD.md` as they occur.
- Distill verified lessons into `lessons/<domain>/<slug>.md`; LESSONS is their index.
- Record decisions with rationale, alternatives, authority, and evidence in DECISIONS.
- Refresh NOTES for changed facts and RUNBOOK for executed procedures and recovery.
- Capture user corrections and confirmations verbatim in STEERS with date and scope.
- Update HISTORY only after an explicit history dig, citing commits and the revision read.
- Before handoff, refresh MEMORY and review LESSONS/DECISIONS. If unchanged, record
  `Memory: reviewed; unchanged.`, `Lessons: reviewed; no new lessons.`, and
  `Decisions: reviewed; no new decisions.` in today's changed log when accurate.
- Prefix new daily evidence and review-marker bullets with branch/revision tags;
  only newly added current-checkout review markers count, not old declarations.
- Never fabricate findings, verified commands, code reviews, or historical evidence.
- Keep records focused; split by domain/concern and link details instead of growing indexes.
- Run `python3 tooling/agent-kit/knowledge-check.py --index` before committing.

## Authority

Memory is evidence to recheck, not a second instruction hierarchy. Root instructions
govern product work. Propose recurring lessons as scoped rules only with user approval.

<!-- agent-kit:repository-index:begin -->
- [NOTES.md](NOTES.md)
- [RUNBOOK.md](RUNBOOK.md)
- [STEERS.md](STEERS.md)
- [HISTORY.md](HISTORY.md)
- [MEMORY.md](MEMORY.md)
- [LESSONS.md](LESSONS.md)
- [DECISIONS.md](DECISIONS.md)
- [Daily evidence](daily/)
- [Lesson files](lessons/)
- [Patterns](patterns/)
- [Templates](templates/)
<!-- agent-kit:repository-index:end -->

<!-- agent-kit:context-policy:begin -->
<!-- agent-kit:context-policy:v1 -->
<!-- agent-kit:entry-tags:v1 -->
## Evidence scope

Before writing knowledge, record checkout context using
`python3 tooling/agent-kit/knowledge_context.py .` (add `--project <id>` or `--module <path>` for the owner).
Append its context block to today's evidence; it prints only, never edits records.
Keep a separate block per session/revision. New or revised lesson/pattern bodies
also carry a context block. Entries in NOTES/RUNBOOK/DECISIONS/STEERS/HISTORY cite
their owning daily context or include their own block; indexes retain scope labels.
Default: checkout-scoped, verification not recorded, integration unknown, deployment unknown.
Describe checks actually observed in Verification; tests, commits, review stamps and
branch names do not establish a merge or deployment. Target stays unknown unless
the user or repository evidence identifies it; a remote default is only a candidate.
Integration is unknown | not-merged | merged. A merged claim requires an explicit
Target ref and Integration-evidence commit reachable from that ref; inspect the
target content too (squash/cherry-pick may change SHAs). This is local-ref evidence,
not proof the remote is current, the feature is present, or production was deployed.
Deployment claims require separate environment/release evidence, never ancestry alone.
Child-revision is the child snapshot reviewed, not proof of upstream or parent-trunk
integration. Integration/Target in this block refer to the parent repository.
Record child-upstream claims separately with repository/ref/evidence.
Legacy records lacking context have unknown scope/integration; preserve, then recheck
before reuse. Do not rewrite history or assume records copied across branches apply.
Scope reusable requires a reason in the evidence body; feature-specific facts remain
checkout-scoped until applicability is rechecked. Approval/promotion does not merge code.
Prefix new daily bullets (including review markers) with branch/revision tags from
`knowledge_context.py . --entry-tag`. Storage is per project/date, never per session
or branch. Coordinate/serialize same-project log and index writes; append-only prose
does not prevent concurrent lost updates. Re-read the file before modifying it.
<!-- agent-kit:context-policy:end -->
