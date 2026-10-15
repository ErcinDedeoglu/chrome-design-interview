#!/usr/bin/env python3
"""AGENTS.md chain gate. Fail closed. No network. No opt-out."""

import fnmatch
import json
import os
import subprocess
import sys

CROWD_THRESHOLD = 8

KIT_ROOTS = {
    "docs",
    "memory",
    "openspec",
    "tooling",
    ".github",
    ".opencode",
    ".claude",
    ".githooks",
}
SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    ".turbo",
    ".git",
    "target",
    "vendor",
    "vendors",
    "vendored",
    "third_party",
    "external",
    "generated",
    ".tools",
}

# Quality's committed exclusion list. Exact repo-relative paths, trailing-slash
# directory names, and shell-style globs; negation unsupported. This is the
# authoritative signal that a tree is not ours to gate — several repos already ship
# one with `vendor/` in it, and a `.qualityignore` entry is a human decision the
# audit still re-checks, unlike a `.gitmodules` entry which is structural.
QUALITY_IGNORE = ".qualityignore"
FAIL_CLOSED_OWNERS = {"vendor", "vendors", "vendored", "third_party", "external", "generated"}
SKIP_FILES = {"AGENTS.md", "CLAUDE.md", "GEMINI.md", ".gitkeep"}

# The quality control dir holds `size-baseline.json` and
# `cohesion-reviews.json` — control data, not product. But a product folder could
# legitimately be named `quality/`, so it only counts as a kit dir once the contract
# that owns it exists. Keyed by the top-level dir, then the marker that proves the
# kit is installed. Never blanket-skip a name a product might use.
CONDITIONAL_KIT_ROOTS = {"quality": "docs/QUALITY.md"}
conditional_kit_roots = set()
sidecar_roots = set()
INDEX_ONLY = False


def detect_kit_roots(root):
    global conditional_kit_roots, sidecar_roots
    config = "tooling/agent-kit/knowledge.json"
    if INDEX_ONLY:
        r = run(["git", "-C", root, "show", f":{config}"])
        text = r.stdout.decode() if r.returncode == 0 else ""
    else:
        path = os.path.join(root, config)
        text = open(path).read() if os.path.isfile(path) else ""
    try:
        sidecar_roots = set(json.loads(text).get("sidecars", {}).values()) if text else set()
    except (ValueError, TypeError, AttributeError):
        fail("invalid knowledge.json")
        sidecar_roots = set()
    conditional_kit_roots = {
        name
        for name, marker in CONDITIONAL_KIT_ROOTS.items()
        if os.path.isfile(os.path.join(root, marker))
    }
    return conditional_kit_roots

fails = []


def fail(msg):
    fails.append(msg)
    print(f"fail: {msg}", file=sys.stderr)


def ok(msg):
    print(f"ok: {msg}")


def run(cmd):
    return subprocess.run(cmd, capture_output=True)


def is_git(root):
    r = run(["git", "-C", root, "rev-parse", "--is-inside-work-tree"])
    return r.returncode == 0 and r.stdout.strip() == b"true"


def submodule_paths(root):
    gm = os.path.join(root, ".gitmodules")
    if INDEX_ONLY:
        result = run(["git", "-C", root, "show", ":.gitmodules"])
        text = result.stdout.decode() if result.returncode == 0 else ""
    else:
        text = open(gm).read() if os.path.isfile(gm) else ""
    result = subprocess.run(["git", "config", "--null", "--file", "-", "--get-regexp",
                             r"^submodule\..*\.path$"], input=text, capture_output=True, text=True)
    if result.returncode not in (0, 1):
        fail("invalid .gitmodules")
    return [row.split("\n", 1)[1] for row in result.stdout.split("\0") if row]


def parse_stage(root):
    files = []
    subs = list(submodule_paths(root))
    r = run(["git", "-C", root, "ls-files", "-z", "--stage"])
    if r.returncode != 0:
        return files, subs
    for rec in r.stdout.split(b"\0"):
        if not rec or b"\t" not in rec:
            continue
        meta, path = rec.split(b"\t", 1)
        mode = meta.split(b" ", 1)[0].decode()
        rel = path.decode("utf-8", "surrogateescape").replace("\\", "/").strip("/")
        if mode == "160000":
            subs.append(rel)
        else:
            files.append(rel)
    return files, subs


def list_others(root):
    r = run(["git", "-C", root, "ls-files", "-z", "--others", "--exclude-standard"])
    if r.returncode != 0:
        return []
    out = []
    for rec in r.stdout.split(b"\0"):
        if not rec:
            continue
        out.append(rec.decode("utf-8", "surrogateescape").replace("\\", "/").strip("/"))
    return out


