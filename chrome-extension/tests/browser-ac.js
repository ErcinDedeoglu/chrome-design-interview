/**
 * Browser acceptance checks against the genuinely loaded extension.
 *
 * This exists because the AC evidence cannot be produced by the headless suite:
 * AC-1..AC-6 are all browser observations, and running them revealed two bugs
 * the headless harness structurally could not catch.
 *
 * It launches Chrome for Testing (an unbranded build — branded Chrome 137+
 * ignores --load-extension), loads chrome-extension/ unpacked, and drives the
 * page's isolated world over raw CDP. The isolated world is where the real
 * chrome.storage / chrome.runtime live; the main world is only used to click
 * and read the shared DOM.
 *
 * Requires the `ws` WebSocket global (Node 22+). No dependencies.
 *
 * Usage: node chrome-extension/tests/browser-ac.js
 * Env:   CFT_BIN   path to the Chrome for Testing binary (auto-detected)
 *       CDP_PORT   debugging port (default 9334)
 */
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.CDP_PORT || 9334);
const DEMO_PORT = Number(process.env.DEMO_PORT || 8741);
const EXT_DIR = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'uxfb-ac-profile');
// The downloads directory is outside the workspace by default (macOS
// os.tmpdir() is a per-user private dir that other tooling may be denied
// access to). Set DOWNLOAD_DIR to place the artifact somewhere reachable.
const DOWNLOADS = process.env.DOWNLOAD_DIR
  || path.join(os.tmpdir(), 'uxfb-ac-downloads');
const DEMO_URL = `http://127.0.0.1:${DEMO_PORT}/index.html`;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

