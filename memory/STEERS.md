# Repository steers

Explicit user direction for this repository: corrections and confirmations, newest
first. Record the user's own words with date and scope; do not turn a paraphrase
into authority. Redact secrets. Mark superseded directions and link replacements.
Promoting a steer into a standing AGENTS rule still requires approval.

<!--
- Rule: <imperative>
  Why: user, <YYYY-MM-DD>: "<verbatim quote>"
  Applies: <scope and trigger>
  Evidence: <conversation or user-approved record>
-->

- Rule: A click anchors a comment to the element under the pointer, never to a commented ancestor.
  Why: user, 2026-10-19: "ok if i add comment to one text in a div, it appears. if i add another message to that div not text it also appears. but if i try to add another text inside that div, it wont let me pick it will put master div. so imagione if i place commment to top tag which is body, it will not let me add other comments to inner dom elements."
  Applies: chrome-extension capture targeting (click, hover chip, hover preview). Supersedes the 2026-10-19 ancestor-walk that treated any hit inside a commented container as a hit on that container.
  Evidence: memory/daily/2026-10-19.md, section "A container comment must not swallow its children".
