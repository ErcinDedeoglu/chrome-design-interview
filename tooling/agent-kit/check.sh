#!/usr/bin/env bash
# Deterministic agent-kit checker. Copied into the target repo.
# Fail closed. No network. No LLM.

set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1

NO_WRITE=0
[[ "${AGENT_KIT_NO_WRITE:-}" == "1" ]] && NO_WRITE=1
ARGS=()
for a in "$@"; do
  if [[ "$a" == "--no-write" ]]; then
    NO_WRITE=1
  else
    ARGS+=("$a")
  fi
done
ROOT=$(cd "${ARGS[0]:-.}" && pwd)
fail=0

# When invoked from a git hook, GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE point at
# the superproject and leak into `git -C <submodule>` calls, silently breaking
# submodule gates. Drop them; ROOT is already resolved.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX

err() { echo "fail: $*" >&2; fail=1; }
ok() { echo "ok: $*"; }
# warn: real but non-blocking. Stale vendored notes mean "re-read before you
# trust this", not "the repo is broken" — blocking would train people to bypass
# the gate. Counted and re-surfaced in STEER so it cannot be silently ignored.
warns=0
WARN_LINES=()
warn() { echo "warn: $*"; warns=$((warns+1)); WARN_LINES+=("$*"); }
# note: a fact with a caveat attached; never a verdict.
note() { echo "note: $*"; }

need() {
  if [[ -e "$ROOT/$1" ]]; then ok "exists $1"; else err "missing $1"; fi
}

lines() { wc -l <"$1" | tr -d ' '; }

is_forbidden_domain() {
  case "$1" in
    utils|helpers|common|misc|shared) return 0 ;;
    *) return 1 ;;
  esac
}

# ---- submodules: foreign repos. Scaffold around them, never inside. ----
# Source of truth is .gitmodules (committed, readable even when uninitialized).
SUBMODULE_PATHS=()
if [[ -f "$ROOT/.gitmodules" ]]; then
  while IFS= read -r sm; do
    [[ -n "$sm" ]] && SUBMODULE_PATHS+=("${sm%/}")
  done < <(git -C "$ROOT" config -f .gitmodules --get-regexp '^submodule\..*\.path$' 2>/dev/null | cut -d' ' -f2-)
