#!/usr/bin/env bash
# Regenerate docs/SUBMODULES.md from .gitmodules and scaffold a sidecar
# directory per submodule at its committed mapped path. Never writes inside a
# submodule.
#
# usage: submodules.sh [root] [--check] [--review <path>]
#   --check          exit 1 if the register is out of date; write nothing
#   --review <path>  stamp that submodule's sidecar NOTES.md as reviewed at
#                    its current sha (records that a human/agent re-read it)

set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1

CHECK=0
REVIEW=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK=1 ;;
    --review)
      shift
      REVIEW="${1:-}"
      [[ -n "$REVIEW" ]] || { echo "fail: --review needs a submodule path" >&2; exit 2; }
      ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done
ROOT=$(cd "${ARGS[0]:-.}" && pwd)

# Hooks export these; they leak into `git -C <submodule>` and would make every
# nested query read the superproject instead. Drop them.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX

if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "submodules: not a git repo, nothing to do"
  exit 0
fi

HERE=$(cd "$(dirname "$0")" && pwd)
TPL_DIR=""
for cand in "$HERE" "$HERE/../assets" "$ROOT/tooling/agent-kit"; do
  [[ -f "$cand/submodule-notes.md" ]] && { TPL_DIR=$(cd "$cand" && pwd); break; }
done

export PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}"
if (( CHECK == 0 )) && [[ -z "$REVIEW" ]]; then
  python3 "$HERE/knowledge_scaffold.py" "$ROOT"
fi

python3 - "$ROOT" "$CHECK" "$TPL_DIR" "$REVIEW" <<'PY'
import re
import subprocess
import sys
from pathlib import Path
from knowledge_layout import Tree, resolve

root = Path(sys.argv[1])
check_only = sys.argv[2] == "1"
tpl_dir = sys.argv[3]
review = sys.argv[4]
# Generator, working checks and staged gates share one committed mapping.
mapping = resolve(Tree(root))["sidecars"]


def sidecar_dir(path):
    return root / mapping[path]

BEGIN = "<!-- agent-kit:submodules:begin -->"
END = "<!-- agent-kit:submodules:end -->"
STAMP = "<!-- agent-kit:reviewed-at:"

SIDECARS = {
    "NOTES.md": "submodule-notes.md",
    "RUNBOOK.md": "submodule-runbook.md",
    "STEERS.md": "submodule-steers.md",
    "HISTORY.md": "submodule-history.md",
}


def git(*args, cwd=root, strip=True):
    r = subprocess.run(
        ["git", "-C", str(cwd), *args], capture_output=True, text=True
    )
    out = r.stdout
    return r.returncode, out.strip() if strip else out.rstrip("\n")


def slug(path):
    return path.strip("/").replace("/", "-")


def submodules():
    if not (root / ".gitmodules").exists():
        return []
    code, out = git(
        "config", "-f", ".gitmodules", "--get-regexp", r"^submodule\..*\.path$"
    )
    if code != 0 or not out:
        return []
    entries = []
    for line in out.splitlines():
        key, _, path = line.partition(" ")
        name = key[len("submodule.") : -len(".path")]
        _, url = git("config", "-f", ".gitmodules", "--get", f"submodule.{name}.url")
        entries.append({"name": name, "path": path.strip(), "url": url or "n/a"})
    return sorted(entries, key=lambda e: e["path"])


def state_for(entry):
    """(pinned_sha, state) — uninit/clean/dirty-tree/pointer-moved/conflict."""
    path = entry["path"]
    # strip=False: the leading status char is significant and would be eaten.
    code, out = git("submodule", "status", "--", path, strip=False)
    if code != 0 or not out:
        return "n/a", "unknown"
    line = out.splitlines()[0]
    prefix, rest = line[:1], line[1:]
    if prefix not in ("-", "+", "U", " "):
        prefix, rest = " ", line
    sha = rest.split(" ", 1)[0][:12] if rest else "n/a"
    if prefix == "-":
        return sha, "uninit"
    if prefix == "U":
        return sha, "conflict"
    if prefix == "+":
        return sha, "pointer-moved"
    dcode, dout = git("status", "--porcelain", cwd=root / path)
    if dcode != 0:
        return sha, "unreadable"
    return (sha, "dirty-tree") if dout else (sha, "clean")


