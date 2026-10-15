#!/usr/bin/env python3
"""AGENTS.md chain gate. Fail closed. No network. No opt-out.

Crowd counting and link parsing live in agents_chain_lib.py so this entry
stays the hook target. repo-scaffold init copies both files.
"""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agents_chain_lib import *  # noqa: F401,F403
import agents_chain_lib

def main(argv):
    index_only = "--index" in argv
    agents_chain_lib.INDEX_ONLY = index_only
    guard = None
    if "--guard" in argv:
        i = argv.index("--guard")
        if i + 1 >= len(argv):
            fail("--guard needs a path")
            return 1
        guard = argv[i + 1].replace("\\", "/").lstrip("/")
        if guard.startswith("../") or "/../" in f"/{guard}" or guard == "..":
            fail(f"--guard path escapes the repo: {guard}")
            return 1
    args = []
    skip_next = False
    for i, a in enumerate(argv):
        if skip_next:
            skip_next = False
            continue
        if a in ("--index",):
            continue
        if a in ("--threshold", "--guard"):
            skip_next = True
            continue
        if a.startswith("-"):
            fail(f"unknown flag {a}")
            return 1
        args.append(a)
    if fails:
        return 1
    root = os.path.abspath(args[0] if args else ".")
    if not os.path.isdir(root):
        fail(f"not a directory: {root}")
        return 1
    detect_kit_roots(root)
    load_quality_ignore(root)
    for rel in nested_adapters(root):
        fail(
            f"{rel} is a nested adapter — CLAUDE.md and GEMINI.md exist only at the repo root and must point at AGENTS.md"
        )
    threshold = threshold_from_args(argv)
    if threshold is None:
        return 1

    if guard and (guard == "AGENTS.md" or guard.endswith("/AGENTS.md")):
        ok("chain guard allows AGENTS.md write")
        return 0
    if guard and (skipped_path(guard) or under_submodule(guard, submodule_paths(root))):
        ok("chain guard skips kit/submodule path")
        return 0

    files, subs = collect(root, index_only)
    extra = None
    if guard and not skipped_path(guard) and basename(guard) not in SKIP_FILES and not basename(guard).startswith("."):
        extra = guard
    agents_dirs, direct_files, child_dirs = build(files, subs, extra)

    required = {""}
    candidates = set(direct_files) | set(child_dirs) | set(agents_dirs)
    if extra:
        candidates.add(dirname(extra))
    for rel in candidates:
        if rel == "" or (not eligible_dir(rel, subs) and rel not in agents_dirs):
            continue
        if rel in agents_dirs or crowd_of(rel, direct_files, child_dirs) >= threshold:
            required.add(rel)

    children = {d: [] for d in required}
    for rel in required:
        if rel == "":
            continue
        children.setdefault(parent_of(rel, required), []).append(rel)

    def on_guard_path(rel):
        if not guard:
            return True
        gdir = dirname(guard)
        while True:
            if rel == gdir:
                return True
            if gdir == "":
                return False
            gdir = dirname(gdir)

    reported = False
    for rel in sorted(required, key=lambda p: (p.count("/"), p)):
        if rel == "":
            continue
        if not on_guard_path(rel):
            continue
        if rel in agents_dirs:
            continue
        n = crowd_of(rel, direct_files, child_dirs)
        if n < threshold:
            continue
        reported = True
        folder = rel + "/"
        disk = agents_rel(rel)
        disk_path = os.path.join(root, disk)
        parent = parent_of(rel, required)
        fix = expected_fix(rel, parent, children.get(rel, []))
        if os.path.isfile(disk_path) and ignored(root, disk):
            fail(f"forgotten AGENTS.md: {folder} (crowd {n} ≥ {threshold}) — {disk} is gitignored and does not count")
        elif os.path.isfile(disk_path) and index_only:
            fail(f"forgotten AGENTS.md: {folder} (crowd {n} ≥ {threshold}) — {disk} is not in the index; git add it")
        else:
            fail(f"forgotten AGENTS.md: {folder} (crowd {n} ≥ {threshold})")
        fail(f"fix: create {disk} with:")
        for line in fix:
            fail(f"fix: {line}")
        if parent is not None and parent in agents_dirs:
            down = rel_link(parent, disk)
            where = agents_rel(parent)
            fail(f"fix: in {where} ## Chain add: - Down: `{down}`")
        elif parent not in (None, "") and parent not in agents_dirs:
            fail(f"fix: {parent}/ is also missing AGENTS.md — link Down after that file exists")
        else:
            where = "AGENTS.md"
            down = rel_link("", disk)
            if os.path.isfile(os.path.join(root, "AGENTS.md")):
                fail(f"fix: in {where} ## Chain add: - Down: `{down}`")

    if "" not in agents_dirs:
        root_disk = os.path.join(root, "AGENTS.md")
        if os.path.isfile(root_disk) and ignored(root, "AGENTS.md"):
            fail("forgotten AGENTS.md: / (root) — AGENTS.md is gitignored and does not count")
        elif os.path.isfile(root_disk) and index_only:
            fail("forgotten AGENTS.md: / (root) — AGENTS.md is not in the index; git add it")
        else:
            fail("forgotten AGENTS.md: / (root)")
        fail("fix: create AGENTS.md with:")
        for line in expected_fix("", None, children.get("", [])):
            fail(f"fix: {line}")

    if guard:
        if reported or fails:
            return 1
        ok("chain guard")
        return 0

    for rel in sorted(required, key=lambda p: (p.count("/"), p)):
        disk = agents_rel(rel)
        if rel not in agents_dirs:
            continue
        text = read_agents(root, rel)
        if text is None:
            fail(f"broken chain: {disk} is in the tree but not readable")
            continue
        parsed = parse_chain(text)
        expect_children = children.get(rel, [])
        fix = expected_fix(rel, parent_of(rel, required) if rel else None, expect_children)
        if rel == "":
            fix = expected_fix("", None, expect_children)
        if parsed is None:
            fail(f"broken chain: {disk} has no ## Chain section")
            fail(f"fix: add to {disk}:")
            for line in fix:
                fail(f"fix: {line}")
            continue
        if parsed.get("error"):
            fail(f"broken chain: {disk} {parsed['error']}")
            continue
        for bad in parsed["illegal"]:
            fail(f"broken chain: {disk} illegal line `{bad}` — use `- Up: \\`path\\`` or `- Down: \\`path\\``")
        if parsed["up"] is None:
            fail(f"broken up: {disk} missing Up — expected `{fix[1]}`")
        elif rel == "" and parsed["up"] != "(root)":
            fail(f"broken up: {disk} Up is `{parsed['up']}` but root must be `- Up: (root)`")
        elif rel != "" and parsed["up"] == "(root)":
            parent = parent_of(rel, required)
            fail(f"broken up: {disk} Up is (root) but nearest chain parent is `{rel_link(rel, agents_rel(parent))}`")
        elif rel != "":
            parent = parent_of(rel, required)
            got = resolve_link(rel, parsed["up"])
            want = agents_rel(parent)
            if got != want:
                shown = parsed["up"]
                fail(f"broken up: {disk} Up `{shown}` does not resolve to {want} (nearest chain parent)")
                fail(f"fix: set `- Up: `{rel_link(rel, want)}`` in {disk}")
        expect = {agents_rel(c) for c in expect_children}
        if not expect_children:
            if parsed["downs"] and parsed["none"]:
                fail(f"broken down: {disk} mixes `- Down: (none)` with child links")
            elif parsed["downs"] or not parsed["none"]:
                fail(f"broken down: {disk} has no chain children — need exactly `- Down: (none)`")
        else:
            if parsed["none"]:
                fail(f"broken down: {disk} says `- Down: (none)` but chain children exist")
            got_set = set()
            for link in parsed["downs"]:
                target = resolve_link(rel, link)
                if target not in expect:
                    fail(f"broken down: {disk} lists `- Down: `{link}`` which is not a chain child")
                else:
                    got_set.add(target)
            for missing in sorted(expect - got_set):
                fail(f"broken down: {disk} missing `- Down: `{rel_link(rel, missing)}``")

    check_delta_floor(root, required, agents_dirs)

    if fails:
        fail("AGENTS.md chain broken — forgotten folder or broken up/down link. No opt-out (--no-verify, trivial.md, and env vars do not skip this).")
        return 1
    ok("AGENTS.md chain")
    return 0


