# Repository decisions

Record consequential choices with date, scope, rationale, alternatives, authority
and evidence. Do not invent decisions during scaffolding. Submodule-specific
choices belong in the mapped sidecar DECISIONS.md; link shared decisions here.
Each choice includes checkout context or a precise daily-session citation, scope,
and separate integration status. Experimental choices are not trunk architecture.

## 2026-10-20 — A comment click anchors to the element under the pointer

- **Scope:** chrome-extension capture targeting (click, hover chip, hover preview). Checkout-scoped. Integration: unknown. Deployment: unknown.
- **Choice:** Match comments with `commentsFor()` on the exact element. A text-node event target falls back to its parent element.
- **Rejected:** `findCommentedAncestor()`, which treated any hit inside a commented container as a hit on that container. A note on `body` then blocked every inner element.
- **Authority:** user, 2026-10-19. Verbatim quote is in [STEERS.md](STEERS.md).
- **Evidence:** [daily/2026-10-19.md](daily/2026-10-19.md) section "A container comment must not swallow its children"; [daily/2026-10-20.md](daily/2026-10-20.md). Parent revision at record time: `69466a7b23a6`.