def read_stamp(sidecar_dir):
    """The sha the sidecar notes were last reviewed at, or None."""
    notes = sidecar_dir / "NOTES.md"
    if not notes.exists():
        return None
    for line in notes.read_text(encoding="utf-8").splitlines():
        if STAMP in line:
            val = line.split(STAMP, 1)[1].split("-->", 1)[0].strip()
            return None if val in ("", "unreviewed") else val
    return None


def drift_for(entry, pinned, state):
    """(verdict, distance) comparing sidecar stamp against the live pointer.

    MATCH      notes were reviewed at exactly this commit
    MOVED      pointer advanced N commits since the notes were reviewed
    UNREVIEWED no stamp yet
    n/a        no worktree to compare against (uninitialized)
    """
    sidecar = sidecar_dir(entry["path"])
    stamp = read_stamp(sidecar)
    if state == "uninit":
        return ("n/a" if stamp else "UNREVIEWED"), "0"
    if stamp is None:
        return "UNREVIEWED", "?"
    n = len(stamp)
    if pinned != "n/a" and stamp == pinned[:n]:
        return "MATCH", "0"
    code, out = git("rev-list", "--count", f"{stamp}..HEAD", cwd=root / entry["path"])
    if code != 0 or not out:
        # Stamp is not an ancestor: history was rewritten or the sha is wrong.
        return "UNKNOWN", "?"
    return "MOVED", out


entries = submodules()

# --review: stamp one sidecar's NOTES.md at the submodule's current sha.
if review:
    match = [e for e in entries if e["path"].strip("/") == review.strip("/")]
    if not match:
        print(f"fail: {review} is not a submodule in .gitmodules")
        sys.exit(1)
    e = match[0]
    if state_for(e)[1] == "uninit":
        raise SystemExit("fail: cannot review an uninitialized submodule")
    code, head = git("rev-parse", "HEAD", cwd=root / e["path"])
    if code != 0:
        print(f"fail: cannot read HEAD of {e['path']} (initialize it first)")
        sys.exit(1)
    notes = sidecar_dir(e["path"]) / "NOTES.md"
    if not notes.exists():
        print(f"fail: {notes} does not exist (run submodules.sh first)")
        sys.exit(1)
    text = notes.read_text(encoding="utf-8")
    new_line = f"{STAMP} {head[:12]} -->"
    if STAMP in text:
        text = re.sub(re.escape(STAMP) + r"[^>]*-->", new_line, text, count=1)
    else:
        text = text.rstrip() + "\n\n" + new_line + "\n"
    notes.write_text(text, encoding="utf-8")
    print(f"ok: stamped {notes} at {head[:12]}")
    sys.exit(0)


def read_manual(text):
    """Preserve hand-written Why/Boundary keyed by path."""
    manual = {}
    if BEGIN not in text:
        return manual
    block = text.split(BEGIN, 1)[1].split(END, 1)[0]
    for line in block.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 7:
            continue
        path = cells[0].strip("`")
        if path in ("Path", "_none_", "------"):
            continue
        if set(cells[0]) <= set("-: "):
            continue
        # cols: path url pinned state notes-drift why boundary
        manual[path] = (cells[5], cells[6])
    return manual


register = root / "docs" / "SUBMODULES.md"
old = register.read_text(encoding="utf-8") if register.exists() else ""
manual = read_manual(old)

rows = [
    "| Path | URL | Pinned | State | Notes | Why | Boundary |",
    "|------|-----|--------|-------|-------|-----|----------|",
]
if not entries:
    rows.append("| _none_ | | | | | | |")