fi
HAS_SUBMODULES=0
((${#SUBMODULE_PATHS[@]})) && HAS_SUBMODULES=1

# True when $1 (repo-relative path) is a submodule root or lives under one.
in_submodule() {
  local p=${1#./}
  p=${p%/}
  local sm
  for sm in "${SUBMODULE_PATHS[@]+"${SUBMODULE_PATHS[@]}"}"; do
    [[ "$p" == "$sm" || "$p" == "$sm"/* ]] && return 0
  done
  return 1
}

# Absolute-path variant for find(1) results.
abs_in_submodule() {
  local p=${1#"$ROOT"/}
  [[ "$p" == "$1" ]] && return 1
  in_submodule "$p"
}

# find(1) prune args so no walk ever descends into a foreign repo.
SM_PRUNE=()
for sm in "${SUBMODULE_PATHS[@]+"${SUBMODULE_PATHS[@]}"}"; do
  SM_PRUNE+=(-path "$ROOT/$sm" -prune -o)
done
KNOWLEDGE_PATHS=()
while IFS= read -r sc; do
  [[ -n "$sc" ]] && KNOWLEDGE_PATHS+=("$sc")
done < <(python3 - "$ROOT" "$(cd "$(dirname "$0")" && pwd)" <<'PY'
import sys
sys.path.insert(0, sys.argv[2])
from knowledge_layout import Tree, resolve
from project_layout import load
try:
    tree = Tree(sys.argv[1])
    sidecars = resolve(tree)["sidecars"]
    print("\n".join([*sidecars.values(), *(p["memory"] for p in load(tree, sidecars).values())]))
except (ValueError, OSError, TypeError):
    pass  # The mandatory knowledge gate reports the error below.
PY
)
KNOWLEDGE_PRUNE=()
for sc in "${KNOWLEDGE_PATHS[@]+"${KNOWLEDGE_PATHS[@]}"}"; do
  KNOWLEDGE_PRUNE+=(-path "$ROOT/$sc" -prune -o)
done
in_knowledge() {
  local sc
  for sc in "${KNOWLEDGE_PATHS[@]+"${KNOWLEDGE_PATHS[@]}"}"; do
    [[ "$1" == "$sc" || "$1" == "$sc"/* ]] && return 0
  done
  return 1
}

need AGENTS.md
need docs/QUALITY.md
need docs/GROWTH.md
need docs/EXECUTION.md
need docs/SUBMODULES.md
need memory/MEMORY.md
need memory/DECISIONS.md
for record in AGENTS LESSONS NOTES RUNBOOK STEERS HISTORY; do
  need "memory/$record.md"
done
need memory/templates/lesson.md
need memory/templates/pattern.md
need memory/templates/daily.md
need memory/lessons
need memory/patterns
need memory/daily

if [[ -f "$ROOT/AGENTS.md" ]]; then
  n=$(lines "$ROOT/AGENTS.md")
  if (( n > 80 )); then err "root AGENTS.md has $n lines (max 80)"; else ok "root AGENTS.md $n lines"; fi
  if grep -qE '^## Architecture' "$ROOT/AGENTS.md"; then
    err "root AGENTS.md has ## Architecture (Context Bloat)"
  else
    ok "root AGENTS.md has no architecture heading"
  fi
  if grep -q 'memory/templates/' "$ROOT/AGENTS.md" && grep -q 'docs/GROWTH.md' "$ROOT/AGENTS.md"; then
    ok "root AGENTS.md points at templates and GROWTH.md"
  else
    err "root AGENTS.md missing templates or GROWTH.md pointer"
  fi
  if grep -q 'docs/EXECUTION.md' "$ROOT/AGENTS.md" && grep -q 'background-work' "$ROOT/AGENTS.md"; then
    ok "root AGENTS.md points at execution contract and background-work"
  else
    err "root AGENTS.md missing execution contract or background-work trigger"
  fi
fi

if [[ -f "$ROOT/memory/MEMORY.md" ]]; then
  n=$(lines "$ROOT/memory/MEMORY.md")
  b=$(wc -c <"$ROOT/memory/MEMORY.md" | tr -d ' ')
  if (( n > 200 )); then err "MEMORY.md has $n lines (max 200)"; else ok "MEMORY.md $n lines"; fi
  if (( b > 25600 )); then err "MEMORY.md is $b bytes (max 25600)"; else ok "MEMORY.md $b bytes"; fi
  if grep -qi 'session start' "$ROOT/memory/MEMORY.md"; then
    err "MEMORY.md tells agents to load at session start"
  else
    ok "MEMORY.md is on-demand"
  fi
fi

if [[ -f "$ROOT/AGENTS.md" ]]; then
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if [[ -e "$ROOT/$path" ]]; then ok "pointer $path"; else err "broken pointer $path"; fi
  done < <(awk -F'`' '/\| `/{print $2}' "$ROOT/AGENTS.md" | grep -E '^(docs|memory|openspec|tooling)/' || true)
fi

check_adapter() {
  local name=$1
  if [[ -L "$ROOT/$name" ]]; then
    t=$(readlink "$ROOT/$name")
    if [[ "$t" == AGENTS.md ]]; then ok "$name symlink"; else err "$name symlink -> $t"; fi
  elif [[ -f "$ROOT/$name" ]]; then
    if grep -q 'AGENTS.md' "$ROOT/$name" && [[ $(lines "$ROOT/$name") -le 4 ]]; then
      ok "$name pointer"
    else
      err "$name is not a thin AGENTS.md adapter"
    fi
  fi
}

check_adapter CLAUDE.md
check_adapter GEMINI.md

# .qualityignore is the authoritative human decision that a tree is not ours to
# gate (mirrors is_ignored() in agents_chain_lib.py): exact repo-relative paths,
# trailing-slash directory names anywhere in the path, and shell-style globs.
quality_ignored() {
  local rel="$1" pat core base
  [[ -f "$ROOT/.qualityignore" ]] || return 1
  base="$(basename "$rel")"
  while IFS= read -r pat; do
    core="${pat%/}"
    [[ -n "$core" ]] || continue
    if [[ "$core" == */* ]]; then
      # Path or glob pattern: match the exact file, anything under it, or the glob.
      if [[ "$rel" == "$core" || "$rel" == "$core/"* || "$rel" == $core ]]; then
        return 0
      fi
    else
      # Bare name: matches as any path component or as a basename glob.
      case "/$rel/" in
        *"/$core/"*) return 0 ;;
      esac
      if [[ "$base" == $core ]]; then
        return 0
      fi
    fi
  done < <(grep -v '^[[:space:]]*#' "$ROOT/.qualityignore" | sed 's/[[:space:]]*$//' | grep -v '^$')
  return 1
}

while IFS= read -r f; do
  rel=${f#"$ROOT"/}
  case "$rel" in
    CLAUDE.md|GEMINI.md) continue ;;
  esac
  in_submodule "$rel" && continue
  quality_ignored "$rel" && continue
  err "$rel is a nested adapter — CLAUDE.md and GEMINI.md exist only at the repo root and must point at AGENTS.md"
done < <(find "$ROOT" -name .git -prune -o "${SM_PRUNE[@]+"${SM_PRUNE[@]}"}" \( -name CLAUDE.md -o -name GEMINI.md -o -name claude.md -o -name gemini.md \) -print 2>/dev/null)

if [[ -f "$ROOT/.gitignore" ]] && grep -q '\.env' "$ROOT/.gitignore"; then
  ok ".gitignore has .env"
else
  err ".gitignore missing .env"
fi

root_agents="$ROOT/AGENTS.md"
while IFS= read -r f; do
  rel=${f#"$ROOT"/}
  [[ "$rel" == AGENTS.md ]] && continue
  # Belt-and-braces: SM_PRUNE already stops the walk at submodule roots, and the
  # dedicated submodule gate decides ownership (vendor's own file vs our leak).
  in_submodule "$rel" && continue
  n=$(lines "$f")
  if (( n > 200 )); then err "$rel has $n lines (nested max 200)"; else ok "$rel $n lines"; fi
  if [[ -f "$root_agents" ]] && cmp -s "$f" "$root_agents"; then
    err "$rel is a copy of root AGENTS.md (must be a delta)"
  fi
done < <(find "$ROOT" -name .git -prune -o "${SM_PRUNE[@]+"${SM_PRUNE[@]}"}" -name AGENTS.md -print 2>/dev/null)

MEMORY_ROOTS=("$ROOT/memory")
while IFS= read -r base; do
  [[ -n "$base" ]] && MEMORY_ROOTS+=("$ROOT/$base")
done < <(python3 "$(cd "$(dirname "$0")" && pwd)/project_layout.py" "$ROOT" --bases 2>/dev/null)

while IFS= read -r f; do
  rel=${f#"$ROOT"/}
  base=$(basename "$f")
  [[ "$base" == .gitkeep ]] && continue
  dir=$(basename "$(dirname "$f")")
  parent=$(basename "$(dirname "$(dirname "$f")")")
  if [[ "$parent" != lessons ]]; then
    err "$rel must be memory/lessons/<domain>/<slug>.md"
    continue
  fi
  if is_forbidden_domain "$dir"; then
    err "$rel uses forbidden domain '$dir'"
  fi
  if [[ "$base" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2} ]]; then
    err "$rel is chronological; use a slug"
  fi
  for h in '## Situation' '## Decision' '## Reasoning' '## Outcome' '## Lesson'; do
    if ! grep -q "^$h" "$f"; then err "$rel missing $h"; fi
  done
  if ! grep -q 'Domain:' "$f"; then err "$rel missing Domain"; fi
  if ! grep -q 'Pattern-Key:' "$f"; then err "$rel missing Pattern-Key"; fi
done < <(for base in "${MEMORY_ROOTS[@]}"; do find "$base/lessons" -type f -name '*.md' 2>/dev/null; done)

while IFS= read -r f; do
  rel=${f#"$ROOT"/}
  base=$(basename "$f")
  [[ "$base" == .gitkeep ]] && continue
  dir=$(basename "$(dirname "$f")")
  parent=$(basename "$(dirname "$(dirname "$f")")")
  if [[ "$parent" != patterns ]]; then
    err "$rel must be memory/patterns/<domain>/<key>.md"
    continue
  fi
  if is_forbidden_domain "$dir"; then
    err "$rel uses forbidden domain '$dir'"
  fi
  if ! grep -q '^## Rule' "$f"; then err "$rel missing ## Rule"; fi
  if ! grep -q 'Domain:' "$f"; then err "$rel missing Domain"; fi
done < <(for base in "${MEMORY_ROOTS[@]}"; do find "$base/patterns" -type f -name '*.md' 2>/dev/null; done)

while IFS= read -r f; do
  rel=${f#"$ROOT"/}
  base=$(basename "$f")
  [[ "$base" == .gitkeep ]] && continue
  if [[ ! "$base" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$ ]]; then
    err "$rel must be memory/daily/YYYY-MM-DD.md"
  fi
done < <(for base in "${MEMORY_ROOTS[@]}"; do find "$base/daily" -type f -name '*.md' 2>/dev/null; done)

if [[ -f "$ROOT/AGENTS.md" ]] && ! grep -q '^## MUST' "$ROOT/AGENTS.md"; then
  err "AGENTS.md missing ## MUST gate"
else
  ok "AGENTS.md has ## MUST gate"
fi

kit_dir() {
  case "$1" in
    docs|memory|openspec|tooling|.github|.git|.opencode|.claude|.githooks|node_modules|dist|build) return 0 ;;
  esac
  # Quality control dir: control data, not product. Only a control dir once
  # its contract exists — a product folder could legitimately be named quality/.
  [[ "$1" == quality && -f "$ROOT/docs/QUALITY.md" ]] && return 0
  return 1
}

HAS_PRODUCT=0
shopt -s nullglob
for d in "$ROOT"/*/; do
  name=$(basename "$d")
  if kit_dir "$name"; then continue; fi
  # A submodule root is vendored, not product. It never needs a nested AGENTS.md.
  if in_submodule "$name"; then
    ok "$name/ is a submodule (vendored; not product)"
    continue
  fi
  # Deliberately ignored: the user already declared this untracked. Ignored trees
  # are not ours to gate — flagging them would punish a documented decision
  # (build output, local-dev bridges into a real submodule elsewhere).
  if git -C "$ROOT" check-ignore -q "$name" 2>/dev/null; then
    ok "$name/ is gitignored (not product)"
    continue
  fi
  # A symlink is a bridge, not a tree. Its target is gated wherever it really
  # lives; treating the link as a clone would double-report it.
  if [[ -L "${d%/}" ]]; then
    ok "$name/ is a symlink (bridge; gated at its target)"
    continue
  fi
  # A foreign repo not declared in .gitmodules. One unambiguous error: do not
  # tell the agent to scaffold into it.
  if [[ -e "$d/.git" ]]; then
    err "$name/ contains .git but is not in .gitmodules (stray clone — add it as a submodule, or gitignore it; do not scaffold into it)"
    continue
  fi
  # Count real product files only. Sidecar trees (`<submodule>.agent/`) are
  # kit-owned knowledge ABOUT a vendored repo, so a folder holding nothing but a
  # submodule and its sidecar is vendored, not product, and must not be told to
  # grow an AGENTS.md.
    if find "$d" "${SM_PRUNE[@]+"${SM_PRUNE[@]}"}" "${KNOWLEDGE_PRUNE[@]+"${KNOWLEDGE_PRUNE[@]}"}" -name '*.agent' -prune -o \
        -type f ! -name .gitkeep -print 2>/dev/null | grep -q .; then
      HAS_PRODUCT=1
    fi
done
shopt -u nullglob

chain_py="$(cd "$(dirname "$0")" && pwd)/agents-chain.py"
if [[ ! -f "$chain_py" ]]; then
  err "missing $chain_py (re-run repo-scaffold init)"
elif ! command -v python3 >/dev/null 2>&1; then
  err "python3 required for the AGENTS.md chain gate"
else
  if env -u AGENT_KIT_CHAIN_TEST -u AGENT_KIT_CROWD_THRESHOLD -u AGENT_KIT_SKIP \
      python3 "$chain_py" "$ROOT"; then
    :
  else
    fail=1
  fi
fi

source "$(cd "$(dirname "$0")" && pwd)/check-submodules.sh"
if ! python3 "$(cd "$(dirname "$0")" && pwd)/knowledge-check.py" "$ROOT"; then
  fail=1
fi

if [[ -d "$ROOT/.claude/rules" ]]; then
  while IFS= read -r f; do
    rel=${f#"$ROOT"/}
    if ! grep -q '^paths:' "$f"; then
      err "$rel has no paths: (unscoped vendor rule)"
    else
      ok "$rel is path-scoped"
    fi
  done < <(find "$ROOT/.claude/rules" -type f -name '*.md' 2>/dev/null)
fi

if grep -R -E -n --exclude-dir=.git --exclude-dir=templates \
  'AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----' \
  "$ROOT/AGENTS.md" "$ROOT/memory" "$ROOT/docs" "$ROOT/.github" 2>/dev/null | grep -q .; then
  err "secret-like pattern in kit files"
else
  ok "no secret-like patterns in kit files"
fi

KIT_STATE="$ROOT/tooling/agent-kit"
file_sha() {
  local f="$ROOT/$1"
  if [[ -f "$f" ]]; then
    shasum -a 256 "$f" 2>/dev/null | awk '{print substr($1,1,16)}'
  else
    echo "missing"
  fi
}

STEER_GROWTH=none
source "$(cd "$(dirname "$0")" && pwd)/check-steer.sh"

print_steer

trivial=0
if [[ -f "$ROOT/tooling/agent-kit/trivial.md" ]]; then
  tn=$(wc -c <"$ROOT/tooling/agent-kit/trivial.md" | tr -d ' ')
  if (( tn >= 40 )); then
    trivial=1
    ok "trivial.md opt-out present"
  else
    err "tooling/agent-kit/trivial.md too short (need ≥40 chars)"
  fi
fi

# The knowledge gate above requires changed evidence and distillation review.
# Do not force invented lessons or duplicate root logs for sidecar-only work.
# trivial.md only exempts the command-discovery check below, never knowledge.
if (( trivial == 0 )); then
  if (( HAS_PRODUCT )); then
    real_cmd=0
    while IFS= read -r row; do
      val=$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}')
      if [[ -n "$val" && "$val" != "n/a" && "$val" != *"check.sh"* ]]; then
        real_cmd=1
      fi
    done < <(grep -E '^\| (Install|Dev|Test|Lint|Typecheck|Build) \|' "$ROOT/AGENTS.md" || true)
    if (( real_cmd )); then
      ok "at least one real command"
    else
      err "product folders exist but Install/Dev/Test/Lint/Typecheck/Build are all n/a (fill one or write tooling/agent-kit/trivial.md)"
    fi
  fi
fi

state_line() { (( NO_WRITE )) || echo "state: $KIT_STATE/STATUS.md"; }

if (( fail )); then
  echo "agent-kit check failed" >&2
  state_line
  exit 1
fi
if (( warns )); then
  echo "agent-kit check passed with $warns warning(s):"
  printf '  ! %s\n' "${WARN_LINES[@]}"
  echo "Warnings do not block a commit. They mean a recorded fact may no longer be true — verify before relying on it."
else
  echo "agent-kit check passed"
fi
state_line
