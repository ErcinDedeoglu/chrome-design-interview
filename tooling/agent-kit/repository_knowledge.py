"""Install and verify the owned repository's knowledge, independent of submodules."""

import datetime
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
from knowledge_layout import RECORDS, Tree, overlaps, resolve, safe_path
from knowledge_links import check_links, links
from knowledge_context import POLICY, TAG_POLICY, RULES, render, entry_tag, reviewed, validate_tags, validate as validate_context
from project_layout import load as load_projects, owners
import project_knowledge

BASE = "memory"
INDEXES = ("AGENTS.md", "MEMORY.md")
RECORD_PATHS = [f"{BASE}/{name}" for name in ("AGENTS.md", *RECORDS)]
OWNED_PATHS = RECORD_PATHS + [f"{BASE}/{name}" for name in ("daily", "lessons", "patterns", "templates")]


def conflicts(path):
    return any(overlaps(owned, path) for owned in OWNED_PATHS)


def managed(text, tag, body):
    begin, end = f"<!-- agent-kit:{tag}:begin -->", f"<!-- agent-kit:{tag}:end -->"
    if text.count(begin) != text.count(end) or text.count(begin) > 1:
        raise ValueError(f"malformed managed block: {tag}")
    block = begin + "\n" + body.rstrip() + "\n" + end
    if begin in text:
        if text.index(begin) > text.index(end):
            raise ValueError(f"reversed managed block: {tag}")
        return re.sub(re.escape(begin) + r".*?" + re.escape(end), lambda _: block, text, flags=re.S)
    return text.rstrip() + "\n\n" + block + "\n"


def scaffold(root, assets):
    tree = Tree(root)
    # Validate before writing; this is owned knowledge, never a foreign sidecar.
    data = resolve(tree, discover=True)
    load_projects(tree, data["sidecars"])
    for path in [*tree.modules(), *data["sidecars"].values()]:
        if conflicts(path):
            raise ValueError(f"repository memory overlaps submodule knowledge: {path}")
    paths = ["AGENTS.md", *RECORD_PATHS]
    for path in paths:
        safe_path(tree.root, path)
    writes = {}
    for path in RECORD_PATHS:
        name = Path(path).name
        template = Path(assets) / "repository" / name
        if not (tree.root / path).exists() and template.is_file():
            writes[path] = template.read_text()
    for name in INDEXES:
        path = f"{BASE}/{name}"
        body = "\n".join(f"- [{record}]({record})" for record in ("AGENTS.md", *RECORDS) if record != name)
        body += "\n- [Daily evidence](daily/)\n- [Lesson files](lessons/)\n- [Patterns](patterns/)\n- [Templates](templates/)"
        writes[path] = managed(writes.get(path, tree.read(path)), "repository-index", body)
    path = f"{BASE}/AGENTS.md"
    writes[path] = managed(writes.get(path, tree.read(path)), "context-policy", RULES)
    root_text = tree.read("AGENTS.md")
    chain = re.search(r"^## Chain\s*\n(.*?)(?=^## |\Z)", root_text, re.M | re.S)
    if not chain:
        raise ValueError("AGENTS.md: add a valid ## Chain before installing repository knowledge")
    if "`memory/AGENTS.md`" not in chain.group(1):
        body = chain.group(1).replace("- Down: (none)", "").rstrip() + "\n- Down: `memory/AGENTS.md`\n\n"
        root_text = root_text[:chain.start(1)] + body + root_text[chain.end(1):]
    writes["AGENTS.md"] = root_text
    project_knowledge.scaffold(tree, assets, data["sidecars"], writes, managed)
    today = datetime.date.today().isoformat()
    # Adoption is an observed install event, never a fabricated product review.
    if not any((tree.root / BASE / "daily").glob("????-??-??.md")):
        path = f"{BASE}/daily/{today}.md"
        safe_path(tree.root, path)
        writes[path] = f"# {today}\n\n" + render(tree) + f"\n- {entry_tag(tree)} Installed repository knowledge records; product review pending.\n"
    for path, text in writes.items():
        dest = tree.root / path
        if not dest.exists() or dest.read_text() != text:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text)


