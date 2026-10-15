#!/usr/bin/env bash
# Generated repo-scaffold quality checker for chrome-design-interview.
# Written by the repo-scaffold quality phase from docs/QUALITY.md — never copied
# from another repository. Standard library only, deterministic, fast.
# Checks staged files only, against the rules codified in docs/QUALITY.md.
set -euo pipefail

ROOT=$(cd "$(git rev-parse --show-toplevel)" && pwd)
export AGENT_KIT_NO_WRITE=1
unset AGENT_KIT_CHAIN_TEST AGENT_KIT_CROWD_THRESHOLD AGENT_KIT_SKIP

rc=0
fail() { echo "quality: $*" >&2; rc=1; }
ok() { echo "quality: ok $*"; }

# ---- control files: fail closed when missing/unreadable/malformed ----
control_files=(docs/QUALITY.md .qualityignore quality/size-baseline.json quality/cohesion-reviews.json)
for c in "${control_files[@]}"; do
  if [[ ! -f "$ROOT/$c" ]]; then
    fail "missing control file $c — cannot enforce quality contract"
  elif [[ ! -r "$ROOT/$c" ]]; then
    fail "unreadable control file $c — cannot enforce quality contract"
  fi
done
if [[ $rc -ne 0 ]]; then
  echo "quality: 1+ control file failure(s). Read docs/QUALITY.md, apply, re-stage." >&2
  exit 1
fi

# Validate JSON control files parse.
for j in quality/size-baseline.json quality/cohesion-reviews.json; do
  if ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$ROOT/$j" 2>/dev/null; then
    fail "malformed JSON control file $j — cannot enforce quality contract"
  fi
done

# ---- read thresholds from the contract's budget table (never duplicated here) ----
read_budget() {
  # $1 = artifact class label; prints "split hard" in lines, or empty if not found.
  local label=$1
  awk -v lab="$label" '
    $0 ~ /^\|/ { gsub(/\|/,""); gsub(/^[ \t]+|[ \t]+$/,""); split($0,a,"|");
      if (a[2] ~ lab) { gsub(/[^0-9]/,"",a[3]); gsub(/[^0-9]/,"",a[4]); print a[3], a[4]; exit } }
  ' "$ROOT/docs/QUALITY.md"
}

read_also() {
  awk -v lab="$1" '
    $0 ~ /^\|/ { gsub(/\|/,""); gsub(/^[ \t]+|[ \t]+$/,""); split($0,a,"|");
      if (a[2] ~ lab) { print a[5]; exit } }
  ' "$ROOT/docs/QUALITY.md"
}

# ---- submodule paths: structurally excluded (read .gitmodules, never probe .git) ----
SUBMODULE_PATHS=()
if [[ -f "$ROOT/.gitmodules" ]]; then
  while IFS= read -r sm; do
    [[ -n "$sm" ]] && SUBMODULE_PATHS+=("${sm%/}")
  done < <(git -C "$ROOT" config -f .gitmodules --get-regexp '^submodule\..*\.path$' 2>/dev/null | cut -d' ' -f2-)
fi
in_submodule() {
  local p=${1#./}; p=${p%/}
  local sm
  for sm in "${SUBMODULE_PATHS[@]+"${SUBMODULE_PATHS[@]}"}"; do
    [[ "$p" == "$sm" || "$p" == "$sm"/* ]] && return 0
  done
  return 1
}

# ---- .qualityignore ----
quality_ignored() {
  local rel="$1" core base
  base="$(basename "$rel")"
  while IFS= read -r pat; do
    [[ -z "$pat" || "$pat" == \#* ]] && continue
    core="${pat%/}"
    [[ -z "$core" ]] && continue
    if [[ "$core" == */* ]]; then
      [[ "$rel" == "$core" || "$rel" == "$core/"* ]] && return 0
    else
      case "/$rel/" in
        *"/$core/"*) return 0 ;;
      esac
      [[ "$base" == $core ]] && return 0
    fi
  done < <(sed 's/[[:space:]]*$//' "$ROOT/.qualityignore" | grep -v '^$')
  return 1
}

