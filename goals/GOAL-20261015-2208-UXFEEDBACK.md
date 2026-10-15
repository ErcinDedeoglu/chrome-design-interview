---
id: GOAL-20261015-2208-UXFEEDBACK
title: Chrome UX Feedback Extension
status: ready
readiness-profile: authoring
created: 2026-10-15
source: discussion
---

# GOAL-20261015-2208-UXFEEDBACK: Chrome UX Feedback Extension

## Intent

Deliver a Chrome extension that lets solo UX designers click DOM elements on demo websites to drop AI-anchored comments and export them as JSON so an AI agent can act without guessing which element was meant.

## Problem

UX designers reviewing implemented demo websites have no structured, element-precise way to leave feedback that an AI agent can consume without hallucinating which DOM element was meant.

## Outcome

A loadable Chrome extension that enters feedback mode on toggle, lets designers click any DOM element to anchor a numbered comment badge, lists all comments in a sidebar, exports them as JSON with exact DOM selectors, computed styles, positions, and page context, and persists comments across page reloads.

## Scope

### In

- Chrome extension manifest V3 with content script, popup, and background service worker
- Toggle mode to enter and exit feedback mode
- Click interception that captures full DOM element metadata: selector, XPath, tag, text, attributes, computed styles, interaction state, rects, ancestors, siblings, visibility
- Numbered badge markers on commented elements
- Sidebar panel listing all comments with severity and status filters
- Clicking a sidebar comment scrolls to and flashes the target element
- Comment editing and deletion with edit history
- Export all comments as JSON with page context and element metadata
- Copy comments to plain text
- Persist comments via chrome.storage.local across page reloads

### Out

- Do not add team sharing, cloud sync, or user accounts
- Do not add screenshot or image capture of commented elements
- Do not add webhook or API delivery to a backend
- Do not add feedback on production or live websites; demo sites only

## Context

- Constraints: Manifest V3, chrome.storage.local (~5MB limit), client-side only, no backend, multiple demo domains supported
- Files / systems: goals/ directory for this goal file; chrome-extension/ directory to be created for the extension
- Commands: n/a
- Run: load the background-work skill at least once
- Run: independent sessions run in parallel in the same turn
- Run: keep doing the main task while those sessions run; do not sleep or poll for an exit

## Decisions

| Decision | Provenance |
| --- | --- |
| Interaction mode — toggle mode | user: Toggle mode (Recommended) — Click the extension icon to enter feedback mode; page clicks become comment anchors instead of triggering site navigation. |
| Conveyance — badge markers + sidebar panel | user: Badge markers + sidebar panel (Recommended) — Numbered dots on each commented element plus a sidebar listing all comments; click either to open the thread. |
| Primary user — solo designer | user: Solo designer reviewing their own demo websites (Recommended) — Reviews their own demo websites; no accounts or shared storage; comments stored locally per page. |
| Delivery — download JSON file | user: Download JSON file (Recommended) — Designer downloads an AI-anchored JSON file and sends it however they already share files; no backend required. |
| Success criterion 1 — under 2 minutes | user: ALL — A designer can click elements, write comments, and export AI-ready JSON in under 2 minutes. |
| Success criterion 2 — no AI hallucination | user: ALL — The AI agent never hallucinates which element a comment refers to. |
| Success criterion 3 — comments survive reloads | user: ALL — Comments survive page reloads and browser restarts. |
| Why now — building demo sites for AI agent feedback | user: You're building demo sites and need structured, element-precise feedback to feed an AI agent (Recommended). |
| Constraints — no backend, client-side only | user: No backend or server — client-side only, download JSON file (Recommended). |
| Excluded — team sharing / cloud sync / accounts | user: Team sharing, cloud sync, or user accounts (Recommended). |
| Excluded — screenshots | user: Screenshot or image capture of commented elements. |
| Excluded — webhook / API delivery | user: Webhook or API delivery to a backend. |
| Convergence — strict scope | user: None — keep it strictly scoped to solo designer + demo sites only (Recommended). |

## Assumptions

- Designers will remember to toggle feedback mode on before commenting (guess — test by watching a first-time user try to comment without entering the mode)
- Saved CSS selectors will still match the same element after the demo site is redeployed (guess — test by re-querying selectors on a changed page)
- A solo designer will not exceed 5MB of chrome.storage with comments (guess — test by measuring average comment JSON size)

## Open questions

n/a

## Work

- [ ] **T1** Scaffold Chrome extension manifest V3 with content script, popup, background → AC-1
- [ ] **T2** Implement toggle feedback mode that intercepts page clicks → AC-2
- [ ] **T3** Capture full DOM element metadata (selector, XPath, computed styles, rects, ancestors) on click and render numbered badge → AC-3
- [ ] **T4** Build sidebar panel listing comments with element navigation → AC-5
- [ ] **T5** Export comments as AI-ready JSON with page context and download → AC-4
- [ ] **T6** Persist comments via chrome.storage.local across reloads → AC-6

## Acceptance criteria

### Must

- [ ] **AC-1** Given the extension is loaded unpacked in Chrome, when any page is opened, then the feedback sidebar appears on the right side of the page.
      Verify plan: Load the extension unpacked in Chrome, open any HTML page, and observe the sidebar renders on the right edge with a heading "UX Feedback".

- [ ] **AC-2** Given feedback mode is enabled, when the designer clicks any page element, then the element's default action does not fire and a comment editor opens near that element.
      Verify plan: Enable feedback mode, click a navigation link or button, observe the page does not navigate and a comment editor card appears positioned near the clicked element.

- [ ] **AC-3** Given a comment is saved on an element, when the page is reloaded, then the comment and its numbered badge reappear in the sidebar and on the element.
      Verify plan: Save a comment on an element, refresh the page, and observe the badge marker and sidebar entry are restored.

- [ ] **AC-4** Given a comment exists, when the designer clicks Export JSON, then a .json file downloads containing the element's selector, computed styles, viewport rect, and page URL.
      Verify plan: Click Export JSON, observe a .json file downloads, open it, and confirm it contains element.selector, element.computedStyle, element.rects.viewport, and page.url fields.

- [ ] **AC-5** Given a comment exists, when the designer clicks a sidebar comment item, then the page scrolls to and briefly flashes the corresponding element.
      Verify plan: Click a sidebar comment item, observe the target element scrolls into view center and gets a temporary blue outline.

- [ ] **AC-6** Given a comment is saved, when the browser is restarted, then the comment persists in local storage.
      Verify plan: Save a comment, close and reopen the browser, reload the page, and observe the comment still appears in the sidebar.

### Should

n/a

## Definition of done

- [ ] Every Must AC is [x] with evidence under Evidence
- [ ] Work items that those AC require are [x]
- [ ] Applicable gates pass: n/a (discover new-product commands during implementation)
- [ ] No secrets in the file or the change
- [ ] Leftovers filed as a later goal file (new stamp; do not reuse this stem) or listed in Out

## Evidence

| AC | Result | Proof |
| --- | --- | --- |
| AC-1 | pending | |
| AC-2 | pending | |
| AC-3 | pending | |
| AC-4 | pending | |
| AC-5 | pending | |
| AC-6 | pending | |

## Risks

- Selector stability: demo site redeploys may break saved CSS selectors; mitigation is to also store XPath and element attributes as fallback locators (guess)
