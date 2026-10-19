---
id: GOAL-20261015-2208-UXFEEDBACK
title: Chrome UX Feedback Extension
status: delivered
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

- [x] **T1** Scaffold Chrome extension manifest V3 with content script, popup, background → AC-1
- [x] **T2** Implement toggle feedback mode that intercepts page clicks → AC-2
- [x] **T3** Capture full DOM element metadata (selector, XPath, computed styles, rects, ancestors) on click and render numbered badge → AC-3
- [x] **T4** Build sidebar panel listing comments with element navigation → AC-5
- [x] **T5** Export comments as AI-ready JSON with page context and download → AC-4
- [x] **T6** Persist comments via chrome.storage.local across reloads → AC-6

## Acceptance criteria

### Must

- [x] **AC-1** Given the extension is loaded unpacked in Chrome, when any page is opened, then the feedback sidebar appears on the right side of the page.
      Verify plan: Load the extension unpacked in Chrome, open any HTML page, and observe the sidebar renders on the right edge with a heading "UX Feedback".

- [x] **AC-2** Given feedback mode is enabled, when the designer clicks any page element, then the element's default action does not fire and a comment editor opens near that element.
      Verify plan: Enable feedback mode, click a navigation link or button, observe the page does not navigate and a comment editor card appears positioned near the clicked element.

- [x] **AC-3** Given a comment is saved on an element, when the page is reloaded, then the comment and its numbered badge reappear in the sidebar and on the element.
      Verify plan: Save a comment on an element, refresh the page, and observe the badge marker and sidebar entry are restored.

- [x] **AC-4** Given a comment exists, when the designer clicks Export JSON, then a .json file downloads containing the element's selector, computed styles, viewport rect, and page URL.
      Verify plan: Click Export JSON, observe a .json file downloads, open it, and confirm it contains element.selector, element.computedStyle, element.rects.viewport, and page.url fields.

- [x] **AC-5** Given a comment exists, when the designer clicks a sidebar comment item, then the page scrolls to and briefly flashes the corresponding element.
      Verify plan: Click a sidebar comment item, observe the target element scrolls into view center and gets a temporary blue outline.

- [x] **AC-6** Given a comment is saved, when the browser is restarted, then the comment persists in local storage.
      Verify plan: Save a comment, close and reopen the browser, reload the page, and observe the comment still appears in the sidebar.

### Should

n/a

## Definition of done

- [x] Every Must AC is [x] with evidence under Evidence
- [x] Work items that those AC require are [x]
- [x] Applicable gates pass: `node chrome-extension/tests/content.test.js` (88/0) and `node chrome-extension/tests/browser-ac.js` (26/0) against the genuinely loaded extension; `tooling/agent-kit/check.sh` → agent-kit check passed
- [x] No secrets in the file or the change
- [x] Leftovers filed as a later goal file (new stamp; do not reuse this stem) or listed in Out — none; the export filename caveat below is recorded in Risks

## Evidence

| AC | Result | Proof |
| --- | --- | --- |
| AC-1 | **pass — real loaded extension** | Extension loaded unpacked in Chrome for Testing 153; content script is the manifest-declared one, no shim. On page load with no toggle: `sidebarInjected:true`, heading `"UX Feedback"`, computed `position:fixed`, `right:"0px"`, `width:"340px"`, `hasFilters:true`. |
| AC-2 | **pass — real loaded extension** | Real click dispatched on the `#nav-link` anchor while mode was set on through the extension's own `REQUEST_SET_MODE` message: `urlUnchanged:true`, `editorOpen:true`, `pageHandlerFired:false` — a document-level listener added beforehand never ran. |
| AC-3 | **pass — real loaded extension** | Chrome killed, relaunched on the same profile, page reloaded. Real `chrome.storage.local` still held `ux_feedback_comments:http://127.0.0.1:8731/index.html` with `count:1`. Sidebar restored on load with `sidebarItems:1`, `firstItemText:"Checkout heading is too large on mobile"`, `firstItemSelector:"#nav-link"`; `badgesWhileModeOff:0`; enabling mode produced `BADGES_AFTER_MODE ["1"]`. |
| AC-4 | **pass — real downloaded file, parsed** | `node chrome-extension/tests/browser-ac.js` writes an actual `.json` file and parses it. The suite now prints the artifact identity itself, so the proof travels with the gate output instead of requiring separate filesystem access to a temp directory: `bytes: 2623` (stable across runs) with `page.url = http://127.0.0.1:8741/index.html`, `element.selector = #nav-link`, `element.computedStyle keys = 16, all non-empty = true` (`fontSize:"16px"`, `backgroundColor:"rgba(0, 0, 0, 0)"`), `element.rects.viewport = {"x":40,"y":247.015625,"width":72.390625,"height":19}`. Set `DOWNLOAD_DIR` to place the artifact inside the workspace. **The sha256 is not a fixed identity** — it changes per run because the payload embeds `pageContext.exportededAt`, comment `createdAt` and a generated comment id (observed `fd46e453…` and `5672ed69…` for equal-length exports). The byte count and the parsed field set above are the stable evidence. |
| AC-5 | **pass — real loaded extension** | Sidebar item clicked: `outline:"rgb(66, 133, 244) solid 3px"`, `outlineOffset:"2px"` on the anchored element, restored to `""` after ~2 s (temporary flash). Centring and scrolling were measured separately on a taller page: `scrollY 0 → 1063`, `centreDelta:0`. |
| AC-6 | **pass — real browser restart** | Chrome was killed (`Chrome is down` on the CDP port) and relaunched as a **new process** on the same profile. Afterwards real `chrome.storage.local` still returned the comment, and the sidebar plus badge were restored on load. No shim anywhere in this run. |

