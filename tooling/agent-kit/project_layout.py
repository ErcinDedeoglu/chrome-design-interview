"""Explicit owned-project routing; submodule sidecars keep their existing mapping."""

import argparse
import json
import re
import sys

sys.dont_write_bytecode = True
from knowledge_layout import Tree, overlaps, resolve, safe_path

CONFIG = "tooling/agent-kit/projects.json"
HUB = "memory/projects/AGENTS.md"


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate project mapping key: {key}")
        result[key] = value
    return result


def load(tree, sidecars, previous=False):
    raw = tree.before(CONFIG) if previous else tree.read(CONFIG)
    if not raw:
        if not previous and (CONFIG in tree.paths or tree.before(CONFIG)):
            raise ValueError(f"{CONFIG}: missing/empty mapping; do not discard project ownership")
        return {}
    data = json.loads(raw, object_pairs_hook=unique_object)
    if (not isinstance(data, dict) or set(data) != {"version", "projects"}
            or type(data["version"]) is not int or data["version"] != 1
            or not isinstance(data["projects"], dict)):
        raise ValueError(f"{CONFIG}: expected version 1 and projects")
    projects = data["projects"]
    if projects and any(overlaps(HUB, p) for p in [*tree.modules(), *sidecars.values()]):
        raise ValueError("project knowledge hub overlaps a foreign integration")
    sources, destinations = [], []
    protected = ("memory", "tooling/agent-kit", ".githooks", ".gitmodules", "AGENTS.md",
                 "docs/QUALITY.md", "docs/GROWTH.md", "docs/SUBMODULES.md", "docs/submodules/AGENTS.md")
    for name, entry in projects.items():
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
            raise ValueError(f"invalid project identity: {name}")
        if (not isinstance(entry, dict) or set(entry) != {"paths", "memory"}
                or not isinstance(entry["paths"], list) or not entry["paths"]):
            raise ValueError(f"{name}: expected nonempty paths and memory")
        dest = safe_path(tree.root, entry["memory"])
        if not dest.startswith("memory/projects/") or overlaps(dest, HUB):
            raise ValueError(f"{name}: memory must be a dedicated directory under memory/projects/")
        current = tree.root
        for part in dest.split("/"):
            current /= part
            if current.exists() and not current.is_dir():
                raise ValueError(f"{name}: project memory is not a directory: {dest}")
        if any(overlaps(dest, p) for p in [*tree.modules(), *sidecars.values(), *destinations]):
            raise ValueError(f"{name}: colliding project memory: {dest}")
        destinations.append(dest)
        for path in entry["paths"]:
            safe_path(tree.root, path)
            if any(overlaps(path, p) for p in protected) or any(
                    path == sm or path.startswith(sm + "/") for sm in [*tree.modules(), *sidecars.values()]):
                raise ValueError(f"{name}: source path is reserved or foreign: {path}")
            if any(overlaps(path, p) for p in sources):
                raise ValueError(f"{name}: ambiguous/duplicate project source ownership: {path}")
            sources.append(path)
    if not previous:
        before = load(tree, sidecars, previous=True)
        if set(before) - set(projects):
            raise ValueError("removed projects require explicit archive/mapping migration; preserve their mapping")
    return projects


def owners(path, projects):
    """Exact file or directory-prefix ownership; unmapped paths stay root/shared."""
    return {name for name, entry in projects.items()
            if any(path == p or path.startswith(p + "/") for p in [entry["memory"], *entry["paths"]])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--bases", action="store_true")
    args = parser.parse_args()
    try:
        tree = Tree(args.root)
        projects = load(tree, resolve(tree, discover=True)["sidecars"])
        if args.bases:
            for entry in projects.values():
                print(entry["memory"])
        else:
            print(json.dumps(projects, indent=2))
    except (ValueError, OSError, TypeError) as exc:
        raise SystemExit(str(exc))
