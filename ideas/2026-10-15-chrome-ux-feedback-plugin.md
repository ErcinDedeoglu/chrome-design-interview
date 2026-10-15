# UX Feedback Chrome Plugin for Designers

## Status

ready

## Seed

I need a chrome plugin, that will help ux designers to give feedback on top of the implemented demo websites.

## Now

A Chrome extension that lets UX designers click on DOM elements of live demo websites to drop contextual comments, with each comment anchored to the exact element (selector, computed styles, position) and exported as AI-ready JSON so an AI agent can act without guessing which element was meant. Interaction uses toggle mode (enter feedback mode, click elements, exit); comments surface as numbered badges plus a sidebar panel.

## How might we

How might we let a solo designer click DOM elements on demo websites to leave AI-anchored comments, export them as JSON in under 2 minutes, never hallucinate which element a comment refers to, and have comments survive page reloads?

## Moment

You're building demo sites and need structured, element-precise feedback to feed an AI agent (user).

## Who

—

## Why now

You're building demo sites and need structured, element-precise feedback to feed an AI agent (user).

## Success

- A designer can click elements, write comments, and export AI-ready JSON in under 2 minutes (user).
- The AI agent never hallucinates which element a comment refers to (user).
- Comments survive page reloads and browser restarts (user).

## Constraints

- No backend or server — client-side only, download JSON file (user).
- Must support multiple different demo domains (user).
- 5MB chrome.storage.local limit — comment count is naturally capped (guess).

## Territory

### Landmines

Guess — Manifest V3 service worker (no persistent background page); content scripts can't run on `chrome://` pages; click interception fights normal site navigation (buttons/links fire before the comment lands); `chrome.storage.local` is capped at ~5MB per extension.

### Hidden context

Guess — The repo runs an agent kit with strict growth rules: a product folder needs its own `AGENTS.md` at 8 direct entries, `check.sh` enforces chain and quality gates, and `git commit --no-verify` cannot skip them. The `chrome-extension/` folder I built and deleted earlier would have been a new product domain subject to those rules.

### What good looks like

Guess — Figma comment mode (click to drop a numbered pin, open a comment thread), Usersnap / Marker.io (page feedback with screenshot + DOM context), Loom-style inline annotations on live URLs.

## Picture

— (your call: standard sidebar + numbered badge UI; no visual variations needed to build)

## Directions

—

## Decisions

- **Interaction mode — toggle mode (user)** — Click the extension icon to enter feedback mode; page clicks become comment anchors instead of triggering site navigation.
- **Conveyance — badge markers + sidebar panel (user)** — Numbered dots on each commented element plus a sidebar listing all comments; click either to open the thread.
- **Primary user — solo designer (user)** — Reviews their own demo websites; no accounts or shared storage; comments stored locally per page.
- **Delivery — download JSON file (user)** — Designer downloads an AI-anchored JSON file and sends it however they already share files; no backend required.

## Not doing

- Team sharing, cloud sync, or user accounts (user) — solo designer only; comments stay local.
- Screenshot or image capture of commented elements (user) — JSON anchors to DOM instead.
- Webhook or API delivery to a backend (user) — download JSON is the delivery method.
- Future: team sharing / cloud sync (user) — convergence decision; stays out of v1.
- Adjacent: feedback on production/live sites (user) — out of scope; demo sites only.
- Anti-goal: the plugin ships but the AI agent can't reliably act on a comment because the DOM selector breaks or the designer forgets to toggle feedback mode (guess).

## Assumptions

- [ ] Designers will remember to toggle feedback mode on before commenting — test by watching a first-time user try to comment without entering the mode (guess).
- [ ] Saved CSS selectors will still match the same element after the demo site is redeployed — test by re-querying selectors on a changed page (guess).
- [ ] A solo designer won't exceed 5MB of chrome.storage with comments — test by measuring average comment JSON size (guess).

## Ties

—

## Open

—

## Next

If approved, invoke goal-file to turn this brief into a build plan and implement the Chrome extension.
