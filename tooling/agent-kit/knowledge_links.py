"""Shared Markdown navigation checks for repository and sidecar knowledge."""

import posixpath
import re
from urllib.parse import unquote


def links(text):
    return [unquote(a or b) for a, b in re.findall(r"\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)", text)]


def check_links(tree, paths):
    errors = []
    for path in paths:
        for target in links(tree.read(path)):
            if re.match(r"[a-zA-Z][\w+.-]*:", target):
                continue
            dest, _, anchor = target.partition("#")
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), dest)) if dest else path
            safe = not resolved.startswith(("../", "/")) and resolved != ".."
            exists = resolved in tree.paths or any(p.startswith(resolved.rstrip("/") + "/") for p in tree.paths)
            if not tree.index:
                exists = (tree.root / resolved).exists() if safe else False
            if not safe or not exists:
                errors.append(f"{path}: broken/unsafe link {target}")
            if safe and anchor and resolved.endswith(".md"):
                headings = re.findall(r"^#{1,6} (.+)$", tree.read(resolved), re.M)
                slugs = {re.sub(r"[^\w\- ]", "", h.lower()).replace(" ", "-") for h in headings}
                if anchor not in slugs:
                    errors.append(f"{path}: missing anchor {target}")
    return errors
