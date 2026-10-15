# Agent kit install report

Agent kit is the operating-file gate for agent instructions, memory, growth, and git submodules. It is not a requirement of the product this repository builds.

Installed by: repo-scaffold
Components: agent kit and repository quality

repo-scaffold owns this kit and the quality phase that codifies `docs/QUALITY.md` and generates `.githooks/check-quality.sh`. The mechanical init only seeds a quality stub when the contract is missing; full setup also requires the quality phase and its enforcement proof.

## OpenCode plugin

What it is: an optional OpenCode integration that can reject some writes before the tool returns. It is not the commit gate.

Choice: requested with --with-opencode-plugin.
File: present at .opencode/plugins/agent-kit.js
plugin-activation: active
opencode: opencode v2.0.29
plugin-id: agent-kit
plugin-state: active
plugin-path: /Users/ercin/git/github/ercindedeoglu/chrome-design-interview/.opencode/plugins/agent-kit.js
plugin-error: 

If you remove it: Write-time blocking inside OpenCode: a write or edit under a git submodule is rejected before the tool returns, and a product write that fails the chain guard is rejected the same way. check.sh also runs after those writes. You do not lose commit-time enforcement. That stays in the git hooks named below.

File presence is not activation. Re-run `tooling/agent-kit/probe-plugin.sh` against the `opencode` binary on PATH. An already-open session does not reload a plugin until that location is restarted.

## Responsible

responsible: repo-scaffold tooling/agent-kit/agents-chain.py — commit chain gate
responsible: repo-scaffold tooling/agent-kit/check.sh — kit check
responsible: repo-scaffold .githooks/check-quality.sh — quality rules, only if that file exists
responsible: repo-scaffold .opencode/plugins/agent-kit.js — write-time block, only when plugin-activation is active

## What you still have if the plugin is gone

These fire without OpenCode. The dispatcher is `.githooks/commit-gates`, owned by repo-scaffold. Both entry hooks are the same bytes, so refreshing the kit preserves the quality checker.

| Protection | Responsible | Fires when |
|---|---|---|
| Crowded-folder and `## Chain` links. `git commit --no-verify` does not skip this. | repo-scaffold `tooling/agent-kit/agents-chain.py` | `prepare-commit-msg` |
| Kit shape: AGENTS.md caps, memory files, submodule register, dirty submodule, lesson shape. | repo-scaffold `tooling/agent-kit/check.sh` | `pre-commit` |
| Quality rules codified in `docs/QUALITY.md` (size, loose files, naming). Absent until the quality phase generates the checker. Skipped when the file is missing; never replaces the rows above. | repo-scaffold `.githooks/check-quality.sh` | both hook phases, only if that file exists |

## Components installed by repo-scaffold

| Path | Why it is here | If you remove it |
|---|---|---|
| `AGENTS.md` | Thin operating index. Not a product spec. | Agents lose the command and boundary index. |
| `docs/GROWTH.md` | When a folder earns its own AGENTS.md. | The chain gate loses the contract it points at. |
| `docs/QUALITY.md` | Init seeds a stub; the quality phase writes the real contract, or preserves an existing one. | Quality rules lose their canonical contract. A stub alone enforces nothing. |
| `docs/SUBMODULES.md` | Register of foreign repos. Not product code. | Submodule boundary notes disappear. The checker then fails a repo that has submodules. |
| `memory/` | Repository AGENTS/MEMORY/LESSONS/DECISIONS/NOTES/RUNBOOK/STEERS/HISTORY, domain lesson/pattern files, templates and daily evidence. Missing records are seeded without inventing findings. | The repository loses its durable knowledge and review trail; the knowledge gate rejects missing records. |
| `tooling/agent-kit/knowledge-check.py` | Checks repository and sidecar records, links and changed daily/distillation evidence in the exact staged snapshot. Runs in both hook phases. | Recorded knowledge maintenance is no longer checked at commit time. |
| `tooling/agent-kit/knowledge_context.py` | Prints parent checkout/child snapshot context; validates scoped evidence and locally supported integration claims. Verification does not imply merge or deployment. | Knowledge loses explicit provenance capture; the knowledge gate depends on this helper. |
| `tooling/agent-kit/project_layout.py` and `project_knowledge.py` | Routes explicit projects.json source ownership to per-project records/date logs; checks owner context and branch/revision tags. No per-session directories or automatic write lock. | Project-specific evidence routing and maintenance checks are lost. |
| `tooling/agent-kit/check.sh` | Deterministic kit check. | Pre-commit no longer rejects a broken kit. The chain gate still runs. |
| `tooling/agent-kit/agents-chain.py` | Crowded-folder and up/down chain gate. | `--no-verify` no longer blocks a broken chain. |
| `tooling/agent-kit/submodules.sh` | Regenerates the submodule register. | The register goes stale. The checker does not fix it for you. |
| `tooling/agent-kit/probe-plugin.sh` | Asks the installed OpenCode whether the plugin is active. | You can no longer tell activation from file presence. |
| `.githooks/commit-gates` | Runs both installed component checkers. | Both the kit gate and the quality gate stop firing. |
| `.githooks/pre-commit` and `prepare-commit-msg` | Identical entry bytes. They own no rules. | Hooks no longer reach the dispatcher. |
| `opencode.json` | Tells OpenCode to load `docs/GROWTH.md`. Not a gate. | OpenCode stops injecting that file. Commit gates are unchanged. |
| `.opencode/plugins/agent-kit.js` | Optional. See the plugin section above. | See "If you remove it" above. |

## Boundary

The agent-kit checker checks agent files: chain links, kit completeness, memory shape, submodule register and dirtiness. It does not enforce product size budgets or naming.

The quality checker checks product structure against `docs/QUALITY.md`: size budgets, loose files, naming, and the other rules that contract marks hook-enforced. It does not check AGENTS.md chain links, lesson shape, or kit file presence. Both checkers belong to repo-scaffold. The optional OpenCode plugin is separate from both.

Overlap is the submodule boundary (different checks) and the shared dispatcher (same entry bytes, separate checker files). One checker missing does not turn the other off.
