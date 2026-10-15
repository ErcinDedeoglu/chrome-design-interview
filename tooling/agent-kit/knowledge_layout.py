"""Portable sidecar ownership: one committed mapping for generator and gates."""

import json
import os
from pathlib import Path, PurePosixPath
import subprocess

CONFIG = "tooling/agent-kit/knowledge.json"
RECORDS = ("NOTES.md", "RUNBOOK.md", "STEERS.md", "HISTORY.md",
           "MEMORY.md", "LESSONS.md", "DECISIONS.md")
HUB = "docs/submodules/AGENTS.md"


class Tree:
    def __init__(self, root, index=False):
        self.root = Path(root).resolve()
        self.index = index
        self.env = dict(os.environ)
        # Preserve an alternate index: it is the actual proposed commit.
        for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_PREFIX"):
            self.env.pop(key, None)
        self.entries = {}
        for row in self.git("ls-files", "--stage", "-z", optional=True).split("\0"):
            if row:
                info, path = row.split("\t", 1)
                mode, oid, stage = info.split()
                if stage != "0":
                    raise ValueError(f"unmerged index: {path}")
                self.entries[path] = (mode, oid)
        self.paths = set(self.entries)
        if not index:
            self.paths.update(filter(None, self.git("ls-files", "--others",
                              "--exclude-standard", "-z", optional=True).split("\0")))

    def git(self, *args, optional=False):
        r = subprocess.run(["git", "-C", str(self.root), *args], env=self.env,
                           capture_output=True, text=True)
        if r.returncode and not optional:
            raise ValueError(r.stderr.strip() or f"git failed: {args}")
        return r.stdout if not r.returncode else ""

    def read(self, path):
        if self.index:
            entry = self.entries.get(path)
            return self.git("cat-file", "blob", entry[1]) if entry and entry[0] in {"100644", "100755"} else ""
        p = self.root / path
        safe_path(self.root, path)
        return p.read_text() if p.is_file() else ""

    def before(self, path):
        return self.git("show", f"HEAD:{path}", optional=True)

    def changed(self, path):
        return self.read(path) != self.before(path)

    def modules(self):
        text = self.read(".gitmodules")
        r = subprocess.run(["git", "config", "--null", "--file", "-", "--get-regexp",
                            r"^submodule\..*\.path$"], input=text, env=self.env,
                           capture_output=True, text=True)
        if r.returncode not in (0, 1):
            raise ValueError("invalid .gitmodules: " + r.stderr.strip())
        paths = [row.split("\n", 1)[1] for row in r.stdout.split("\0") if row]
        if len(paths) != len(set(paths)):
            raise ValueError("duplicate submodule paths")
        for path in paths:
            safe_path(self.root, path)
        return sorted(paths)


def safe_path(root, path):
    if not isinstance(path, str) or not path or str(PurePosixPath(path)) != path:
        raise ValueError(f"non-canonical path: {path!r}")
    if path.startswith(("/", "~")) or any(p in {".", "..", ".git"} for p in path.split("/")):
        raise ValueError(f"unsafe path: {path}")
    if any(c in path for c in "\n\r\t\\`|<>\0"):
        raise ValueError(f"unsupported path characters: {path!r}")
    p = Path(root)
    for part in path.split("/"):
        p /= part
        if p.is_symlink():
            raise ValueError(f"symlink in knowledge path: {path}")
    return path


def overlaps(a, b):
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


def resolve(tree, discover=False):
    modules = tree.modules()
    raw = tree.read(CONFIG)
    if not raw and (CONFIG in tree.paths or (not tree.index and (tree.root / CONFIG).exists())):
        raise ValueError(f"{CONFIG}: empty configuration")
    data = json.loads(raw) if raw else {"version": 1, "layout": "docs", "root": "docs/submodules", "sidecars": {}}
    if not isinstance(data, dict) or set(data) != {"version", "layout", "root", "sidecars"} or type(data["version"]) is not int or data["version"] != 1:
        raise ValueError(f"{CONFIG}: expected version, layout, root, sidecars (version 1)")
    if data["layout"] not in {"docs", "beside"} or not isinstance(data["sidecars"], dict):
        raise ValueError(f"{CONFIG}: invalid layout or sidecars")
    safe_path(tree.root, data["root"])
    if discover and not raw:
        preference = os.environ.get("AGENT_KIT_SIDECAR_LAYOUT") or tree.git(
            "config", "--get", "agentkit.sidecarlayout", optional=True).strip()
        if preference:
            if preference not in {"docs", "beside"}:
                raise ValueError("agentkit.sidecarlayout must be docs or beside")
            data["layout"] = preference
        else:
            beside = any((tree.root / (p + ".agent")).is_dir() for p in modules)
            central = any((tree.root / data["root"] / p.replace('/', '-')).is_dir() for p in modules)
            if beside and not central:
                data["layout"] = "beside"
    mapping = dict(data["sidecars"])
    orphaned = set(mapping) - set(modules)
    if orphaned:
        raise ValueError(f"{CONFIG}: removed submodules need explicit archive/mapping review: {sorted(orphaned)}")
    for path in modules:
        if path not in mapping:
            if not discover:
                raise ValueError(f"{CONFIG}: missing mapping for {path}; run submodules.sh")
            central = f"{data['root']}/{path.replace('/', '-')}"
            beside = path + ".agent"
            existing = [p for p in (central, beside) if (tree.root / p).exists()]
            if len(existing) > 1:
                raise ValueError(f"ambiguous sidecars for {path}: {existing}; map explicitly in {CONFIG}")
            mapping[path] = existing[0] if existing else (beside if data["layout"] == "beside" else central)
    for module, dest in mapping.items():
        safe_path(tree.root, dest)
        if any(overlaps(dest, sm) for sm in modules) or overlaps(dest, "tooling/agent-kit"):
            raise ValueError(f"sidecar overlaps protected tree: {module} -> {dest}")
        if dest in {"docs", "memory", "openspec"} or dest == str(Path(HUB).parent):
            raise ValueError(f"sidecar must have its own directory: {dest}")
        for other, other_dest in mapping.items():
            if other != module and overlaps(dest, other_dest):
                raise ValueError(f"sidecar collision: {module}, {other}; choose explicit distinct mappings")
    if modules and any(overlaps(str(Path(HUB).parent), sm) for sm in modules):
        raise ValueError("submodule overlaps the knowledge hub; choose a superproject kit layout first")
    data["sidecars"] = dict(sorted(mapping.items()))
    return data


if __name__ == "__main__":
    import sys
    try:
        tree = Tree(sys.argv[1])
        for module in tree.modules():
            if any(overlaps(module, p) for p in ("docs", "memory", "openspec", "tooling/agent-kit", ".githooks", ".github", ".opencode", ".claude")):
                raise ValueError(f"submodule {module} overlaps installed kit paths; choose a superproject layout before init")
        data = resolve(tree, discover=True)
        from project_layout import load as load_projects
        load_projects(tree, data["sidecars"])
        print(json.dumps(data, indent=2))
    except (ValueError, OSError, TypeError) as exc:
        raise SystemExit(f"fail: knowledge layout: {exc}")