# A line that appears in 4+ nested agent files is template boilerplate, not a rule.
# 4 mirrors the quality phase's "3+ recurrences" convention for something observed rather
# than assumed, plus one so a single shared line cannot condemn a file. The rule is a
# RATIO, not a count: a delta may legitimately repeat a few shared conventions, but a
# file whose body is mostly boilerplate is a template stamp — and the cheapest way to
# satisfy a threshold must not be pasting the template.
BOILERPLATE_HITS = 4


def body_lines(text):
    """Every prose line outside the `## Chain` section. Headings, blanks, code
    fences, and the managed-by comment carry no rule, so they are not counted."""
    out = []
    in_chain = False
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if line == "## Chain":
            in_chain = True
            continue
        if line.startswith("## "):
            in_chain = False
            continue
        if in_chain or not line or line.startswith("#") or line.startswith("```"):
            continue
        if line.startswith("<!--") or line.endswith("-->"):
            continue
        out.append(line)
    return out


def check_delta_floor(root, required, agents_dirs):
    seen = {}
    texts = {}
    for rel in required:
        if rel == "":
            continue
        # Generated sidecar indexes share navigation, not product rules.
        if rel in agents_chain_lib.sidecar_roots or rel == "docs/submodules":
            continue
        disk = agents_rel(rel)
        if rel not in agents_dirs:
            continue
        text = read_agents(root, rel)
        if text is None:
            continue
        texts[rel] = body_lines(text)
        for line in texts[rel]:
            seen[line] = seen.get(line, 0) + 1
    for rel, lines in sorted(texts.items()):
        disk = agents_rel(rel)
        if not lines:
            continue
        stale = [line for line in lines if seen.get(line, 0) >= BOILERPLATE_HITS]
        if len(stale) * 2 > len(lines):
            fail(
                f"{disk} is a template stamp: {len(stale)} of {len(lines)} body lines "
                f"are boilerplate shared by {BOILERPLATE_HITS}+ nested AGENTS.md"
            )
            fail(
                f"fix: keep the chain links plus the one rule true only for {rel}/, "
                f"and delete the rest"
            )


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