def walk_files(root):
    out = []
    if os.path.isfile(os.path.join(root, "memory/AGENTS.md")):
        out.append("memory/AGENTS.md")
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        kept = []
        for name in dirnames:
            rel = name if not rel_dir else f"{rel_dir}/{name}"
            if skipped_path(rel) or os.path.islink(os.path.join(dirpath, name)):
                continue
            kept.append(name)
        dirnames[:] = kept
        for name in filenames:
            rel = name if not rel_dir else f"{rel_dir}/{name}"
            if not skipped_path(rel):
                out.append(rel)
    return out


def under_submodule(rel, subs):
    for sm in subs:
        if rel == sm or rel.startswith(sm + "/"):
            return True
    return False


ignore_patterns = []


def load_quality_ignore(root):
    """Read the repo's own exclusion declarations. Fail closed on a malformed line:
    a pattern we cannot parse is a pattern that silently stops gating a tree."""
    global ignore_patterns
    path = os.path.join(root, QUALITY_IGNORE)
    if not os.path.isfile(path):
        return []
    patterns = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith("!") or stripped.startswith("/") or ".." in stripped.split("/"):
                fail(
                    f"{QUALITY_IGNORE}:{lineno} unsafe or unsupported pattern '{stripped}' "
                    "(only relative paths, dir names, and globs; no negation)"
                )
                continue
            patterns.append(stripped)
    ignore_patterns = patterns
    return patterns


def is_ignored(rel):
    """True when the repo has declared this path not ours to gate."""
    if not ignore_patterns:
        return False
    parts = rel.split("/")
    for pat in ignore_patterns:
        core = pat.rstrip("/")
        if not core:
            continue
        if "/" in core:
            if rel == core or rel.startswith(core + "/") or fnmatch.fnmatch(rel, core):
                return True
        elif core in parts:
            return True
        elif fnmatch.fnmatch(parts[-1], core):
            return True
    return False


def ignored_owner(rel):
    """The declared exclusion that owns this path, when it means 'not ours'."""
    if not ignore_patterns:
        return None
    parts = rel.split("/")
    for pat in ignore_patterns:
        core = pat.rstrip("/")
        if "/" in core:
            if rel == core or rel.startswith(core + "/") or fnmatch.fnmatch(rel, core):
                hit = core
            else:
                continue
        elif core in parts or fnmatch.fnmatch(parts[-1], core):
            hit = core
        else:
            continue
        for part in parts:
            if part in FAIL_CLOSED_OWNERS or part in SKIP_DIRS:
                return hit
        return None
    return None


def skipped_path(rel):
    if not rel:
        return False
    parts = rel.split("/")
    if any(rel == p or rel.startswith(p + "/") for p in sidecar_roots):
        return True
    if parts[0] in KIT_ROOTS or parts[0] in conditional_kit_roots:
        return True
    for part in parts:
        if part in SKIP_DIRS or part.startswith(".") or part.endswith(".agent"):
            return True
    return False


ADAPTER_NAMES = {"CLAUDE.md", "GEMINI.md", "claude.md", "gemini.md"}


def nested_adapters(root):
    found = []
    _, subs = parse_stage(root)
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        rel = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel == ".":
            rel = ""
        dirnames[:] = [
            name
            for name in dirnames
            if name != ".git" and not os.path.islink(os.path.join(dirpath, name))
            and not under_submodule(f"{rel}/{name}" if rel else name, subs)
            and not is_ignored(f"{rel}/{name}" if rel else name)
        ]
        if rel == "":
            continue
        for name in filenames:
            if name in ADAPTER_NAMES and not is_ignored(f"{rel}/{name}"):
                found.append(f"{rel}/{name}")
    return found


def dirname(rel):
    if "/" not in rel:
        return ""
    return rel.rsplit("/", 1)[0]


def basename(rel):
    return rel.rsplit("/", 1)[-1]


def eligible_dir(rel, subs):
    if rel == "":
        return True
    if skipped_path(rel) or under_submodule(rel, subs):
        return False
    return True


def collect(root, index_only):
    subs = submodule_paths(root)
    if is_git(root):
        files, subs = parse_stage(root)
        subs = list(dict.fromkeys(subs))
        if not index_only:
            files = files + list_others(root)
    else:
        files = walk_files(root)
    cleaned = []
    for rel in files:
        rel = rel.replace("\\", "/").strip("/")
        explicit = basename(rel) == "AGENTS.md" and (rel.startswith(("docs/", "memory/")) or
                   any(rel.startswith(p + "/") for p in sidecar_roots))
        if not rel or under_submodule(rel, subs) or (skipped_path(rel) and not explicit) or is_ignored(rel):
            continue
        cleaned.append(rel)
    return cleaned, subs