## Verification

Reproducible from the repository; no manual steps:

- `node chrome-extension/tests/content.test.js` → `passed: 88   failed: 0`
- `node chrome-extension/tests/browser-ac.js` → `passed: 26   failed: 0`
  Launches Chrome for Testing with `chrome-extension/` loaded unpacked and checks
  AC-1, AC-2, AC-4, AC-5 and AC-6 against the real extension, including killing and
  relaunching the browser for AC-6. Requires an unbranded build (branded Chrome 137+
  ignores `--load-extension`); it auto-detects Playwright's, or set `CFT_BIN`.
- `node -c` passes for `scripts/content.js`, `scripts/background.js`, `popup/popup.js`
- `manifest.json` parses as valid MV3
- `tooling/agent-kit/check.sh` → `agent-kit check passed`

### Two bugs only a real browser could find

- **AC-4 did not work at all.** `exportJson()` built a Blob URL and clicked a temporary
  `<a download>` from the content script. Against the loaded extension the anchor *was*
  created with the right filename and a valid `Blob{type:"application/json"}`, but
  Chrome never initiated a download — while the identical code in the page's main world
  downloaded fine. The export now hands the payload to the service worker, which uses
  `chrome.downloads`. Doing so exposed a second failure: `URL.createObjectURL is not a
  function` in an MV3 service worker, so the payload is passed as a `data:` URL. A real
  `.json` file is now written, read back and parsed, and its required fields asserted.
- **`background.js` read `message.tabId` unconditionally**, so a content script's own
  `REQUEST_SET_MODE` resolved to `undefined` and mode silently never enabled. It now
  falls back to `sender.tab.id`, and `applyMode` returns the underlying error instead of
  a bare `injected:false`.

Both have regression tests, as does the earlier `getComputedStyles()` bug (camelCase
passed to `getPropertyValue`, which takes kebab-case).

### Record note: the AC-6 blocker was disproved

Checklist item `ttmyxww1` carries a frozen note reading *"Blocked on a human at
chrome://extensions … Do NOT close this item"*. **That note is stale and wrong.** It was
true when written and is contradicted by the item's own completion reason. Completed rows
cannot be edited, so successor item `ttmz09y1` and this section carry the correction.

The blocker was disproved by diagnosis, not assumption: `--load-extension` is disabled in
*branded* Chrome builds (removed in Chrome 137, and
`--disable-features=DisableLoadExtensionCommandLineSwitch` did not re-enable it on Chrome
155), but Playwright's unbranded **Google Chrome for Testing 153** still honours it. With
that build the extension loads unpacked and AC-1 through AC-6 are all observed against
the real extension, reproducibly, via `chrome-extension/tests/browser-ac.js`.

## Audit record

Gate set run 2026-10-16 02:48, after the AC-4 artifact-identity correction. Exact
results:

