"""Project knowledge suites and per-owner evidence gates, without per-session files."""

import datetime
from pathlib import Path
import posixpath
import re
from urllib.parse import quote

from knowledge_context import RULES, render, validate as validate_context, validate_tags, entry_tag, reviewed
from knowledge_layout import RECORDS, safe_path
from knowledge_links import check_links, links
from project_layout import CONFIG, HUB, load, owners


def rel(source, target):
    return posixpath.relpath(target, posixpath.dirname(source))


def scaffold(tree, assets, sidecars, writes, managed):
    projects = load(tree, sidecars)
    if not projects:
        return
    today = datetime.date.today().isoformat()
    hub = tree.read(HUB) or "# Owned-project knowledge\n\nMapping: `tooling/agent-kit/projects.json` (repository-relative). Root records are shared; read only matching project records. Coordinate shared writes.\n\n## Chain\n\n- Up: `../AGENTS.md`\n- Down: (none)\n"
    hub = close_chain(hub)
    hub = managed(hub, "project-index", "\n".join(
        f"- [{name}](<{quote(rel(HUB, entry['memory'] + '/AGENTS.md'), safe='/.-')}>) — owns "
        + ", ".join(f"`{p}`" for p in entry["paths"]) for name, entry in projects.items()))
    for name, entry in projects.items():
        base = entry["memory"]
        for record in ("AGENTS.md", *RECORDS):
            path = f"{base}/{record}"
            safe_path(tree.root, path)
            text = tree.read(path)
            if not (tree.root / path).exists():
                if record == "AGENTS.md":
                    text = f"# Knowledge — {name}\n\n## Chain\n\n- Up: `{rel(path, HUB)}`\n- Down: (none)\n"
                elif record == "MEMORY.md":
                    text = f"# Memory — {name}\n\nScoped index; no verified findings seeded.\n"
                else:
                    template = Path(assets) / ("decisions.md" if record == "DECISIONS.md" else "repository/" + record)
                    text = template.read_text()
            if record == "AGENTS.md":
                text = close_chain(text)
                text = managed(text, "project-scope", f"Project: `{name}`. Owns "
                               + ", ".join(f"`{p}`" for p in entry["paths"])
                               + ". Keep shared facts in root memory; integration facts in mapped sidecars.\n"
                               + "Use the same daily file per project/date; never session-ID or branch directories.\n"
                               + "Serialize edits to shared logs/indexes; re-read before writing. No automatic locking is installed.\n")
                text = managed(text, "context-policy", RULES)
            if record in {"AGENTS.md", "MEMORY.md"}:
                body = "\n".join(f"- [{r}]({r})" for r in ("AGENTS.md", *RECORDS) if r != record)
                body += "\n- [Daily evidence](daily/)\n- [Lesson files](lessons/)\n- [Patterns](patterns/)"
                body += f"\n- [Shared templates]({rel(path, 'memory/templates')}/)"
                text = managed(text, "project-navigation", body)
            writes[path] = text
        for folder in ("lessons", "patterns"):
            path = f"{base}/{folder}/.gitkeep"
            if not (tree.root / path).exists():
                writes[path] = ""
        if not any((tree.root / base / "daily").glob("????-??-??.md")):
            path = f"{base}/daily/{today}.md"
            writes[path] = f"# {today}\n\n" + render(tree, project=name) + f"\n- {entry_tag(tree)} Installed knowledge for {name}; product review pending.\n"
        hub = add_child(hub, rel(HUB, f"{base}/AGENTS.md"))
    writes[HUB] = hub
    for record in ("AGENTS.md", "MEMORY.md"):
        path = f"memory/{record}"
        text = writes.get(path, tree.read(path))
        text = managed(text, "owned-projects", f"Owned-project knowledge: [project index](projects/AGENTS.md). Root records own shared/unmapped work only.")
        writes[path] = add_child(text, "projects/AGENTS.md") if record == "AGENTS.md" else text
    for path in writes:
        safe_path(tree.root, path)
        current = tree.root
        for part in path.split("/")[:-1]:
            current /= part
            if current.exists() and not current.is_dir():
                raise ValueError(f"project knowledge parent is not a directory: {path}")
        if (tree.root / path).exists() and not (tree.root / path).is_file():
            raise ValueError(f"project knowledge record is not a regular file: {path}")