def validate(tree, mapping):
    # Standalone submodule tooling is supported. An installed kit cannot opt out
    # by deleting its records from the proposed commit.
    installed = "tooling/agent-kit/check.sh"
    if not any(tree.read(p) or tree.before(p) for p in (installed, "memory/AGENTS.md")):
        return []
    for path in [*tree.modules(), *mapping.values()]:
        if conflicts(path):
            return [f"repository memory overlaps submodule knowledge: {path}"]
    errors = []

    def require(ok, message):
        if not ok:
            errors.append(message)

    daily = sorted(p for p in tree.paths if re.fullmatch(r"memory/daily/\d{4}-\d{2}-\d{2}\.md", p))
    if not tree.index:
        daily = sorted(str(p.relative_to(tree.root)) for p in (tree.root / BASE / "daily").glob("????-??-??.md"))
    for path in RECORD_PATHS:
        require(bool(tree.read(path).strip()), f"{path}: missing/empty repository record")
    require(any(tree.read(p).strip() for p in daily), "memory: missing dated daily log")
    require("`memory/AGENTS.md`" in tree.read("AGENTS.md"), "AGENTS.md: missing repository knowledge chain pointer")
    for name in INDEXES:
        targets = links(tree.read(f"{BASE}/{name}"))
        for record in ("AGENTS.md", *RECORDS):
            if record != name:
                require(record in targets, f"memory/{name}: missing index link {record}")
        for folder in ("daily", "lessons", "patterns", "templates"):
            require(any(t.rstrip("/") == folder for t in targets), f"memory/{name}: missing {folder} index")
    errors.extend(check_links(tree, RECORD_PATHS + daily))

    # Empty folders may be scaffolded before git init. Structural checks still
    # apply, but there is no staged snapshot or previous revision to compare yet.
    if not tree.index and not tree.git("rev-parse", "--is-inside-work-tree", optional=True).strip():
        errors.extend(project_knowledge.validate(tree, mapping, set()))
        return errors

    if tree.git("rev-parse", "--verify", "HEAD", optional=True).strip():
        args = ["diff", "--name-only", "-z", "--no-renames"]
        if tree.index:
            args.append("--cached")
        changed = set(filter(None, tree.git(*args, "HEAD", "--").split("\0")))
    else:
        changed = set(tree.paths)
    if not tree.index:
        changed.update(filter(None, tree.git("ls-files", "--others", "--exclude-standard", "-z").split("\0")))
    projects = load_projects(tree, mapping)
    previous_projects = load_projects(tree, mapping, previous=True)
    errors.extend(project_knowledge.validate(tree, mapping, changed))
    # Do not demand duplicate repository logs for sidecar-only work or generated
    # checker reports. Owned source, docs, config and knowledge changes do count.
    excluded = [*tree.modules(), *mapping.values(), "tooling/agent-kit/log"]
    generated = {"tooling/agent-kit/STATUS.md", "tooling/agent-kit/status.json",
                 "tooling/agent-kit/last-steer.md", "tooling/agent-kit/last.json",
                 "docs/submodules/AGENTS.md", "docs/SUBMODULES.md"}
    relevant = {p for p in changed if p not in generated and not any(p == d or p.startswith(d + "/") for d in excluded)
                and not owners(p, projects) and not owners(p, previous_projects)}
    if relevant:
        today = datetime.date.today().isoformat()
        log = f"memory/daily/{today}.md"
        text = tree.read(log)
        require(bool(text.strip()) and tree.changed(log), f"repository: update today's daily evidence: {log}")
        if POLICY in tree.read("memory/AGENTS.md") or POLICY in tree.before("memory/AGENTS.md"):
            errors.extend(validate_context(tree, log, current=True))
            if TAG_POLICY in tree.read("memory/AGENTS.md") or TAG_POLICY in tree.before("memory/AGENTS.md"):
                errors.extend(validate_tags(tree, log))
            for path in sorted(tree.paths):
                if (path.startswith(("memory/lessons/", "memory/patterns/"))
                        and path.endswith(".md") and tree.changed(path) and tree.read(path).strip()):
                    errors.extend(validate_context(tree, path))
        for title, name, marker in (("Memory", "MEMORY.md", "unchanged"),
                                    ("Lessons", "LESSONS.md", "no new lessons"),
                                    ("Decisions", "DECISIONS.md", "no new decisions")):
            tagged = TAG_POLICY in tree.read("memory/AGENTS.md") or TAG_POLICY in tree.before("memory/AGENTS.md")
            declaration = f"{title}: reviewed; {marker}."
            require(tree.changed(f"memory/{name}") or (reviewed(tree, log, declaration) if tagged else declaration in text),
                    f"repository: review {name} in today's evidence or update the record")
    return errors


if __name__ == "__main__":
    try:
        scaffold(sys.argv[1], sys.argv[2])
    except (ValueError, OSError) as exc:
        raise SystemExit(f"fail: repository knowledge: {exc}")
