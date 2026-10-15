"""Create missing knowledge records; preserve authored bodies and history."""

import datetime
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote

sys.dont_write_bytecode = True
from knowledge_layout import CONFIG, HUB, RECORDS, Tree, resolve, safe_path
from knowledge_context import RULES, render, entry_tag


def link(source, target):
    return os.path.relpath(target, str(Path(source).parent)).replace(os.sep, "/")


def scaffold(root):
    tree = Tree(root)
    for path in (HUB, "docs/SUBMODULES.md", "AGENTS.md"):
        safe_path(tree.root, path)
    data = resolve(tree, discover=True)
    mapping = data["sidecars"]
    if not mapping and not tree.read(CONFIG):
        return data
    writes = {}

    def missing(path, text):
        safe_path(tree.root, path)
        if not (tree.root / path).exists():
            writes[path] = text

    missing(HUB, "# Submodule knowledge\n\n## Workflow\n\n"
            "Read the mapped AGENTS/MEMORY before integration work. Child-owned instructions govern child source.\n"
            "Capture evidence and unknowns in that sidecar's daily/YYYY-MM-DD.md; distill verified findings\n"
            "into LESSONS.md, choices with rationale and authority into DECISIONS.md, and refresh MEMORY.md.\n"
            "Before handoff, update NOTES/RUNBOOK when their facts change. Keep shared lessons in repository memory.\n"
            "Pointer changes require old/new 12-character SHAs, changed MEMORY/NOTES and a current reviewed-at stamp.\n"
            "Update LESSONS/DECISIONS or record `Lessons: reviewed; no new lessons.` and\n"
            "`Decisions: reviewed; no new decisions.` in today's changed log. Documentation-only work may use\n"
            "`Memory: reviewed; unchanged.` when accurate. Gates prove records, not truth or actual reading.\n"
            "Prefix new daily bullets and review markers with branch/revision tags from knowledge_context.py --entry-tag.\n"
            "Run `python3 tooling/agent-kit/knowledge-check.py --index` before committing.\n")
    today = datetime.date.today().isoformat()
    for module, dest in mapping.items():
        missing(f"{dest}/AGENTS.md", f"# Knowledge for {module}\n\n## Scope\n\n"
                f"This sidecar owns integration knowledge for `{module}`.\n"
                f"Follow the [capture and distillation workflow](<{quote(link(dest + '/AGENTS.md', HUB), safe='/.-')}>).\n"
                "Record only verified constraints; scaffolding does not establish implementation facts.\n")
        missing(f"{dest}/MEMORY.md", f"# Memory — {module}\n\nDistilled index; verify facts against code. No verified findings yet.\n")
        missing(f"{dest}/LESSONS.md", f"# Lessons — {module}\n\nNo verified lessons yet. Record Pattern-Key, evidence, confidence and reusable finding.\n")
        missing(f"{dest}/DECISIONS.md", f"# Decisions — {module}\n\nNo decisions recorded. Include rationale, alternatives, authority and evidence.\n")
        # An installation log is not a fabricated code review. Never append on reinstall.
        if not any((tree.root / dest / "daily").glob("????-??-??.md")):
            missing(f"{dest}/daily/{today}.md", f"# {today}\n\n" + render(tree, module) + f"\n- {entry_tag(tree)} Created missing integration knowledge records for `{module}`; code review pending.\n")

    def managed(path, tag, body):
        safe_path(tree.root, path)
        text = writes.get(path, tree.read(path))
        begin, end = f"<!-- agent-kit:{tag}:begin -->", f"<!-- agent-kit:{tag}:end -->"
        block = begin + "\n" + body.rstrip() + "\n" + end
        if (begin in text) != (end in text):
            raise ValueError(f"incomplete managed block in {path}")
        new = re.sub(re.escape(begin) + r".*?" + re.escape(end), lambda _: block, text, flags=re.S) if begin in text else text.rstrip() + "\n\n" + block + "\n"
        writes[path] = new

    managed(HUB, "context-policy", RULES)
    for module, dest in mapping.items():
        for name in ("AGENTS.md", "MEMORY.md"):
            targets = [f"{dest}/{n}" for n in ("AGENTS.md", *RECORDS) if n != name] + [f"{dest}/daily/"]
            managed(f"{dest}/{name}", "knowledge-index", "\n".join(
                f"- [{Path(p.rstrip('/')).name}](<{quote(link(dest + '/' + name, p), safe='/.-')}>)" for p in targets))
    managed(HUB, "knowledge-index", "\n".join(f"- [{sm}](<{quote(link(HUB, dest + '/AGENTS.md'), safe='/.-')}>)" for sm, dest in mapping.items()))
    # Join the nearest ancestor chain, preserving all unrelated chain entries.
    agents = {p for p in tree.paths if p == "AGENTS.md" or p.endswith("/AGENTS.md")}
    agents.update(p for p in writes if p.endswith("AGENTS.md"))
    agents = {p for p in agents if not any(p.startswith(sm + "/") for sm in mapping)}
    for path in [HUB, *(f"{d}/AGENTS.md" for d in mapping.values())]:
        parents = [p for p in agents if p != path and (p == "AGENTS.md" or path.startswith(str(Path(p).parent) + "/"))]
        parent = max(parents, key=len) if parents else "AGENTS.md"
        text = writes.get(path, tree.read(path))
        if "## Chain" not in text:
            writes[path] = text.rstrip() + f"\n\n## Chain\n\n- Up: `{link(path, parent)}`\n- Down: (none)\n"
        parent_text = writes.get(parent, tree.read(parent))
        down = f"- Down: `{link(parent, path)}`"
        match = re.search(r"^## Chain\s*\n(.*?)(?=^## |\Z)", parent_text, re.M | re.S)
        if not match:
            raise ValueError(f"{parent}: add a valid ## Chain before scaffolding sidecars")
        if down not in match.group(1).splitlines():
            body = match.group(1).replace("- Down: (none)", "").rstrip() + "\n" + down + "\n\n"
            writes[parent] = parent_text[:match.start(1)] + body + parent_text[match.end(1):]
    writes[CONFIG] = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    for path, text in writes.items():
        safe_path(tree.root, path)
        dest = tree.root / path
        if not dest.exists() or dest.read_text() != text:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text)
    return data


if __name__ == "__main__":
    try:
        scaffold(sys.argv[1])
    except (ValueError, OSError) as exc:
        raise SystemExit(f"fail: knowledge scaffold: {exc}")