# ---- staged regular files only ----
STAGED=()
while IFS= read -r -d '' f; do
  [[ -z "$f" ]] && continue
  rel=${f#"$ROOT"/}
  # Skip non-regular files (gitlinks are directories; wc -l on them dies).
  [[ -f "$f" ]] || continue
  # Skip submodule paths — structurally excluded, never our findings.
  in_submodule "$rel" && continue
  # Skip quality-ignored paths.
  quality_ignored "$rel" && continue
  STAGED+=("$rel")
done < <(git -C "$ROOT" diff --cached --name-only -z 2>/dev/null || true)

# ---- thresholds from contract ----
root_split=$(read_budget "Root agent entry file" | awk '{print $1}')
root_hard=$(read_budget "Root agent entry file" | awk '{print $2}')
mem_split=$(read_budget "Memory index" | awk '{print $1}')
mem_hard=$(read_budget "Memory index" | awk '{print $2}')
mem_hard=${mem_hard:-200}
scoped_hard=$(read_budget "Scoped agent entry file" | awk '{print $2}')

# ---- rule: root AGENTS.md ≤ hard maximum; split-review warning at split threshold ----
check_line_cap() {
  local path=$1 hard=$2 label=$3 rule=$4 section=$5
  [[ -z "$hard" ]] && return
  local f="$ROOT/$path"
  [[ -f "$f" ]] || return
  local n
  n=$(wc -l <"$f" | tr -d ' ')
  if (( n > hard )); then
    fail "$path — above hard maximum ($n > $hard lines) [$rule] → decompose by responsibility — see \"Size Budgets\" in docs/QUALITY.md [$section]"
  elif [[ -n "${root_split:-}" && -n "${label:-}" && $n -ge ${root_split:-999999} ]]; then
    ok "$path at split-review threshold ($n lines) — cohesion review required before further growth [$rule]"
  else
    ok "$path within budget ($n ≤ $hard lines) [$rule]"
  fi
}

check_line_cap AGENTS.md "$root_hard" root size-hard size-hard
check_line_cap memory/AGENTS.md "$scoped_hard" scoped size-hard size-hard

# memory/MEMORY.md: lines and bytes
mem_f="$ROOT/memory/MEMORY.md"
if [[ -f "$mem_f" ]]; then
  mn=$(wc -l <"$mem_f" | tr -d ' ')
  mb=$(wc -c <"$mem_f" | tr -d ' ')
  if (( mn > mem_hard )) || (( mb > 25600 )); then
    fail "memory/MEMORY.md — above hard maximum ($mn lines / $mb bytes; limit $mem_hard lines / 25 KB) [size-hard memory index] → prune or supersede — see \"Size Budgets\" in docs/QUALITY.md"
  else
    ok "memory/MEMORY.md within budget ($mn lines / $mb bytes) [size-hard memory index]"
  fi
fi

# ---- rule: no loose files at root beyond mandated entry files ----
mandated_root_files="AGENTS.md CLAUDE.md GEMINI.md opencode.json README.md .gitignore docs memory openspec tooling .githooks .opencode .github .qualityignore quality"
root_loose=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    */*) continue ;; # not a root file
  esac
  # skip dot-git metadata and hooks-dir duplicates handled elsewhere
  case " $mandated_root_files " in
    *" $f "*) continue ;;
  esac
  root_loose+=("$f")
done < <(git -C "$ROOT" ls-files --stage "$ROOT" 2>/dev/null | awk '{print $4}' | grep -v '^$' || true)

# Recompute root loose from STAGED set for the staged check only.
staged_root_loose=()
for rel in "${STAGED[@]+"${STAGED[@]}"}"; do
  case "$rel" in
    */*) continue ;;
  esac
  case " $mandated_root_files " in
    *" $rel "*) continue ;;
  esac
  staged_root_loose+=("$rel")
done

if (( ${#staged_root_loose[@]} > 0 )); then
  for f in "${staged_root_loose[@]}"; do
    fail "$f — loose file at repository root [no-loose-files] → move into a domain folder — see \"Separation of Concerns\" in docs/QUALITY.md"
  done
else
  ok "no loose root files staged [no-loose-files]"
fi

# ---- rule: no kit file inside a submodule ----
for rel in "${STAGED[@]+"${STAGED[@]}"}"; do
  case "$rel" in
    AGENTS.md|memory/*|docs/*|tooling/*|openspec/*) ;;
    *) continue ;;
  esac
  in_submodule "$rel" && fail "$rel — kit file inside a git submodule [submodules] → never scaffold into a foreign repo; work in the superproject — see docs/QUALITY.md" && continue
done

# ---- summary ----
if [[ $rc -ne 0 ]]; then
  echo "quality: $rc violation(s). Read docs/QUALITY.md, apply, re-stage." >&2
  exit 1
fi
echo "quality: passed"
exit 0