def add_child(text, child):
    match = re.search(r"^## Chain\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not match:
        raise ValueError("project knowledge requires a valid ## Chain")
    down = f"- Down: `{child}`"
    if down not in match.group(1).splitlines():
        body = match.group(1).replace("- Down: (none)", "").rstrip() + "\n" + down + "\n\n"
        text = text[:match.start(1)] + body + text[match.end(1):]
    return text


def close_chain(text):
    # Managed comments/prose must not become illegal lines inside a final Chain section.
    if re.search(r"^## Chain\s*\n(?:(?!^## ).)*\Z", text, re.M | re.S):
        return text.rstrip() + "\n\n## Knowledge\n"
    return text


def validate(tree, sidecars, changed):
    projects = load(tree, sidecars)
    previous = load(tree, sidecars, previous=True)
    errors = []
    affected = set()
    if tree.changed(CONFIG):
        affected.update(name for name, entry in projects.items() if previous.get(name) != entry)
    for path in changed:
        if any(path == p or path.startswith(p + "/") for p in [*tree.modules(), *sidecars.values()]):
            continue
        affected.update(owners(path, projects))
        affected.update(owners(path, previous))
    if projects and not tree.read(HUB):
        errors.append(f"missing {HUB}")
    for name, entry in projects.items():
        base = entry["memory"]
        paths = [f"{base}/{r}" for r in ("AGENTS.md", *RECORDS)]
        daily = sorted(p for p in tree.paths if re.fullmatch(re.escape(base) + r"/daily/\d{4}-\d{2}-\d{2}\.md", p))
        if not tree.index:
            daily = sorted(str(p.relative_to(tree.root)) for p in (tree.root / base / "daily").glob("????-??-??.md"))
        for path in paths:
            if not tree.read(path).strip():
                errors.append(f"{path}: missing/empty project record")
        if not daily:
            errors.append(f"{name}: missing dated project daily log")
        memory = tree.read(f"{base}/MEMORY.md")
        if len(memory.splitlines()) > 200 or len(memory.encode("utf-8")) > 25600:
            errors.append(f"{base}/MEMORY.md: exceeds 200 lines / 25 KB")
        for record in ("AGENTS.md", "MEMORY.md"):
            targets = links(tree.read(f"{base}/{record}"))
            for target in ("AGENTS.md", *RECORDS):
                if target != record and target not in targets:
                    errors.append(f"{base}/{record}: missing index link {target}")
            for folder in ("daily", "lessons", "patterns"):
                if not any(t.rstrip("/") == folder for t in targets):
                    errors.append(f"{base}/{record}: missing {folder} index")
        target = f"{base}/AGENTS.md"
        if target not in {posixpath.normpath(posixpath.join(posixpath.dirname(HUB), p)) for p in links(tree.read(HUB))}:
            errors.append(f"{HUB}: missing navigation for {name}")
        errors.extend(check_links(tree, paths + daily + [HUB]))
        if name not in affected:
            continue
        log = f"{base}/daily/{datetime.date.today().isoformat()}.md"
        text = tree.read(log)
        if not text.strip() or not tree.changed(log):
            errors.append(f"project {name}: update today's daily evidence: {log}")
        errors.extend(validate_context(tree, log, project=name, current=True))
        errors.extend(validate_tags(tree, log))
        for title, record, marker in (("Memory", "MEMORY.md", "unchanged"),
                                      ("Lessons", "LESSONS.md", "no new lessons"),
                                      ("Decisions", "DECISIONS.md", "no new decisions")):
            if not tree.changed(f"{base}/{record}") and not reviewed(tree, log, f"{title}: reviewed; {marker}."):
                errors.append(f"project {name}: review {record} in owning evidence or update it")
        for path in tree.paths:
            if (path.startswith((base + "/lessons/", base + "/patterns/"))
                    and path.endswith(".md") and tree.changed(path) and tree.read(path).strip()):
                errors.extend(validate_context(tree, path, project=name))
    return errors
