#!/usr/bin/env python3
"""Check repository and submodule knowledge in working files or the staged snapshot."""

import argparse
import datetime
import posixpath
import re
import sys

sys.dont_write_bytecode = True
from knowledge_layout import CONFIG, HUB, RECORDS, Tree, resolve
from knowledge_links import check_links, links
from repository_knowledge import validate as validate_repository
from knowledge_context import POLICY, TAG_POLICY, reviewed, validate_tags, validate as validate_context


def validate(tree):
    data = resolve(tree)
    modules = tree.modules()
    gitlinks = {p: oid for p, (mode, oid) in tree.entries.items() if mode == "160000"}
    if set(modules) != set(gitlinks):
        raise ValueError(".gitmodules and index gitlinks differ")
    errors = validate_repository(tree, data["sidecars"])
    if not modules:
        return errors

    def require(ok, message):
        if not ok:
            errors.append(message)

    today = datetime.date.today().isoformat()
    mapping = data["sidecars"]
    require(bool(tree.read(HUB)), f"missing {HUB}")
    for module, base in mapping.items():
        paths = [f"{base}/{name}" for name in ("AGENTS.md", *RECORDS)]
        daily = sorted(p for p in tree.paths if p.startswith(base + "/daily/")
                       and re.fullmatch(r"\d{4}-\d{2}-\d{2}\.md", p.rsplit("/", 1)[-1]))
        for p in paths:
            require(bool(tree.read(p).strip()), f"{p}: missing/empty")
        require(any(tree.read(p).strip() for p in daily), f"{base}: missing dated daily log")
        for name in ("AGENTS.md", "MEMORY.md"):
            targets = links(tree.read(f"{base}/{name}"))
            for record in ("AGENTS.md", *RECORDS):
                if record != name:
                    require(record in targets, f"{base}/{name}: missing index link {record}")
            require(any(t.rstrip("/") == "daily" or t.startswith("daily/") for t in targets),
                    f"{base}/{name}: missing daily index")
        hub_targets = {posixpath.normpath(posixpath.join(posixpath.dirname(HUB), p)) for p in links(tree.read(HUB))}
        require(f"{base}/AGENTS.md" in hub_targets, f"{HUB}: missing navigation for {module}")
        errors.extend(check_links(tree, paths + daily + [HUB]))
        previous = tree.git("ls-tree", "HEAD", "--", module, optional=True).split()
        old = previous[2] if len(previous) >= 3 else "absent"
        new = gitlinks[module]
        if not tree.index and (tree.root / module / ".git").exists():
            new = tree.git("-C", module, "rev-parse", "HEAD").strip()
        bumped = old != new
        # Legacy adoption with an unchanged pointer requires honest daily review,
        # not a pretend review of an uninitialized child.
        touched = any(tree.changed(p) for p in paths + daily)
        if not bumped and not touched:
            continue
        log = f"{base}/daily/{today}.md"
        text = tree.read(log)
        require(bool(text.strip()) and tree.changed(log), f"{module}: update today's daily evidence: {log}")
        if POLICY in tree.read(HUB) or POLICY in tree.before(HUB):
            errors.extend(validate_context(tree, log, module, current=True))
        if TAG_POLICY in tree.read(HUB) or TAG_POLICY in tree.before(HUB):
            errors.extend(validate_tags(tree, log))
        tagged = TAG_POLICY in tree.read(HUB) or TAG_POLICY in tree.before(HUB)
        def declared(marker):
            return reviewed(tree, log, marker) if tagged else marker in text
        require(tree.changed(f"{base}/MEMORY.md") or (not bumped and declared("Memory: reviewed; unchanged.")),
                f"{module}: refresh MEMORY.md or record unchanged-memory review")
        if bumped:
            require(old[:12] in text and new[:12] in text, f"{log}: record {old[:12]} -> {new[:12]}")
            notes = f"{base}/NOTES.md"
            require(tree.changed(notes) and bool(re.search(r"<!-- agent-kit:reviewed-at: " + re.escape(new[:12]) + r"(?:" + re.escape(new[12:]) + r")?\s*-->", tree.read(notes))),
                    f"{notes}: update and review at {new[:12]}")
            for title, name, marker in (("Lessons", "LESSONS.md", "lessons"), ("Decisions", "DECISIONS.md", "decisions")):
                require(tree.changed(f"{base}/{name}") or declared(f"{title}: reviewed; no new {marker}."),
                        f"{module}: review {name} in today's evidence")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--index", action="store_true")
    args = parser.parse_args()
    try:
        errors = validate(Tree(args.root, args.index))
    except (ValueError, OSError, KeyError, TypeError) as exc:
        errors = [str(exc)]
    for error in errors:
        print(f"fail: knowledge: {error}", file=sys.stderr)
    if not errors:
        print(f"knowledge: passed ({'staged snapshot' if args.index else 'working tree'})")
    return bool(errors)


if __name__ == "__main__":
    sys.exit(main())