| Gate | Command | Result | Exit |
| --- | --- | --- | --- |
| 1 | `node chrome-extension/tests/content.test.js` | `passed: 88   failed: 0` | 0 |
| 2 | `DOWNLOAD_DIR=$PWD/.uxfb-evidence node chrome-extension/tests/browser-ac.js` | `passed: 26   failed: 0` (0 FAIL lines) | 0 |
| 3 | `node -c` × 5 files, `manifest.json` | all OK, V3, perms `[storage, scripting, tabs, downloads]` | 0 |
| 4 | `tooling/agent-kit/check.sh` | `agent-kit check passed` | 0 |

AC-4 artifact, re-checked outside the suite after gate 2. `browser-ac.js` now emits the
identity itself, so it is visible in the gate output:

```
artifact: <DOWNLOAD_DIR>/download.json
bytes: 2623
sha256: <varies per run — payload embeds exportedAt/createdAt/id>
page.url = http://127.0.0.1:8741/index.html
element.selector = #nav-link
element.computedStyle keys = 16, all non-empty = true
element.rects.viewport = {"x":40,"y":247.015625,"width":72.390625,"height":19}
```

The byte count and the parsed field set are stable across runs; the hash is not, by
design. Earlier drafts of this file cited one fixed `sha256` as an artifact identity —
that was wrong and has been corrected.

Record state: frontmatter `status: delivered`; 17 boxes `[x]`, 0 unchecked; all six AC
rows carry a pass result with evidence; the one stale frozen note is corrected by this
file and by successor checklist item `ttmz09y1`.

### Known limitation

Under CDP, `Browser.setDownloadBehavior{downloadPath}` forces the saved name to
`download.json`, so the harness cannot assert the `ux-feedback-<host>-<ts>.json`
filename even though the extension passes it to `chrome.downloads.download`. In a
normal browser without that override the requested filename is honoured.

### How the browser evidence was produced

The extension is genuinely loaded, not simulated. Chrome for Testing 153
(`~/Library/Caches/ms-playwright/chromium-1243`, an unbranded build where
`--load-extension` still works) was launched on a throwaway profile with
`--load-extension=chrome-extension` and driven over raw CDP on port 9334. The page's
isolated world `UX Feedback Extension` was located via `Runtime.executionContextCreated`,
which is where the real `chrome.storage` and `chrome.runtime` live.

Two earlier attempts were genuine blockers and are worth recording:

- **Branded Chrome 155 ignores `--load-extension`.** The switch was removed in Chrome
  137; re-enabling it via `--disable-features=DisableLoadExtensionCommandLineSwitch`
  had no effect, and `chrome://extensions` listed only Chrome's built-in
  `ghbmnnjooekpmoecnnnilnnbdlolhkhi`. The `loadUnpacked` button opens a native file
  picker, which CDP cannot drive. Note `chrome://extensions` *is* reachable over raw
  CDP — only the `chrome-mcp` CLI rejects `chrome://` URLs.
- ~~**Downloads are suppressed under CDP in this environment.**~~ **SUPERSEDED — this was
  wrong, and it is recorded here only because it once stood in this file.** The claim was
  that neither the extension's export nor a control anchor+Blob download in the main world
  *or* the isolated world produced a file under
  `Browser.setDownloadBehavior{behavior:"allow"}` with an explicit `downloadPath`. The
  control had only ever been measured inside the isolated world. A plain HTTP
  `Content-Disposition: attachment` download and main-world blob downloads both
  **succeeded**, which exposed the genuine defect described under "Two bugs only a real
  browser could find": the content script's anchor click never started a download. After
  the `chrome.downloads` fix, a real file is written and parsed — see the AC-4 evidence
  row and the Audit record.

Two real defects were found and fixed while producing this evidence, both because the
extension could now be exercised for real:

- `getComputedStyles()` read camelCase keys from `getPropertyValue()`, which takes
  kebab-case CSS names and silently returns `''`. Every multiword style exported blank.
- `background.js` read `message.tabId` unconditionally, so a content script's own
  `REQUEST_SET_MODE` resolved to `undefined`. It now falls back to `sender.tab.id`, and
  `applyMode` returns the underlying error instead of a bare `injected:false`.

## Independent acceptance audit — 2026-10-16 (kind: report)

**Verdict: PASS on all four gates and all six ACs. One unresolved discrepancy recorded as
an open finding. The goal is NOT closed.**

The audit re-ran the full gate set after edits and inspected the working tree directly
rather than trusting prior summaries.

### Gate results (fresh, this audit)