def ignored(root, rel):
    if not is_git(root):
        return False
    return run(["git", "-C", root, "check-ignore", "-q", "--", rel]).returncode == 0


def rel_link(from_dir, target):
    start = from_dir if from_dir else "."
    return os.path.relpath(target, start).replace("\\", "/")


def resolve_link(from_dir, link):
    link = link.strip().replace("\\", "/")
    if not link or link.startswith("/") or link.startswith("~"):
        return None
    base = from_dir.split("/") if from_dir else []
    parts = []
    for comp in link.split("/"):
        if comp in ("", "."):
            continue
        if comp == "..":
            if parts:
                parts.pop()
            elif base:
                base.pop()
            else:
                return None
        else:
            parts.append(comp)
    return "/".join(base + parts)


def parse_chain(text):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    starts = [i for i, line in enumerate(lines) if line.strip() == "## Chain"]
    if not starts:
        return None
    if len(starts) > 1:
        return {"error": "more than one ## Chain section"}
    body = []
    for line in lines[starts[0] + 1 :]:
        if line.startswith("## "):
            break
        body.append(line.strip())
    up = None
    downs = []
    none_down = False
    illegal = []
    for line in body:
        if not line:
            continue
        if line == "- Up: (root)":
            if up is not None:
                illegal.append("duplicate Up")
            up = "(root)"
        elif line.startswith("- Up: `") and line.endswith("`") and line.count("`") == 2:
            if up is not None:
                illegal.append("duplicate Up")
            up = line[len("- Up: `") : -1]
        elif line == "- Down: (none)":
            none_down = True
        elif line.startswith("- Down: `") and line.endswith("`") and line.count("`") == 2:
            downs.append(line[len("- Down: `") : -1])
        else:
            illegal.append(line)
    return {"up": up, "downs": downs, "none": none_down, "illegal": illegal}


def read_agents(root, rel_dir):
    path = os.path.join(root, rel_dir, "AGENTS.md") if rel_dir else os.path.join(root, "AGENTS.md")
    if INDEX_ONLY:
        rel = f"{rel_dir}/AGENTS.md" if rel_dir else "AGENTS.md"
        result = run(["git", "-C", root, "show", f":{rel}"])
        return result.stdout.decode("utf-8") if result.returncode == 0 else None
    if not os.path.isfile(path) or os.path.islink(path) and not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def agents_rel(rel_dir):
    return "AGENTS.md" if rel_dir == "" else f"{rel_dir}/AGENTS.md"


def expected_fix(from_dir, parent, children):
    if parent is None:
        up = "- Up: (root)"
    else:
        up = f"- Up: `{rel_link(from_dir, agents_rel(parent))}`"
    lines = ["## Chain", up]
    if not children:
        lines.append("- Down: (none)")
    else:
        for child in sorted(children, key=lambda c: rel_link(from_dir, agents_rel(c))):
            lines.append(f"- Down: `{rel_link(from_dir, agents_rel(child))}`")
    return lines


def parent_of(rel, required):
    if rel == "":
        return None
    parts = rel.split("/")
    for i in range(len(parts) - 1, -1, -1):
        anc = "/".join(parts[:i])
        if anc in required:
            return anc
    return ""


def build(files, subs, extra=None):
    file_set = list(files)
    if extra and extra not in file_set:
        file_set.append(extra)
    agents_dirs = set()
    direct_files = {}
    child_dirs = {}
    for rel in file_set:
        if basename(rel) == "AGENTS.md":
            agents_dirs.add(dirname(rel))
        if basename(rel) in SKIP_FILES or basename(rel).startswith("."):
            continue
        if skipped_path(rel) or under_submodule(rel, subs):
            continue
        parent = dirname(rel)
        direct_files[parent] = direct_files.get(parent, 0) + 1
        parts = rel.split("/")
        acc = ""
        for comp in parts[:-1]:
            child_dirs.setdefault(acc, set()).add(comp)
            acc = comp if not acc else f"{acc}/{comp}"
    return agents_dirs, direct_files, child_dirs


def crowd_of(rel, direct_files, child_dirs):
    return direct_files.get(rel, 0) + len(child_dirs.get(rel, ()))


def threshold_from_args(argv):
    if "--threshold" not in argv:
        return CROWD_THRESHOLD
    if os.environ.get("AGENT_KIT_CHAIN_TEST") != "1":
        fail("--threshold is not a bypass")
        return None
    i = argv.index("--threshold")
    if i + 1 >= len(argv):
        fail("--threshold needs a number")
        return None
    try:
        n = int(argv[i + 1])
    except ValueError:
        fail("--threshold needs a number")
        return None
    if n < 1:
        fail("--threshold must be ≥ 1")
        return None
    return n