for e in entries:
    sha, state = state_for(e)
    verdict, dist = drift_for(e, sha, state)
    notes_cell = verdict if verdict != "MOVED" else f"MOVED +{dist}"
    why, boundary = manual.get(e["path"], ("_fill in_", "read-only"))
    rows.append(
        f"| `{e['path']}` | {e['url']} | `{sha}` | {state} | {notes_cell} | {why} | {boundary} |"
    )
block = BEGIN + "\n" + "\n".join(rows) + "\n" + END

if BEGIN in old and END in old:
    new = re.sub(
        re.escape(BEGIN) + r".*?" + re.escape(END), lambda _: block, old, flags=re.S
    )
else:
    header = (
        old.rstrip() + "\n\n"
        if old.strip()
        else (
            "# Submodules\n\n"
            "Generated by `tooling/agent-kit/submodules.sh` from `.gitmodules`.\n"
            "Submodules are **foreign repositories**. Never write inside one.\n\n"
            "`Notes` compares each sidecar's reviewed-at stamp to the live pointer:\n"
            "`MATCH` = notes verified at this commit. `MOVED +N` = the pointer moved N\n"
            "commits since anyone re-read them, so treat the sidecar as suspect.\n"
            "`UNREVIEWED` = never stamped. Re-read, then\n"
            "`tooling/agent-kit/submodules.sh --review <path>`.\n\n"
        )
    )
    new = header + block + "\n"

stale = new != old
if check_only:
    if stale:
        print("fail: docs/SUBMODULES.md is out of date (run tooling/agent-kit/submodules.sh)")
        sys.exit(1)
    print("ok: docs/SUBMODULES.md current")
    sys.exit(0)

register.parent.mkdir(parents=True, exist_ok=True)
if stale:
    register.write_text(new, encoding="utf-8")
    print(f"wrote {register}")
else:
    print(f"current {register}")

# Original record templates; knowledge_scaffold owns the indexes and memory loop.
if entries and tpl_dir:
    tdir = Path(tpl_dir)
    for e in entries:
        dest_dir = sidecar_dir(e["path"])
        for out_name, tpl_name in SIDECARS.items():
            tpl = tdir / tpl_name
            if not tpl.exists():
                continue
            dest = dest_dir / out_name
            if dest.exists():
                continue
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest.write_text(
                tpl.read_text(encoding="utf-8")
                .replace("{{SUBMODULE_NAME}}", e["name"])
                .replace("{{SUBMODULE_PATH}}", e["path"]),
                encoding="utf-8",
            )
            print(f"wrote {dest}")

# Editor discovery: submodules are invisible in VS Code's source-control view
# until listed. Only touch this one key, and only when the user already keeps a
# settings.json — we do not impose an editor on a repo that has not chosen one.
vscode = root / ".vscode" / "settings.json"
if entries and vscode.exists():
    import json

    try:
        settings = json.loads(vscode.read_text(encoding="utf-8"))
        if not isinstance(settings, dict):
            raise ValueError("settings.json is not an object")
    except (OSError, ValueError) as exc:
        print(f"warn: cannot read {vscode} ({exc}); skipping editor sync")
    else:
        want = [e["path"] for e in entries]
        have = settings.get("git.scanRepositories", [])
        if not isinstance(have, list) or any(not isinstance(p, str) for p in have):
            print("warn: git.scanRepositories is not a string array; skipping editor sync")
        else:
            # Preserve the user's order for entries that are still real, then
            # append what is missing. Drops only paths no longer in .gitmodules.
            kept = list(dict.fromkeys(p for p in have if p in want))
            merged = kept + [p for p in want if p not in kept]
            if merged != have:
                settings["git.scanRepositories"] = merged
                vscode.write_text(
                    json.dumps(settings, indent=2) + "\n", encoding="utf-8"
                )
                print(f"synced git.scanRepositories in {vscode} ({len(merged)} submodules)")
            else:
                print(f"current {vscode} git.scanRepositories")
PY