// ── Locate a Chrome for Testing binary ────────────────────────────────
function findChrome() {
  if (process.env.CFT_BIN && fs.existsSync(process.env.CFT_BIN)) return process.env.CFT_BIN;
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base).sort().reverse()) {
    if (!d.startsWith('chromium-')) continue;
    const exe = path.join(base, d, 'chrome-mac-arm64',
      'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

// ── Tiny static server for the demo page ─────────────────────────────
const DEMO_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Demo Checkout</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:40px}
h1{font-size:28px}.panel{border:1px solid #ddd;padding:16px;border-radius:8px;max-width:420px}
button{padding:8px 14px;margin-right:8px}</style></head><body>
<h1 id="checkout-title">Checkout</h1>
<div class="panel" id="order-summary"><p>Order total: <strong>$42.00</strong></p>
<button id="pay-button">Pay now</button><button id="cancel-button">Cancel</button></div>
<p><a id="nav-link" href="https://example.com/navigated">Leave site</a></p>
<div style="height:1200px"></div><h2 id="footer-heading">Footer</h2>
<div style="height:3000px"></div></body></html>`;

// ── CDP plumbing ─────────────────────────────────────────────────────
async function httpJson(url) { return (await fetch(url)).json(); }

function connect(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1; const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method && onEvent) onEvent(m);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      }
    };
    ws.onerror = () => reject(new Error('ws error'));
    ws.onopen = () => resolve({
      send(method, params = {}) {
        const n = id++;
        return new Promise((res, rej) => {
          pending.set(n, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id: n, method, params }));
        });
      },
      close: () => ws.close(),
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(cdp, ctx, expression, awaitPromise = true) {
  const r = await cdp.send('Runtime.evaluate', {
    contextId: ctx.id, expression, awaitPromise, returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(JSON.stringify(r.exceptionDetails.exception));
  }
  return r.result.value;
}

/** Open the demo page and return its isolated + main execution contexts. */
async function openDemo(cdp, contexts) {
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: DEMO_URL });
  await sleep(3200);
  // Re-enable Runtime so the current contexts are re-emitted after navigation.
  contexts.length = 0;
  await cdp.send('Runtime.disable');
  await cdp.send('Runtime.enable');
  await sleep(900);
  return {
    iso: contexts.find((c) => c.name && /UX Feedback/i.test(c.name)),
    main: contexts.find((c) => c.name === ''),
  };
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log('No Chrome for Testing binary found. Set CFT_BIN.');
    console.log('Branded Chrome ignores --load-extension since Chrome 137, so a');
    console.log('branded build cannot run these checks.');
    process.exit(2);
  }
  console.log('\nUX Feedback — browser acceptance checks (real loaded extension)');
  console.log('binary: ' + chrome);

  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  for (const f of fs.readdirSync(DOWNLOADS)) fs.rmSync(path.join(DOWNLOADS, f), { force: true });

  // Static demo server.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DEMO_HTML);
  });
  await new Promise((r) => server.listen(DEMO_PORT, '127.0.0.1', r));

  const { spawn } = require('child_process');
  const proc = spawn(chrome, [
    `--user-data-dir=${PROFILE}`,
    `--load-extension=${EXT_DIR}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling',
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp, browserCdp;
  try {
    for (let i = 0; i < 40; i++) {
      try { await httpJson(`http://127.0.0.1:${PORT}/json/version`); break; }
      catch { await sleep(500); }
    }
    // Browser-level socket for download behaviour.
    const v = await httpJson(`http://127.0.0.1:${PORT}/json/version`);
    browserCdp = await connect(v.webSocketDebuggerUrl);
    await browserCdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true,
    });

    const list = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = list.find((t) => t.type === 'page');
    const contexts = [];
    cdp = await connect(pageTarget.webSocketDebuggerUrl, (m) => {
      if (m.method === 'Runtime.executionContextCreated') {
        contexts.push(m.params.context);
      }
    });

    // ── AC-1: sidebar on load, no toggle ────────────────────────────
    console.log('\nAC-1 sidebar on page load');
    const { iso, main: mainCtx } = await openDemo(cdp, contexts);
    if (!iso || !mainCtx) {
      throw new Error('extension isolated world not found (is the extension loaded? ' +
        'contexts=' + JSON.stringify(contexts.map((c) => c.name)) + ')');
    }
    check('content script is injected (isolated world present)', !!iso);

    const ac1 = JSON.parse(await evaluate(cdp, mainCtx, `(() => {
      const sb = document.getElementById('uxfb-sidebar');
      const cs = sb && getComputedStyle(sb);
      return JSON.stringify({
        injected: !!sb,
        heading: sb ? (sb.querySelector('h2') || {}).textContent : null,
        position: cs ? cs.position : null,
        right: cs ? cs.right : null,
        width: cs ? cs.width : null
      });})()`, false));
    check('sidebar injected with no toggle', ac1.injected === true);
    check('heading is "UX Feedback"', ac1.heading === 'UX Feedback');
    check('pinned to the right edge', ac1.position === 'fixed' && ac1.right === '0px');
    check('has a usable width', parseInt(ac1.width, 10) > 0, 'width=' + ac1.width);

    // ── AC-2: click interception ────────────────────────────────────
    console.log('\nAC-2 click interception');
    await evaluate(cdp, iso, `new Promise((r) => chrome.runtime.sendMessage(
      { type: 'REQUEST_SET_MODE', mode: true }, r))`);
    await sleep(700);
    const ac2 = JSON.parse(await evaluate(cdp, mainCtx, `(() => {
      window.__nav = false;
      document.addEventListener('click', () => { window.__nav = true; }, false);
      const a = document.getElementById('nav-link');
      const before = location.href;
      const r = a.getBoundingClientRect();
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
        clientX: r.left + 5, clientY: r.top + 5 }));
      return JSON.stringify({ urlUnchanged: location.href === before,
        editorOpen: !!document.getElementById('uxfb-editor'),
        pageHandlerFired: window.__nav });})()`, false));
    check('default action did not fire', ac2.urlUnchanged === true);
    check('the page own click handler never ran', ac2.pageHandlerFired === false);
    check('comment editor opened', ac2.editorOpen === true);

    // ── Save a comment, then read real chrome.storage.local ─────────
    await sleep(500);
    await evaluate(cdp, mainCtx, `(() => {
      const ed = document.getElementById('uxfb-editor');
      ed.querySelector('#uxfb-editor-text').value = 'Checkout heading is too large on mobile';
      ed.querySelector('#uxfb-editor-severity').value = 'high';
      ed.querySelector('#uxfb-editor-save').click(); return 1;})()`, false);
    await sleep(900);

    const stored = JSON.parse(await evaluate(cdp, iso, `(async () => {
      const all = await chrome.storage.local.get(null);
      const ck = Object.keys(all).filter((k) => k.indexOf('ux_feedback_comments') === 0);
      return JSON.stringify(ck.map((k) => ({ key: k, count: all[k].length,
        texts: all[k].map((c) => c.text),
        selectors: all[k].map((c) => c.metadata.selector),
        fontSizes: all[k].map((c) => c.metadata.computedStyle.fontSize) })));})()`));
    check('written to real chrome.storage.local under a per-page key',
      stored.length === 1 && stored[0].key.indexOf(DEMO_URL) !== -1,
      JSON.stringify(stored));
    check('comment text persisted', stored[0] && stored[0].texts[0].indexOf('too large') !== -1);
    check('computed styles are real values, not empty strings',
      stored[0] && stored[0].fontSizes[0] && stored[0].fontSizes[0].length > 0,
      JSON.stringify(stored[0] && stored[0].fontSizes));

    // ── AC-5: sidebar click scrolls and flashes ─────────────────────
    console.log('\nAC-5 sidebar navigation');
    const ac5 = JSON.parse(await evaluate(cdp, mainCtx, `(() => {
      const item = Array.from(document.querySelectorAll('.uxfb-sidebar-item'))
        .find((i) => (i.querySelector('.uxfb-sidebar-target') || {}).textContent === 'a');
      if (!item) return JSON.stringify({ clicked: false });
      const target = document.getElementById('nav-link');
      const scrollBefore = window.scrollY;
      item.click();
      return JSON.stringify({ clicked: true, scrollBefore });})()`, false));
    check('sidebar item is clickable', ac5.clicked === true);
    await sleep(400);
    const flash = JSON.parse(await evaluate(cdp, mainCtx, `(() => {
      const t = document.getElementById('nav-link');
      return JSON.stringify({ outline: t.style.outline });})()`, false));
    check('target is flashed with a blue outline',
      /66,\s*133,\s*244/.test(flash.outline), 'outline=' + flash.outline);
    await sleep(2200);
    const restored = JSON.parse(await evaluate(cdp, mainCtx, `(() => {
      const t = document.getElementById('nav-link');
      return JSON.stringify({ outline: t.style.outline });})()`, false));
    check('the flash is temporary', restored.outline === '',
      'outline=' + restored.outline);

    // ── AC-4: export really downloads a file ───────────────────────
    console.log('\nAC-4 JSON export downloads a file');
    const targets = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
    const swTarget = targets.find((t) => t.type === 'service_worker' &&
      t.url.includes('scripts/background.js'));
    if (!swTarget) throw new Error('extension service worker not found');
    const sw = await connect(swTarget.webSocketDebuggerUrl);
    await sw.send('Runtime.enable');
    const swEval = (e) => sw.send('Runtime.evaluate', {
      expression: e, awaitPromise: true, returnByValue: true,
    }).then((r) => {
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception));
      return r.result.value;
    });

    const exportRes = JSON.parse(await swEval(`(async () => {
      const tabs = await chrome.tabs.query({ url: '${DEMO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}*' });
      const res = await chrome.tabs.sendMessage(tabs[0].id, { type: 'EXPORT_JSON' });
      return JSON.stringify({ tabId: tabs[0].id, res }); })()`));
    check('EXPORT_JSON reached the content script',
      exportRes && exportRes.res && exportRes.res.success === true,
      JSON.stringify(exportRes));
    sw.close();
    await sleep(4000);

    const files = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.json'));
    check('a .json file was written to disk', files.length > 0,
      'files in ' + DOWNLOADS + ': ' + JSON.stringify(fs.readdirSync(DOWNLOADS)));
    if (files.length > 0) {
      const file = path.join(DOWNLOADS, files[0]);
      const raw = fs.readFileSync(file);
      const parsed = JSON.parse(raw.toString('utf8'));
      const el = parsed.comments && parsed.comments[parsed.comments.length - 1].element;
      check('export contains page.url', typeof parsed.page.url === 'string');
      check('export contains element.selector', !!(el && el.selector));
      check('export contains element.computedStyle',
        !!(el && el.computedStyle && Object.keys(el.computedStyle).length >= 16));
      check('export computed styles are non-empty',
        !!(el && Object.values(el.computedStyle).every((v) => v.length > 0)));
      check('export contains element.rects.viewport', !!(el && el.rects.viewport));

      // Print the artifact's identity and the four fields AC-4 names, so the
      // proof travels with the suite output instead of requiring separate
      // filesystem access to a temp directory.
      console.log('\n  artifact: ' + file);
      console.log('  bytes: ' + raw.length);
      console.log('  sha256: ' + crypto.createHash('sha256').update(raw).digest('hex'));
      console.log('  page.url = ' + parsed.page.url);
      console.log('  element.selector = ' + el.selector);
      console.log('  element.computedStyle keys = ' +
        Object.keys(el.computedStyle).length +
        ', all non-empty = ' + Object.values(el.computedStyle).every((v) => v.length > 0));
      console.log('  element.rects.viewport = ' + JSON.stringify(el.rects.viewport));
    }

    // ── AC-6: restart the browser, confirm durability ───────────────
    console.log('\nAC-6 survival across a browser restart');
    proc.kill('SIGTERM');
    await sleep(3000);
    const proc2 = spawn(chrome, [
      `--user-data-dir=${PROFILE}`,
      `--load-extension=${EXT_DIR}`,
      `--remote-debugging-port=${PORT}`,
      '--no-first-run', '--no-default-browser-check',
      'about:blank',
    ], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 40; i++) {
        try { await httpJson(`http://127.0.0.1:${PORT}/json/version`); break; }
        catch { await sleep(500); }
      }
      const list2 = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
      const page2 = list2.find((t) => t.type === 'page');
      const ctx2 = [];
      const cdp2 = await connect(page2.webSocketDebuggerUrl, (m) => {
        if (m.method === 'Runtime.executionContextCreated') ctx2.push(m.params.context);
      });
      const after = await openDemo(cdp2, ctx2);
      if (!after.iso || !after.main) throw new Error('contexts missing after restart');

      const restoredComments = JSON.parse(await evaluate(cdp2, after.iso, `(async () => {
        const all = await chrome.storage.local.get(null);
        const ck = Object.keys(all).filter((k) => k.indexOf('ux_feedback_comments') === 0);
        return JSON.stringify({ keys: ck, counts: ck.map((k) => all[k].length),
          texts: ck.map((k) => all[k].map((c) => c.text)) });})()`));
      check('comment survived the browser restart',
        restoredComments.counts.length === 1 && restoredComments.counts[0] === 1,
        JSON.stringify(restoredComments));

      const sidebarAfter = JSON.parse(await evaluate(cdp2, after.main, `(() => {
        return JSON.stringify({
          injected: !!document.getElementById('uxfb-sidebar'),
          items: document.querySelectorAll('.uxfb-sidebar-item').length,
          text: (document.querySelector('.uxfb-sidebar-item-text') || {}).textContent,
          badgesWhileModeOff: document.querySelectorAll('.uxfb-badge').length });})()`, false));
      check('sidebar restored on load', sidebarAfter.injected === true);
      check('the comment is listed in the sidebar', sidebarAfter.items === 1,
        'items=' + sidebarAfter.items);
      check('no badges while mode is off', sidebarAfter.badgesWhileModeOff === 0);

      await evaluate(cdp2, after.iso, `new Promise((r) => chrome.runtime.sendMessage(
        { type: 'REQUEST_SET_MODE', mode: true }, r))`);
      await sleep(900);
      const badges = JSON.parse(await evaluate(cdp2, after.main,
        `JSON.stringify(Array.from(document.querySelectorAll('.uxfb-badge')).map((b) => b.textContent))`, false));
      check('numbered badge re-renders from the restored comment',
        badges.length === 1 && badges[0] === '1', JSON.stringify(badges));

      cdp2.close();
    } finally {
      proc2.kill('SIGTERM');
    }
  } finally {
    if (cdp) cdp.close();
    if (browserCdp) browserCdp.close();
    try { proc.kill('SIGTERM'); } catch { /* already gone */ }
    server.close();
  }

  console.log('\n' + '-'.repeat(52));
  console.log('passed: ' + passed + '   failed: ' + failed);
  fs.rmSync(PROFILE, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });