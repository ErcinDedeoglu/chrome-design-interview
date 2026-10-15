# Execution contract

<!-- agent-kit:execution:begin -->
## Session-driven work

Read this before builds, test suites, executable proof/review loops,
uploads/downloads, migrations, training, batch campaigns, or background or
uncertain-duration work. On OpenCode, load `background-work` once before
launching; reading its pointer is not loading it. The skill owns the detailed
background procedure. This contract grants no new tool or goal permissions.

- Default to background. Foreground is only for proven-short, bounded checks
  — including parallel quick tool calls — and test/build commands already
  observed to finish in seconds. For anything substantial, uncertain-duration,
  never-observed-fast, or parallelizable, use `shell(background=true)` with an
  explicit `timeout` in milliseconds — background commands have no default
  timeout — or a background subagent for context-heavy work. Size timeouts to
  expected runtime with reasonable headroom. Split independent units across jobs
  in the same turn instead of running them as sequential foreground calls.
  Never end a turn with a required long job still running foreground, and never
  use a blocking call as an idle-wait: background the job and end the turn.
  Never use detached `nohup ... &`, shell `&`, or sleep-then-check
  loops to wait for completion. Choose the route from expected runtime and
  evidence, not the default shell timeout; waiting longer in the foreground
  is not a substitute for notified execution.
- Launch independent jobs in the same turn, within safe resource limits; jobs
  sharing mutable outputs or needing another job's result are not independent.
  Do other independent work immediately — starting with preparing the next
  queued topic (read its files, draft its plan, stage its inputs) so it can
  launch when capacity frees. When none remains, end the turn — but
  pause an active goal first (see the Goals rule). An active goal's
  auto-continue cannot see a running job, so an unpaused goal spends turns
  waiting for you. Completion notifications — on success or timeout — not
  idle tool calls, are the signal that work landed; a notice arriving late or
  in a batch is normal, not a malfunction. A foreground sleep cannot receive
  the completion signal, so it can only make the wait longer; never sleep in
  place of an exit. One read of a job's output file mid-run is allowed when it
  enables work now; repeated reads are polling.
- Check the launch result includes the background id and the output path it
  streams to. If the host reports no completion notification mechanism, report
  the blocker and do not wait on that job. If background tools are absent, use
  only a host-supported notified background route with a finite timeout; if
  none exists, report the blocker.
- Treat the completion notification as evidence, not proof of task
  correctness. Verify required artifacts/assertions. "Timed out before
  completion" or a killed command is failure even if output was printed;
  inspect status/logs to diagnose it. Reading the output file fetches evidence
  or diagnoses, never asks whether a job is done.
- For multi-hour or hang-prone jobs, arm one alarm job beside the work:
  `sleep N; echo recheck` with `background=true` and a `timeout` greater than
  N. Choose N from expected pace/risk (minutes, not seconds). Its notification
  schedules one bounded health check of pace, logs, and resource pressure; it
  is not the job's completion notice. Then re-arm once or intervene. Never
  build a rapid alarm loop. There is no tool to kill or list background jobs:
  bounded work carries a timeout, and a runaway command is stopped from a
  foreground shell with `pkill` after any needed evidence is collected.
- Long-lived servers/watchers/tunnels the user asked for run in the background
  without a timeout; report the output path. Bounded readiness checks against
  a live server are the only shell-sleep exception; never use them to poll job
  completion. If the OpenCode server restarts, background shells are cancelled
  and must be rerun; background subagents are resumed automatically.
- Goals: when a required job is running and no independent work remains, pause
  an active goal as the last call, then end the turn. That wait pause is what
  stops the no-op auto-continuations, because the goal plugin's auto-continue
  cannot see a running job. Say in the same turn that it is a wait pause,
  never a user pause. A completion notice still wakes a paused session: call
  `status="active"` first, then verify artifacts. An alarm wake alone does not
  complete the job and never justifies resuming the goal. On hosts whose
  delivery reliably wakes idle parents holding pending notified work, ending
  the turn is also sufficient — but never leave an active goal to idle-wait on
  a job. Never auto-resume a pause the user made. If goal tools require
  explicit user permission, obtain it rather than override the tool contract.
  Do not close a goal while required jobs run.

The kit checker verifies this contract and its root pointer are installed;
it cannot prove runtime behavior. Report unavailable tools or notification
routing honestly. Do not claim a capability is active from file presence.
<!-- agent-kit:execution:end -->