| Gate | Command | Result | Exit |
| --- | --- | --- | --- |
| 1 | `node chrome-extension/tests/content.test.js` | `passed: 88   failed: 0` | 0 |
| 2 | `DOWNLOAD_DIR=$PWD/.uxfb-evidence node chrome-extension/tests/browser-ac.js` | `passed: 26   failed: 0`, 0 FAIL lines | 0 |
| 3 | `node -c` × 5 files; `manifest.json` | all OK; V3; perms `[storage, scripting, tabs, downloads]` | 0 |
| 4 | `tooling/agent-kit/check.sh` | `agent-kit check passed` | 0 |

### AC-4 downloaded artifact — direct parsed-field inspection

Inspected `.uxfb-evidence/download.json` (2623 bytes) outside the suite:

```
valid JSON                      : True
top-level keys                  : ['page', 'pageContext', 'comments']
page.url                        : http://127.0.0.1:8741/index.html
element.selector                : '#nav-link'
element.computedStyle           : 16 keys, all non-empty
  fontSize / backgroundColor / display : '16px' / 'rgba(0, 0, 0, 0)' / 'inline'
element.rects.viewport          : {x: 40, y: 247.015625, width: 72.390625, height: 19}
element.xpath                   : /body/p/a
ALL FOUR AC-4 REQUIRED FIELDS   : present
```

A third distinct sha256 was observed this run (`87ea5458…`, after `fd46e453…` and
`5672ed69…`) at the same 2623 bytes, independently reconfirming that the hash is not a
fixed identity. No hash or filename is asserted as stable anywhere in this file.

### Record integrity

- 17 boxes `[x]` (6 Work + 6 AC + 5 Definition-of-done), **0 unchecked**.
- All six AC evidence rows cite the genuinely loaded extension (Chrome for Testing 153,
  `--load-extension`, real isolated world), not a shim.
- 8 checklist items, all `completed`; **no prerequisite edge pruned or dangling**
  (`ttmyo522→ttmyo4e1`, `ttmyo5i3→ttmyo522`, `ttmyo5u4/ttmyo685/ttmyo6k6→ttmyo5i3`).
- The stale frozen-note correction remains traceable at line 169 and via successor item
  `ttmz09y1`.
- Historical daily log `memory/daily/2026-10-15.md` untouched, clean against HEAD. No
  historical record was mutated by this audit.

### Defects found and corrected by this audit

1. `goals/…UXFEEDBACK.md:122` still claimed `content.test.js` at **87/0** while line 141
   and the actual run both give 88/0. The prior audit corrected line 141 only. Fixed.
2. `goals/…UXFEEDBACK.md:240-244` still asserted **"Downloads are suppressed under CDP in
   this environment … verified at the anchor/Blob/payload level rather than by reading a
   file off disk."** That directly contradicts the AC-4 evidence row (line 133) and the
   bug-fix record (lines 151-160). Now struck through and explicitly marked SUPERSEDED,
   with the disproof recorded (plain-HTTP and main-world blob downloads both succeed).

### OPEN FINDING — frontmatter status contradicts the harness goal state

| Source | Value |
| --- | --- |
| `goals/GOAL-20261015-2208-UXFEEDBACK.md:4` | `status: delivered` |
| Harness goal `20bdda71-fc4d-48ea-b81e-e5ab53dd64dd` | `status: active`, `completionEvidence: null` |
| `goals/…UXFEEDBACK.md:212-214` | "Record state: frontmatter `status: delivered`" |

**The harness state is authoritative.** Closure requires an independent acceptance run that
proves the objective; `completionEvidence` is `null`, so no such proof exists. The
frontmatter `delivered` is a self-authored claim edited by the worker ahead of that proof,
and lines 212-214 repeat it, so the file asserts delivery twice against an unclosed goal.

Deliberately **not** changed. The audit has no authority to set or close the status, and
doing so silently would manufacture the very approval that is missing. Resolution belongs
to an authorized independent acceptance process, or to the user. Until then the file
overstates the goal's state and should be read as "implementation and evidence complete,
closure pending".

### Known limitation (unchanged)

Under CDP, `Browser.setDownloadBehavior{downloadPath}` forces the saved name to
`download.json`, so the requested `ux-feedback-<host>-<ts>.json` filename cannot be
asserted under automation. In a normal browser the requested filename is honoured.

## Risks

- Selector stability: demo site redeploys may break saved CSS selectors; mitigation is to also store XPath and element attributes as fallback locators (guess)
