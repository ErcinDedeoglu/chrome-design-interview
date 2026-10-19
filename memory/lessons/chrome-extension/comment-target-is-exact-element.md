# comment-target-is-exact-element

- **Domain:** chrome-extension
- **Date:** 2026-10-19
- **Pattern-Key:** comment-target-exact-element
- **Confidence:** high
- **Evidence:** memory/daily/2026-10-19.md (section "A container comment must not swallow its children"); `node chrome-extension/tests/content.test.js` → passed: 162 failed: 0
- **Status:** active

<!-- agent-kit:context:begin -->
Branch: main
Revision: 69466a7b23a6b68b039d71e13eb6c7ae93d9bb1b
Scope: checkout
Verification: not-recorded
Integration: unknown
Target: unknown
Integration-evidence: none
Deployment: unknown
Owner: repository
<!-- agent-kit:context:end -->

Checkout-scoped. Applies to this extension's capture targeting, not to other products.

## Situation

A designer commented on a text element inside a div, then on the div itself. The next click on another text element inside that div was reassigned to the div. A comment on `body` would have made every inner element un-pickable.

## Decision

Anchor click, hover chip, and hover preview to the exact element under the pointer. Rejected: walking up to the nearest commented ancestor.

## Reasoning

`findCommentedAncestor()` was added so a click on a child of an already-commented block would reveal the block's comments instead of starting a nested one. That made a container comment own every descendant. The user rejected it.

> user, 2026-10-19: "ok if i add comment to one text in a div, it appears. if i add another message to that div not text it also appears. but if i try to add another text inside that div, it wont let me pick it will put master div. so imagione if i place commment to top tag which is body, it will not let me add other comments to inner dom elements."

`commentsFor()` matches `resolveElement(comment) === el` only. A text-node event target falls back to its parent element, which is what a browser click already targets.

## Outcome

In Chrome for Testing on Wikipedia, a comment on `#mw-content-text` did not steal a click on the paragraph `#mwAw`, and a comment on `body` did not steal a click on the heading `#History`. Both inner clicks opened the editor, not the ancestor popover. Headless suite: passed 162, failed 0.

## Lesson

Never retarget a comment click or hover to a commented ancestor. The element under the pointer is the anchor, even when `body` already has a comment.
