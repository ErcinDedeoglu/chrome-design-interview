# Sourced by check-agent-kit.sh / check.sh. Submodule gates only.
# Shares the caller shell: ROOT, ok, err, note, warn, SUBMODULE_PATHS, HAS_SUBMODULES.
# ---- submodule gates ----
if (( HAS_SUBMODULES )); then
  ok "submodules: ${#SUBMODULE_PATHS[@]} declared in .gitmodules"

  # 1. No tracked file of ours may live inside a submodule path.
  #    The gitlink itself is mode 160000 at exactly $sm; anything deeper is ours
  #    leaking into a foreign repo.
  for sm in "${SUBMODULE_PATHS[@]}"; do
    inside=$(git -C "$ROOT" ls-files -- "$sm/" 2>/dev/null | grep -v "^$sm$" || true)
    if [[ -n "$inside" ]]; then
      err "superproject tracks files inside $sm/ (submodule must be a single gitlink): $(printf '%s' "$inside" | head -3 | tr '\n' ' ')"
    else
      ok "$sm is a single gitlink"
    fi
    for forbidden in AGENTS.md CLAUDE.md GEMINI.md docs/QUALITY.md docs/GROWTH.md memory tooling/agent-kit .githooks; do
      [[ -e "$ROOT/$sm/$forbidden" ]] || continue
      # A foreign repo is allowed its OWN AGENTS.md, hooks or docs — plenty of
      # upstreams ship them. Only OUR leak is a violation, and the test for that
      # is whether the submodule tracks it: tracked = theirs, untracked = ours.
      if git -C "$ROOT/$sm" ls-files --error-unmatch -- "$forbidden" >/dev/null 2>&1; then
        note "$sm/$forbidden is tracked upstream (the vendor's own file; not ours to remove)"
      else
        err "$sm/$forbidden is untracked inside a foreign repo — we scaffolded into a submodule; remove it and use docs/submodules/"
      fi
    done
  done

  # 2. Submodule worktrees must be clean; pointer moves must be intentional.
  #    TRAP: `git submodule status` prefix does NOT report a dirty worktree.
  #    `+` means the checked-out COMMIT differs from the index; a submodule with
  #    uncommitted edits at the recorded commit still shows a plain space.
  #    Verified against a 42-submodule repo: `submodule status | grep -c '^+'`
  #    returned 0 while 9 submodules had real uncommitted work. So dirtiness is
  #    read from inside with `status --porcelain`, and the prefix is used only to
  #    tell uninit / conflict / pointer-moved apart.
  #    Never treat an unreadable submodule as clean — that is how this silently
  #    passed before. Distinguish clean / dirty / undeterminable.
  sub_dirty() { # 0=dirty 1=clean 2=cannot determine
    local p="$ROOT/$1"
    [[ -d "$p" ]] || return 2
    git -C "$p" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 2
    local out
    out=$(git -C "$p" status --porcelain 2>/dev/null) || return 2
    [[ -n "$out" ]] && return 0
    return 1
  }
  for smpath in "${SUBMODULE_PATHS[@]}"; do
    line=$(git -C "$ROOT" submodule status -- "$smpath" 2>/dev/null || true)
    [[ -z "$line" ]] && continue
    prefix=${line:0:1}
    rest=${line:1}
    sha=${rest%% *}
    case "$prefix" in
      "-") ok "submodule $smpath uninitialized (excluded)" ;;
      "U") err "submodule $smpath has merge conflicts — resolve in the superproject" ;;
      *)
        # `set -e` would abort on a bare nonzero return; capture instead.
        dirty_rc=0
        sub_dirty "$smpath" || dirty_rc=$?
        case $dirty_rc in
          0) err "submodule $smpath has a dirty worktree — revert; land changes upstream and bump the pointer" ;;
          2) err "cannot read submodule $smpath worktree (init it, or fix the gitlink) — refusing to assume clean" ;;
          *)
            if [[ "$prefix" == "+" ]]; then
              ok "submodule $smpath pointer differs from index (bump: record old/new sha + why)"
            else
              ok "submodule $smpath clean at ${sha:0:12}"
            fi
            ;;
        esac
        ;;
    esac
  done

  # 3. Register must exist and match .gitmodules in both directions.
  if [[ -f "$ROOT/docs/SUBMODULES.md" ]]; then
    ok "exists docs/SUBMODULES.md"
    # Read only the generated block, so prose tables cannot be mistaken for rows.
    reg_block=$(awk '
      /agent-kit:submodules:begin/ { inblk=1; next }
      /agent-kit:submodules:end/   { inblk=0 }
      inblk { print }
    ' "$ROOT/docs/SUBMODULES.md" 2>/dev/null || true)
    for sm in "${SUBMODULE_PATHS[@]}"; do
      row=$(printf '%s\n' "$reg_block" | grep -F "\`$sm\`" | head -1 || true)
      if [[ -z "$row" ]]; then
        err "docs/SUBMODULES.md missing row for $sm (run tooling/agent-kit/submodules.sh)"
        continue
      fi
      # Pinned SHA in the register must match reality, or the bump was not recorded.
      # A .gitmodules entry never added to the index yields no status line at all
      # (exit 1) — that is the register's `unknown` state, not a stale sha.
      actual=$(git -C "$ROOT" submodule status -- "$sm" 2>/dev/null | head -1 | sed 's/^.//' | awk '{print substr($1,1,12)}' || true)
      if [[ -n "$actual" ]] && ! printf '%s' "$row" | grep -qF "$actual"; then
        err "docs/SUBMODULES.md has a stale pinned sha for $sm (expected $actual) — run tooling/agent-kit/submodules.sh"
      else
        ok "register current for $sm"
      fi
    done
    # Stale rows: only inside the generated block. Scraping the whole file would
    # misread prose tables (the sidecar legend) as register rows.
    while IFS= read -r row; do
      [[ -z "$row" ]] && continue
      if ! in_submodule "$row"; then
        err "docs/SUBMODULES.md has stale row '$row' (not in .gitmodules)"
      fi
    done < <(awk '
      /agent-kit:submodules:begin/ { inblk=1; next }
      /agent-kit:submodules:end/   { inblk=0 }
      inblk && /^\| `/ { n=split($0,c,"`"); print c[2] }
    ' "$ROOT/docs/SUBMODULES.md" || true)
  else
    err "submodules exist but docs/SUBMODULES.md is missing (run tooling/agent-kit/submodules.sh)"
  fi

  # 4. Sidecar knowledge must exist per submodule, and must not be orphaned.
  #    Reconcile BOTH directions: a missing sidecar hides knowledge, an orphaned
  #    one describes a submodule we no longer have and will be trusted anyway.
  #
  #    The committed mapping preserves each repository's chosen layout. Local
  #    configuration cannot silently reduce the required records at commit.
  SIDECAR_LAYOUT=mapped
  SIDECAR_FILES=(NOTES.md RUNBOOK.md STEERS.md HISTORY.md MEMORY.md LESSONS.md DECISIONS.md AGENTS.md)

  # Resolve every sidecar path in ONE python process, then look it up in pure
  # bash. The mapping is constant for the whole run, but the orphan check below
  # called sidecar_dir_for once per (sidecar dir x submodule) pair, and each
  # call spawned an interpreter that rebuilt a Tree from git: 100 spawns for
  # 10 submodules, ~17s of a ~20s gate, growing linearly per submodule. Bash
  # 3.2 has no associative arrays, so keep it as "path<TAB>dir" lines.
  SIDECAR_LIST=$(python3 - "$ROOT" "$(cd "$(dirname "$0")" && pwd)" 2>/dev/null <<'PY'
import sys
sys.path.insert(0, sys.argv[2])
from knowledge_layout import Tree, resolve
tree = Tree(sys.argv[1])
for sm, base in resolve(tree)["sidecars"].items():
    print("%s\t%s" % (sm, tree.root / base))
PY
  ) || SIDECAR_LIST=""

  sidecar_dir_for() { # $1 = submodule path
    local want=$1 _sm _sc
    while IFS=$'\t' read -r _sm _sc; do
      if [[ "$_sm" == "$want" ]]; then printf '%s\n' "$_sc"; return 0; fi
    done <<<"$SIDECAR_LIST"
    # No cached entry: fall back to the original resolution so an unmapped or
    # malformed submodule fails exactly as it did, instead of looking empty.
    python3 - "$ROOT" "$want" "$(cd "$(dirname "$0")" && pwd)" <<'PY'
import sys
sys.path.insert(0, sys.argv[3])
from knowledge_layout import Tree, resolve
tree = Tree(sys.argv[1])
print(tree.root / resolve(tree)["sidecars"][sys.argv[2]])
PY
  }

  ok "sidecar layout: $SIDECAR_LAYOUT (${SIDECAR_FILES[*]})"

  for sm in "${SUBMODULE_PATHS[@]}"; do
    slug=${sm#/}; slug=${slug%/}; slug=${slug//\//-}
    sc=$(sidecar_dir_for "$sm")
    rel_sc=${sc#"$ROOT"/}
    missing=()
    for f in "${SIDECAR_FILES[@]}"; do
      [[ -f "$sc/$f" ]] || missing+=("$f")
    done
    if (( ${#missing[@]} )); then
      err "$rel_sc/ missing ${missing[*]} (run tooling/agent-kit/submodules.sh)"
      continue
    fi
    ok "sidecar $rel_sc/ complete"

    # Drift: compare the sidecar's reviewed-at stamp to the live pointer. Notes
    # written against an older commit are suspect, and silence here is the whole
    # failure mode — an unreviewed sidecar reads as authoritative.
    notes_file="$sc/${SIDECAR_FILES[0]}"
    stamp=$(sed -n 's/.*agent-kit:reviewed-at:[[:space:]]*\([^ ]*\)[[:space:]]*-->.*/\1/p' "$notes_file" | head -1)
    # An uninitialized submodule has no worktree to compare against. Saying the
    # pointer "moved" there would be a false claim, not a caution. Note that an
    # empty submodule dir still resolves to the SUPERPROJECT worktree, so ask
    # git submodule status (prefix '-') rather than probing the directory.
    sm_state=$(git -C "$ROOT" submodule status -- "$sm" 2>/dev/null | head -1 | cut -c1 || true)
    if [[ "$sm_state" == "-" ]]; then
      ok "sidecar $slug present (submodule uninitialized; drift not checkable)"
    elif [[ -z "$stamp" || "$stamp" == "unreviewed" ]]; then
      warn "$rel_sc/${SIDECAR_FILES[0]} never reviewed against the pointer — read it, then submodules.sh --review $sm"
    else
      head_sha=$(git -C "$ROOT/$sm" rev-parse HEAD 2>/dev/null || true)
      if [[ -z "$head_sha" ]]; then
        ok "sidecar $slug stamped $stamp (cannot read HEAD; not comparing)"
      elif [[ "${head_sha:0:${#stamp}}" == "$stamp" ]]; then
        ok "sidecar $slug reviewed at current pointer ($stamp)"
      else
        behind=$(git -C "$ROOT/$sm" rev-list --count "$stamp..HEAD" 2>/dev/null || echo '?')
        if [[ "$behind" == "?" ]]; then
          warn "sidecar $slug reviewed at $stamp which is not in $sm's history — re-read, then submodules.sh --review $sm"
        else
          warn "sidecar $slug reviewed at $stamp but pointer moved +$behind commits — re-read, then submodules.sh --review $sm"
        fi
      fi
    fi
  done

  # Orphaned sidecars: knowledge describing something no longer in .gitmodules.
  # Central directories must contain mapped sidecars. Removed beside/custom
  # mappings are also rejected by the shared resolver until explicitly reviewed.
  if [[ -d "$ROOT/docs/submodules" ]]; then
    while IFS= read -r d; do
      [[ -z "$d" ]] && continue
      sl=$(basename "$d")
      found=0
      for sm in "${SUBMODULE_PATHS[@]}"; do
        cand=$(sidecar_dir_for "$sm")
        [[ "$cand" == "$d" || "$cand" == "$d"/* ]] && { found=1; break; }
      done
      (( found )) || err "docs/submodules/$sl/ is orphaned (no such submodule in .gitmodules) — delete it or restore the submodule"
    done < <(find "$ROOT/docs/submodules" -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true)
  fi

  # 5. Remote-tracking honesty. We never fetch here (offline gate), so any
  #    "behind" reading is only as fresh as the last fetch. Say so rather than
  #    letting it read as "up to date".
  #    Submodules normally sit on a DETACHED HEAD, so @{upstream} does not
  #    exist. Compare against the tracking branch git would use instead.
  for sm in "${SUBMODULE_PATHS[@]}"; do
    [[ -d "$ROOT/$sm" ]] || continue
    # Skip uninitialized: an empty dir resolves to the superproject, whose
    # upstream would then be misreported as the submodule's.
    [[ "$(git -C "$ROOT" submodule status -- "$sm" 2>/dev/null | head -1 | cut -c1)" == "-" ]] && continue
    ref=$(git -C "$ROOT/$sm" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)
    if [[ -z "$ref" ]]; then
      # Detached: use the branch .gitmodules tracks, else the remote default.
      br=$(git -C "$ROOT" config -f .gitmodules --get "submodule.$sm.branch" 2>/dev/null || true)
      if [[ -n "$br" ]] && git -C "$ROOT/$sm" rev-parse --verify -q "origin/$br" >/dev/null 2>&1; then
        ref="origin/$br"
      else
        ref=$(git -C "$ROOT/$sm" symbolic-ref --short -q refs/remotes/origin/HEAD 2>/dev/null || true)
      fi
    fi
    [[ -z "$ref" ]] && continue
    git -C "$ROOT/$sm" rev-parse --verify -q "$ref" >/dev/null 2>&1 || continue
    ahead=$(git -C "$ROOT/$sm" rev-list --count "HEAD..$ref" 2>/dev/null || echo '?')
    if [[ "$ahead" != "0" && "$ahead" != "?" ]]; then
      note "$sm pinned $ahead commits behind $ref as of the last fetch (this gate never fetches; a 0 here would only mean 'nothing new when you last fetched')"
    fi
  done
fi
