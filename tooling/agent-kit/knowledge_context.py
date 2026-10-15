"""Checkout provenance for knowledge; verification never implies integration."""

import argparse
import difflib
import re
import sys
from urllib.parse import quote, unquote

sys.dont_write_bytecode = True
from knowledge_layout import Tree

BEGIN = "<!-- agent-kit:context:begin -->"
END = "<!-- agent-kit:context:end -->"
POLICY = "<!-- agent-kit:context-policy:v1 -->"
TAG_POLICY = "<!-- agent-kit:entry-tags:v1 -->"
RULES = """<!-- agent-kit:context-policy:v1 -->
<!-- agent-kit:entry-tags:v1 -->
## Evidence scope

Before writing knowledge, record checkout context using
`python3 tooling/agent-kit/knowledge_context.py .` (add `--project <id>` or `--module <path>` for the owner).
Append its context block to today's evidence; it prints only, never edits records.
Keep a separate block per session/revision. New or revised lesson/pattern bodies
also carry a context block. Entries in NOTES/RUNBOOK/DECISIONS/STEERS/HISTORY cite
their owning daily context or include their own block; indexes retain scope labels.
Default: checkout-scoped, verification not recorded, integration unknown, deployment unknown.
Describe checks actually observed in Verification; tests, commits, review stamps and
branch names do not establish a merge or deployment. Target stays unknown unless
the user or repository evidence identifies it; a remote default is only a candidate.
Integration is unknown | not-merged | merged. A merged claim requires an explicit
Target ref and Integration-evidence commit reachable from that ref; inspect the
target content too (squash/cherry-pick may change SHAs). This is local-ref evidence,
not proof the remote is current, the feature is present, or production was deployed.
Deployment claims require separate environment/release evidence, never ancestry alone.
Child-revision is the child snapshot reviewed, not proof of upstream or parent-trunk
integration. Integration/Target in this block refer to the parent repository.
Record child-upstream claims separately with repository/ref/evidence.
Legacy records lacking context have unknown scope/integration; preserve, then recheck
before reuse. Do not rewrite history or assume records copied across branches apply.
Scope reusable requires a reason in the evidence body; feature-specific facts remain
checkout-scoped until applicability is rechecked. Approval/promotion does not merge code.
Prefix new daily bullets (including review markers) with branch/revision tags from
`knowledge_context.py . --entry-tag`. Storage is per project/date, never per session
or branch. Coordinate/serialize same-project log and index writes; append-only prose
does not prevent concurrent lost updates. Re-read the file before modifying it.
"""


def render(tree, module=None, project=None):
    if module and project:
        raise ValueError("choose project or submodule ownership, not both")
    if project:
        from knowledge_layout import resolve
        from project_layout import load
        if project not in load(tree, resolve(tree)["sidecars"]):
            raise ValueError(f"not a mapped project: {project}")
    branch = tree.git("symbolic-ref", "--short", "-q", "HEAD", optional=True).strip() or "detached"
    head = tree.git("rev-parse", "--verify", "HEAD", optional=True).strip() or "unborn"
    rows = [BEGIN, f"Branch: {branch}", f"Revision: {head}",
            "Scope: checkout", "Verification: not-recorded", "Integration: unknown",
            "Target: unknown", "Integration-evidence: none", "Deployment: unknown"]
    if project:
        rows.append(f"Owner: project:{project}")
    elif module:
        rows.append(f"Owner: submodule:{module}")
    else:
        rows.append("Owner: repository")
    if module:
        if module not in tree.modules():
            raise ValueError(f"not a registered submodule: {module}")
        child = tree.entries.get(module, ("", "unknown"))[1]
        if not tree.index and (tree.root / module / ".git").exists():
            child = tree.git("-C", module, "rev-parse", "HEAD").strip()
        rows.append(f"Child-revision: {child}")
    return "\n".join([*rows, END]) + "\n"


