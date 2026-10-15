<!--
RUNBOOK.md — {{SUBMODULE_NAME}}. Agent-readable.
OWNS: VERIFIED commands for building, running or upgrading this submodule.
Truth rule: every command here was EXECUTED and OBSERVED to work on a real
machine. Never paste from a README unverified. Anything not yet verified is
labelled UNVERIFIED and stays labelled until someone runs it.
Not here: facts (NOTES.md), steers (STEERS.md), history (HISTORY.md).
Update trigger: when run/upgrade mechanics are first verified or change.
-->

# RUNBOOK — {{SUBMODULE_NAME}}

Path: `{{SUBMODULE_PATH}}` — foreign repo. These commands READ it or move its
pointer. None of them edit its tracked files.

Mark every row `verified <YYYY-MM-DD>` or `UNVERIFIED`. An unverified row is
allowed to exist — a wrong row that looks verified is not.

## Upgrade

| Step | Command | Status |
|------|---------|--------|
| See what upstream has | `git -C {{SUBMODULE_PATH}} fetch --tags` | UNVERIFIED |
| Read the diff first | `git -C {{SUBMODULE_PATH}} log --oneline HEAD..<target>` | UNVERIFIED |
| Move the pointer | `git -C {{SUBMODULE_PATH}} checkout <sha-or-tag>` | UNVERIFIED |
| Record it | `tooling/agent-kit/submodules.sh` then commit the gitlink | UNVERIFIED |
| Verify our side still builds | n/a | UNVERIFIED |

## Build / test it standalone

_Only if we ever need to. Its own CI is authoritative, not our guess._

| Step | Command | Status |
|------|---------|--------|
| n/a | n/a | UNVERIFIED |

## Rollback

| Step | Command | Status |
|------|---------|--------|
| Restore previous pointer | `git -C {{SUBMODULE_PATH}} checkout <old-sha>` | UNVERIFIED |