def validate(tree, path, module=None, current=False, project=None):
    text = tree.read(path)
    blocks = re.findall(re.escape(BEGIN) + r"\n(.*?)" + re.escape(END), text, re.S)
    errors = []
    if not blocks or text.count(BEGIN) != len(blocks) or text.count(END) != len(blocks):
        return [f"{path}: missing/malformed checkout context; run knowledge_context.py"]
    matched = False
    owned = False
    expected = dict(line.split(": ", 1) for line in render(tree, module, project).splitlines() if ": " in line)
    for block in blocks:
        rows = [line.split(": ", 1) for line in block.strip().splitlines()]
        if any(len(row) != 2 for row in rows) or len({row[0] for row in rows}) != len(rows):
            errors.append(f"{path}: malformed/duplicate context fields")
            continue
        fields = dict(rows)
        required = set(expected)
        if "Owner" not in fields:
            # Preserve old context; it cannot satisfy the new current-owner check.
            continue
        if any(not fields.get(key) or "{{" in fields[key] for key in required):
            errors.append(f"{path}: incomplete context fields")
            continue
        if fields["Scope"] not in {"checkout", "reusable"} or fields["Integration"] not in {"unknown", "not-merged", "merged"}:
            errors.append(f"{path}: invalid scope/integration")
        if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}|unborn", fields["Revision"]):
            errors.append(f"{path}: Revision must be a full SHA or unborn")
        if module and not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", fields["Child-revision"]):
            errors.append(f"{path}: Child-revision must be a full SHA")
        if fields["Integration"] == "merged":
            target, evidence = fields["Target"], fields["Integration-evidence"]
            # Prefix refs so input cannot be interpreted as Git options/revision syntax.
            ref = target if target.startswith("refs/") else "refs/heads/" + target
            valid_ref = bool(re.fullmatch(r"refs/[A-Za-z0-9_./-]+", ref)) and ".." not in ref
            valid_sha = bool(re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", evidence))
            target_sha = tree.git("rev-parse", "--verify", ref + "^{commit}", optional=True).strip() if valid_ref else ""
            ancestor = tree.git("merge-base", evidence, target_sha, optional=True).strip() if target_sha and valid_sha else ""
            if not valid_sha or ancestor != evidence:
                errors.append(f"{path}: merged needs a commit reachable from explicit Target")
        if fields["Deployment"] != "unknown" and fields.get("Deployment-evidence", "").strip() in {"", "none", "unknown"}:
            errors.append(f"{path}: deployment requires separate Deployment-evidence")
        if "Owner" in expected and fields.get("Owner") != expected["Owner"]:
            errors.append(f"{path}: context belongs to another project/integration")
        owned |= fields.get("Owner") == expected.get("Owner")
        keys = ["Branch", "Revision", "Owner"] + (["Child-revision"] if module else [])
        matched |= all(fields[key] == expected[key] for key in keys)
    if current and not matched:
        errors.append(f"{path}: context does not match current parent checkout/child snapshot")
    if not owned:
        errors.append(f"{path}: missing owning repository/project/integration context")
    return errors


def entry_tag(tree):
    fields = dict(line.split(": ", 1) for line in render(tree).splitlines() if ": " in line)
    return f"[branch: {quote(fields['Branch'], safe='/._-')}] [rev: {fields['Revision'][:12]}]"


def validate_tags(tree, path):
    """Only new daily bullets need tags; do not rewrite legacy evidence."""
    before, after = tree.before(path).splitlines(), tree.read(path).splitlines()
    added = []
    for op, _, _, start, end in difflib.SequenceMatcher(a=before, b=after, autojunk=False).get_opcodes():
        if op in {"insert", "replace"}:
            added.extend(after[start:end])
    contexts = []
    for block in re.findall(re.escape(BEGIN) + r"\n(.*?)" + re.escape(END), tree.read(path), re.S):
        fields = dict(line.split(": ", 1) for line in block.strip().splitlines() if ": " in line)
        contexts.append((fields.get("Branch"), fields.get("Revision", "")))
    errors = []
    for line in added:
        if not re.match(r"^\s*- ", line):
            continue
        match = re.match(r"^\s*- \[branch: ([^\]]+)\] \[rev: ([0-9a-f]{12,64}|unborn)\] .+", line)
        if not match or not any(branch == unquote(match[1]) and revision.startswith(match[2]) for branch, revision in contexts):
            errors.append(f"{path}: new daily bullet needs branch/revision tags matching its context")
    return errors


def reviewed(tree, path, marker):
    """A review declaration belongs to this changed checkout evidence, not yesterday's branch."""
    expected = f"- {entry_tag(tree)} {marker}"
    before, after = tree.before(path).splitlines(), tree.read(path).splitlines()
    return any(line.strip() == expected
               for op, _, _, start, end in difflib.SequenceMatcher(a=before, b=after, autojunk=False).get_opcodes()
               if op in {"insert", "replace"} for line in after[start:end])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--module")
    parser.add_argument("--project")
    parser.add_argument("--entry-tag", action="store_true")
    parser.add_argument("--index", action="store_true")
    args = parser.parse_args()
    try:
        tree = Tree(args.root, args.index)
        context = render(tree, args.module, args.project)
        print(entry_tag(tree) if args.entry_tag else context, end="\n" if args.entry_tag else "")
    except (ValueError, OSError) as exc:
        raise SystemExit(str(exc))
