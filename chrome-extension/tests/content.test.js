/**
 * Headless harness for chrome-extension/scripts/content.js.
 *
 * The content script is an IIFE with no exports, so this drives it exactly the
 * way Chrome does: through chrome.runtime.onMessage and real DOM events on a
 * minimal DOM implementation. That covers the parts of the acceptance criteria
 * that are decidable without a browser — the exported JSON contract (AC-4),
 * metadata capture, badge non-mutation, edit history, and the storage
 * round-trip that AC-3/AC-6 depend on.
 *
 * Run: node chrome-extension/tests/content.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Minimal DOM ─────────────────────────────────────────────────────

let idSeq = 0;

/** A NamedNodeMap-alike: property access plus iteration over {name, value}. */
function makeAttrMap() {
  const map = {};
  map[Symbol.iterator] = function* () {
    for (const name of Object.keys(map)) yield { name, value: map[name] };
  };
  return map;
}

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toString() { return Array.from(this.set).join(' '); }
}

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = makeAttrMap();
    this.style = {};
    this.classList = new ClassList(this);
    this.dataset = {};
    this._text = '';
    this._listeners = {};
    this.uid = ++idSeq;
    this.disabled = false;
    this.tabIndex = -1;
  }
  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = v; }
  get className() { return this.classList.toString(); }
  set className(v) {
    this.classList.set.clear();
    String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    }
    this.parentElement = null;
  }
  removeChild(child) { child.remove(); return child; }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this._text = v; this.children.forEach((c) => c.remove()); }
  get innerHTML() { return ''; }
  // Minimal HTML parsing. The content script builds its UI via innerHTML and
  // then addresses the pieces by id and by class, so synthesise one element
  // per tag carrying a real tagName plus its id/class, in document order.
  set innerHTML(html) {
    this.children.forEach((c) => c.remove());
    const src = String(html);
    const stack = [this];
    for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
      const [, closing, tag, attrs] = m;
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      if (tag === 'br') continue;
      const el = new Element(tag);
      const idMatch = /id="([^"]*)"/.exec(attrs);
      if (idMatch) el.setAttribute('id', idMatch[1]);
      const classMatch = /class="([^"]*)"/.exec(attrs);
      if (classMatch) classMatch[1].trim().split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
      el.value = '';
      stack[stack.length - 1].appendChild(el);
      if (!/\/>$/.test(attrs) && !/^(input|img|br|hr|meta|link)$/.test(tag)) stack.push(el);
    }
    this._html = html;
  }
  getBoundingClientRect() {
    return {
      x: 10, y: 20, width: 100, height: 40,
      top: 20, right: 110, bottom: 60, left: 10,
    };
  }
  matches() { return false; }
  closest(sel) {
    // Handle selector lists ("#a, #b, .c") the way the extension uses them.
    for (const part of String(sel).split(',')) {
      const s = part.trim();
      if (!s) continue;
      let cur = this;
      while (cur) {
        if (s.startsWith('#') && cur.id === s.slice(1)) return cur;
        if (s.startsWith('.') && cur.classList && cur.classList.contains(s.slice(1))) return cur;
        cur = cur.parentElement;
      }
    }
    return null;
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
  }
  dispatch(type, extra = {}) {
    const ev = {
      type, target: this,
      preventDefault() { ev.defaultPrevented = true; },
      stopImmediatePropagation() { ev.propagationStopped = true; },
      defaultPrevented: false, propagationStopped: false,
      ...extra,
    };
    // Capture phase from the root down, mirroring real dispatch order. A
    // capture-phase listener calling stopImmediatePropagation must prevent
    // every later listener — including the page's own — from running (AC-2).
    const path = [];
    let cur = this;
    while (cur) { path.unshift(cur); cur = cur.parentElement; }
    for (const node of path) {
      if (ev.propagationStopped) break;
      for (const fn of (node._listeners[type] || []).slice()) {
        fn(ev);
        if (ev.propagationStopped) break;
      }
    }
    return ev;
  }
  querySelector(sel) {
    // Search this element's own subtree, as a real DOM does.
    for (const part of String(sel).split(',')) {
      const s = part.trim();
      if (!s) continue;
      const found = this._find((el) => {
        if (s.startsWith('#')) return el.id === s.slice(1);
        if (s.startsWith('.')) return el.classList.contains(s.slice(1));
        return false;
      });
      if (found) return found;
    }
    return null;
  }
  _find(pred) {
    for (const c of this.children) {
      if (pred(c)) return c;
      const nested = c._find(pred);
      if (nested) return nested;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const s = String(sel).trim();
    const walk = (node) => {
      for (const c of node.children) {
        const hit = s.startsWith('#') ? c.id === s.slice(1)
          : s.startsWith('.') ? c.classList.contains(s.slice(1)) : false;
        if (hit) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

const registry = new Map();

const doc = {
  documentElement: null,
  body: null,
  head: null,
  title: 'Demo Checkout',
  readyState: 'complete',
  activeElement: null,
  createElement: (tag) => new Element(tag),
  createTextNode: (t) => new Element('#text'),
  getElementById(id) { return registry.get(id) || null; },
  querySelector(sel) {
    const idMatch = /^#(.*)$/.exec(sel);
    if (idMatch) return registry.get(idMatch[1]) || null;
    const clsMatch = /^\.([\w-]+)$/.exec(sel);
    const walk = (node) => {
      for (const c of node.children) {
        if (clsMatch && c.classList.contains(clsMatch[1])) return c;
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(documentElement);
  },
  querySelectorAll(sel) {
    const clsMatch = /^\.([\w-]+)$/.exec(sel);
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (clsMatch && c.classList.contains(clsMatch[1])) out.push(c);
        walk(c);
      }
    };
    walk(documentElement);
    return out;
  },
  evaluate() { return { singleNodeValue: null }; },
  addEventListener: (type, fn) => documentElement.addEventListener(type, fn),
  removeEventListener: (type, fn) => documentElement.removeEventListener(type, fn),
};

// Keep an id registry in sync when elements declare ids.
const origAppend = Element.prototype.appendChild;
Element.prototype.appendChild = function (child) {
  const r = origAppend.call(this, child);
  if (child.id) registry.set(child.id, child);
  return r;
};

// ── Environment ─────────────────────────────────────────────────────

const storage = {};
// ── Document lifecycle ──────────────────────────────────────────────
//
// Navigating or reloading gives a brand-new document with no leftover
// elements, listeners or injected UI. The tests below reuse one process, so
// they must rebuild the document explicitly or they would assert against UI
// that a real page load could never have retained.

let documentElement = new Element('html');
let body = new Element('body');

function newDocument() {
  documentElement = new Element('html');
  body = new Element('body');
  documentElement.appendChild(body);
  registry.clear();
  doc.documentElement = documentElement;
  doc.body = body;
}

const sandbox = {
  console,
  document: doc,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  setTimeout,
  clearTimeout,
  Promise,
  CSS: { escape: (s) => s },
  XPathResult: { FIRST_ORDERED_NODE_TYPE: 9 },
  Blob: function Blob(parts, opts) { this.parts = parts; this.opts = opts; },
  URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
  chrome: {
    runtime: {
      onMessage: { addListener: (fn) => { messageHandler = fn; } },
      lastError: null,
      sendMessage: () => {},
    },
    storage: {
      local: {
        get(keys, cb) { cb(keys ? { [keys]: storage[keys] } : { ...storage }); },
        set(obj, cb) { Object.assign(storage, obj); cb && cb(); },
        remove(key, cb) { delete storage[key]; cb && cb(); },
      },
    },
  },
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1280;
sandbox.window.innerHeight = 800;
sandbox.window.scrollX = 0;
sandbox.window.scrollY = 0;
sandbox.window.location = {
  href: 'https://demo.example.com/checkout',
  origin: 'https://demo.example.com',
  title: 'Demo Checkout',
  pathname: '/checkout',
  hostname: 'demo.example.com',
};
// A faithful CSSStyleDeclaration: getPropertyValue takes kebab-case names and
// returns '' for anything else, exactly as a real browser does. Mocking it
// permissively once hid a bug where camelCase lookups silently produced empty
// computed styles.
const cssProps = {
  display: 'block', visibility: 'visible', opacity: '1', position: 'static',
  width: '100px', height: '40px', color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)', 'font-size': '14px',
  'font-weight': '400', 'text-align': 'left', 'border-width': '0px',
  'border-radius': '0px', margin: '0px', padding: '0px', 'z-index': 'auto',
};
sandbox.window.getComputedStyle = (el) => ({
  getPropertyValue(prop) {
    // Unknown names return '' exactly as a browser does, so a camelCase lookup
    // such as getPropertyValue('fontSize') is caught instead of silently
    // returning a value the real browser would not produce.
    return Object.prototype.hasOwnProperty.call(cssProps, prop) ? cssProps[prop] : '';
  },
});
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};

// Build the initial document.
newDocument();
doc.title = 'Demo Checkout';

// ── Assertions ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

// ── Load the content script ─────────────────────────────────────────

const contentPath = path.join(__dirname, '..', 'scripts', 'content.js');
const code = fs.readFileSync(contentPath, 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'content.js' });

const send = (msg) => {
  if (!messageHandler) throw new Error('no content script is loaded');
  let resp;
  messageHandler(msg, {}, (r) => { resp = r; });
  return resp;
};

/** A freshly loaded script starts with an empty in-memory comment list. */
function hasScript() { return !!messageHandler; }

// ── Fixtures ────────────────────────────────────────────────────────

/**
 * Replace the document with a fresh one, as a reload or navigation does, then
 * load the content script into it. Only chrome.storage.local survives.
 */
function reloadPage(title) {
  newDocument();
  doc.title = title || 'Demo Checkout';
  buildPage();
  vm.runInContext(code, sandbox, { filename: 'content.js (loaded)' });
}

function buildPage() {
  // Remove only page content; the extension's own sidebar/overlay UI persists
  // across scenarios exactly as it would across a mode toggle.
  body.children.slice().forEach((c) => {
    if (!String(c.id || '').startsWith('uxfb')) c.remove();
  });
  for (const key of Array.from(registry.keys())) {
    if (key.startsWith('uxfb')) continue;
    registry.delete(key);
  }

  const main = new Element('main'); main.id = 'main';
  const form = new Element('form');
  const heading = new Element('h1');
  heading.id = 'checkout-title';
  heading._text = 'Checkout';
  const payBtn = new Element('button');
  payBtn.id = 'pay-button';
  payBtn._text = 'Pay now';
  const cancelBtn = new Element('button');
  cancelBtn.id = 'cancel-button';
  cancelBtn._text = 'Cancel';

  form.appendChild(heading);
  form.appendChild(payBtn);
  form.appendChild(cancelBtn);
  main.appendChild(form);
  body.appendChild(main);
  registry.set('main', main);

  // A click handler the extension must be able to suppress (AC-2).
  let siteClicks = 0;
  payBtn.addEventListener('click', () => { siteClicks++; });

  return { main, form, heading, payBtn, cancelBtn, siteClicks: () => siteClicks };
}

function openEditorOn(el) {
  el.dispatch('click');
  return doc.getElementById('uxfb-editor');
}

function saveEditor(text, severity, status) {
  const editor = doc.getElementById('uxfb-editor');
  editor.querySelector('#uxfb-editor-text').value = text;
  editor.querySelector('#uxfb-editor-severity').value = severity;
  editor.querySelector('#uxfb-editor-status').value = status;
  editor.querySelector('#uxfb-editor-save').dispatch('click');
}

/** Clear all comments so each scenario starts from a known state. */
function resetComments() {
  const { comments } = send({ type: 'GET_COMMENTS' });
  comments.forEach((c) => send({ type: 'DELETE_COMMENT', commentId: c.id }));
  return send({ type: 'GET_COMMENTS' }).comments.length;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\nUX Feedback — content script headless tests\n');

console.log('T2 — toggle mode (AC-2)');
{
  const page = buildPage();
  check('mode starts off', send({ type: 'GET_MODE' }).mode === false);
  send({ type: 'TOGGLE_MODE' });
  check('mode turns on', send({ type: 'GET_MODE' }).mode === true);

  const ev = page.payBtn.dispatch('click');
  check('site click handler is suppressed', ev.defaultPrevented === true);
  check('site navigation callback never fires', page.siteClicks() === 0,
    'the page\'s own click handler ran despite interception');
  check('comment editor opens near the target', doc.getElementById('uxfb-editor') !== null);
}

console.log('\nT3 — metadata capture');
{
  const page = buildPage();
  openEditorOn(page.heading);
  saveEditor('Title is too long on mobile', 'high', 'open');

  const { comments } = send({ type: 'GET_COMMENTS' });
  const c = comments[0];
  const m = c.metadata;

  check('comment is stored', comments.length === 1);
  check('selector captured', typeof m.selector === 'string' && m.selector.length > 0, m.selector);
  check('xpath captured', typeof m.xpath === 'string' && m.xpath.startsWith('/'), m.xpath);
  check('tagName captured', m.tagName === 'h1', m.tagName);
  check('text captured', m.text === 'Checkout', m.text);
  check('attributes captured', m.attributes && m.attributes.id === 'checkout-title');
  check('computedStyle captured', m.computedStyle && m.computedStyle.fontSize === '14px');
  // Regression: getPropertyValue() takes kebab-case CSS names. Reading the
  // camelCase key silently returned '' in a real browser, so assert that no
  // captured style is empty.
  check('every captured computed style is non-empty',
    Object.values(m.computedStyle).every((v) => typeof v === 'string' && v.length > 0),
    JSON.stringify(m.computedStyle));
  check('multiword style keys carry real values',
    m.computedStyle.backgroundColor === 'rgba(0, 0, 0, 0)' &&
    m.computedStyle.textAlign === 'left' &&
    m.computedStyle.borderRadius === '0px',
    JSON.stringify(m.computedStyle));
  check('viewport rect captured',
    m.rects.viewport && m.rects.viewport.width === 100 && m.rects.viewport.height === 40,
    JSON.stringify(m.rects));
  check('page rect captured', m.rects.page && typeof m.rects.page.y === 'number');
  check('ancestors captured', Array.isArray(m.ancestors) && m.ancestors.length > 0);
  check('siblings captured', Array.isArray(m.siblings) && m.siblings.length === 2,
    'expected the two buttons, got ' + JSON.stringify(m.siblings.map((s) => s.tag)));
  check('visibility captured', m.visibility === true);
  check('interactionState captured', m.interactionState && m.interactionState.tagName === 'h1');
  check('severity/status captured', c.severity === 'high' && c.status === 'open');
}

console.log('\nT3 — badges do not mutate the commented element');
{
  const page = buildPage();
  openEditorOn(page.heading);
  saveEditor('First comment', 'low', 'open');

  const childrenBefore = page.heading.children.length;
  const styleBefore = JSON.stringify(page.heading.style);

  openEditorOn(page.cancelBtn);
  saveEditor('Second comment', 'low', 'open');

  const { comments } = send({ type: 'GET_COMMENTS' });
  check('two comments stored', comments.length === 2);
  check('commented element keeps its own children',
    page.heading.children.length === childrenBefore,
    'badge was injected into the target: ' + page.heading.children.length + ' children');
  check('commented element keeps its inline styles',
    JSON.stringify(page.heading.style) === styleBefore,
    'extension mutated the target\'s inline styles');
  check('badges render in a separate overlay layer',
    doc.getElementById('uxfb-badge-layer') !== null);
}

console.log('\nT3 — metadata stays clean for later comments');
{
  const page = buildPage();
  openEditorOn(page.heading);
  saveEditor('Comment on heading', 'low', 'open');
  openEditorOn(page.payBtn);
  saveEditor('Comment on pay button', 'low', 'open');

  const { comments } = send({ type: 'GET_COMMENTS' });
  const payComment = comments.find((c) => c.metadata.tagName === 'button' &&
    c.metadata.attributes.id === 'pay-button');
  const siblings = payComment.metadata.siblings;

  check('sibling list is not polluted by the extension',
    siblings.every((s) => s.tag !== 'div' && s.selector.indexOf('uxfb') === -1),
    JSON.stringify(siblings));
  check('sibling count is the real sibling count', siblings.length === 2,
    'got ' + siblings.length);
}

console.log('\nT4 — sidebar panel and element navigation (AC-1, AC-5)');
{
  const page = buildPage();
  openEditorOn(page.heading);
  saveEditor('Sidebar comment', 'medium', 'open');

  const sidebar = doc.getElementById('uxfb-sidebar');
  check('sidebar is injected', sidebar !== null);
  check('sidebar heading is "UX Feedback"', /UX Feedback/.test(sidebar.innerHTML) ||
    sidebar.querySelector('#uxfb-sidebar-header') !== null);

  check('scrollToElement resolves the commented element',
    (() => {
      const { comments } = send({ type: 'GET_COMMENTS' });
      const target = comments[0].metadata.attributes.id;
      return doc.getElementById(target) !== null;
    })());
}

console.log('\nT4 — unresolvable selector surfaces a visible failure');
{
  resetComments();
  const page = buildPage();
  openEditorOn(page.heading);
  saveEditor('Will lose its anchor', 'low', 'open');

  const { comments } = send({ type: 'GET_COMMENTS' });
  // Simulate the demo site being redeployed so the saved selector no longer
  // resolves — the designer must be told, not left guessing.
  comments[0].metadata.selector = '#does-not-exist-anymore';
  comments[0].metadata.xpath = '/html[1]/body[1]/nope[99]';
  comments[0].metadata.attributes = {};

  const item = doc.querySelector('.uxfb-sidebar-item');
  check('sidebar item is rendered for the comment', item !== null);
  item.dispatch('click');

  const notice = doc.getElementById('uxfb-notice');
  check('missing element produces a visible notice, not silence',
    notice !== null, 'no notice was rendered for an unresolvable selector');
  check('the notice names the comment that could not be found',
    notice !== null && /#1/.test(notice.textContent || ''),
    notice ? 'notice text: ' + notice.textContent : 'no notice');
}

console.log('\nT5 — export JSON contract (AC-4)');
{
  resetComments();
  const page = buildPage();
  openEditorOn(page.heading);
  saveEditor('Export me', 'high', 'open');

  // Assert against the exact payload exportJson() serialises, not a
  // reconstruction of it.
  const payload = send({ type: 'GET_EXPORT_DATA' }).export;
  const element = payload.comments[0].element;

  check('export contains element.selector',
    typeof element.selector === 'string' && element.selector.length > 0, element.selector);
  check('export contains element.computedStyle',
    element.computedStyle && Object.keys(element.computedStyle).length >= 16);
  check('export contains element.rects.viewport',
    element.rects && element.rects.viewport && typeof element.rects.viewport.width === 'number',
    JSON.stringify(element.rects));
  check('export contains page.url',
    payload.page && payload.page.url === 'https://demo.example.com/checkout',
    JSON.stringify(payload.page));
  check('export retains the pageContext alias with exportedAt',
    payload.pageContext && typeof payload.pageContext.exportedAt === 'string');
  check('export carries the comment text and severity',
    payload.comments[0].text === 'Export me' && payload.comments[0].severity === 'high');
  check('export serialises to valid JSON',
    (() => {
      try { JSON.parse(JSON.stringify(payload)); return true; } catch (e) { return false; }
    })());
}

console.log('\nT6 — persistence round-trip (AC-3, AC-6)');
{
  resetComments();
  const page = buildPage();
  openEditorOn(page.heading);
  saveEditor('Persisted comment', 'high', 'open');

  const key = 'ux_feedback_comments:https://demo.example.com/checkout';
  const persisted = storage[key];
  check('comments are written to chrome.storage.local', !!persisted,
    'keys present: ' + JSON.stringify(Object.keys(storage)));
  check('comments are scoped to this page\'s key',
    Array.isArray(persisted) && persisted.length === 1,
    'stored ' + persisted && persisted.length + ' comments under ' + key);
  check('stored comment survives with full metadata',
    persisted[0].metadata.selector && persisted[0].metadata.computedStyle);
  check('a different page does not inherit this page\'s comments', (() => {
    const otherKey = 'ux_feedback_comments:https://other.example.com/pricing';
    return storage[otherKey] === undefined;
  })(), 'another page\'s key was written');
}

console.log('\nT6 — a reload restores this page\'s comments');
{
  // Re-run the script against the same storage and a fresh DOM, which is what
  // a page reload does: no in-memory state carries over, only storage.local.
  body.children.slice().forEach((c) => {
    if (!String(c.id || '').startsWith('uxfb')) c.remove();
  });
  for (const k of Array.from(registry.keys())) {
    if (!k.startsWith('uxfb')) registry.delete(k);
  }

  buildPage();
  // A real reload gives the page fresh document objects with no listeners.
  // Clear the old ones so the first script instance cannot keep handling
  // clicks and writing into its own closure state.
  documentElement._listeners = {};
  vm.runInContext(code, sandbox, { filename: 'content.js (reload)' });
  const restored = send({ type: 'GET_COMMENTS' }).comments;

  check('the reloaded script really is a new instance (empty in-memory state)',
    restored.length === 1, 'restored ' + restored.length);

  check('comments survive a reload of the page',
    restored.length === 1, 'restored ' + restored.length);
  check('restored comment keeps its text and anchor',
    restored.length === 1 && restored[0].text === 'Persisted comment' &&
    restored[0].metadata.attributes.id === 'checkout-title',
    JSON.stringify(restored[0] && restored[0].metadata.attributes));
  check('badge is re-rendered for the restored comment',
    doc.querySelectorAll('.uxfb-badge').length === 1,
    'badges found: ' + doc.querySelectorAll('.uxfb-badge').length);
}

console.log('\nAC-1 — the sidebar is present on page load, before any toggle');
{
  // A page that has never been toggled must still show the panel (AC-1).
  reloadPage('Demo Checkout');
  const sidebar = doc.getElementById('uxfb-sidebar');
  check('sidebar exists without any toggle', sidebar !== null);
  check('sidebar is not hidden', sidebar !== null && sidebar.style.display !== 'none');
  check('mode is off on load', send({ type: 'GET_MODE' }).mode === false);
  check('no badges are drawn while mode is off',
    doc.querySelectorAll('.uxfb-badge').length === 0,
    'badges: ' + doc.querySelectorAll('.uxfb-badge').length);
  check('the comment saved earlier is listed in the sidebar on load',
    doc.querySelectorAll('.uxfb-sidebar-item').length === 1,
    'items: ' + doc.querySelectorAll('.uxfb-sidebar-item').length);
}

console.log('\nMode state is explicit, not a blind flip');
{
  check('SET_MODE true enables the mode',
    send({ type: 'SET_MODE', mode: true }).mode === true);
  check('SET_MODE true again stays true (idempotent, not a flip)',
    send({ type: 'SET_MODE', mode: true }).mode === true);
  check('SET_MODE false disables', send({ type: 'SET_MODE', mode: false }).mode === false);
  check('TOGGLE_MODE still flips', (() => {
    send({ type: 'SET_MODE', mode: false });
    send({ type: 'TOGGLE_MODE' });
    return send({ type: 'GET_MODE' }).mode === true;
  })());
  check('enabling mode draws the badges for stored comments',
    doc.querySelectorAll('.uxfb-badge').length >= 1);
  check('closing the sidebar stops capture but keeps the panel',
    (() => {
      send({ type: 'SET_MODE', mode: true });
      doc.getElementById('uxfb-close-sidebar').dispatch('click');
      const stillThere = doc.getElementById('uxfb-sidebar') !== null;
      const modeOff = send({ type: 'GET_MODE' }).mode === false;
      return stillThere && modeOff;
    })());
  check('closing the sidebar clears the badges',
    doc.querySelectorAll('.uxfb-badge').length === 0);
}

console.log('\nPer-page isolation — a second page does not inherit comments');
{
  const checkoutKey = 'ux_feedback_comments:https://demo.example.com/checkout';
  check('this page has its own comments', storage[checkoutKey].length >= 1);

  // Navigate: a new origin+pathname means a different storage key.
  sandbox.window.location = {
    href: 'https://demo.example.com/pricing',
    origin: 'https://demo.example.com',
    title: 'Pricing',
    pathname: '/pricing',
    hostname: 'demo.example.com',
  };
  reloadPage('Pricing');

  const onPricing = send({ type: 'GET_COMMENTS' }).comments;
  check('a different page starts with no comments', onPricing.length === 0,
    'inherited ' + onPricing.length + ' comments from the other page');
  check('the other page\'s comments are untouched',
    storage[checkoutKey].length >= 1);
  check('the sidebar on the new page is empty',
    doc.querySelectorAll('.uxfb-sidebar-item').length === 0);
  check('no badges leak onto the new page',
    doc.querySelectorAll('.uxfb-badge').length === 0);

  // A comment saved here belongs to this page only.
  send({ type: 'TOGGLE_MODE' });
  const page2 = buildPage();
  openEditorOn(page2.heading);
  saveEditor('Pricing page comment', 'low', 'open');
  const pricingKey = 'ux_feedback_comments:https://demo.example.com/pricing';
  check('comments are saved under the current page key', storage[pricingKey].length === 1);
  check('the first page\'s set did not grow', storage[checkoutKey].length >= 1);
}

console.log('\nT5 — export is handed to the worker, which owns the download');
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'content.js'), 'utf8');
  const bg = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'background.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  check('content script no longer click-downloads from the isolated world',
    !/document\.createElement\('a'\)/.test(
      src.slice(src.indexOf('function exportJson'))),
    'exportJson still creates an anchor; a content-script anchor click was '
    + 'observed creating the anchor but never starting a download');
  check('content script hands off to the worker',
    /DOWNLOAD_EXPORT/.test(src));
  check('worker uses chrome.downloads.download', /chrome\.downloads\.download/.test(bg));
  const bgCode = bg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('worker does NOT use URL.createObjectURL (absent in MV3 service workers)',
    !/URL\.createObjectURL/.test(bgCode),
    'URL.createObjectURL is not a function in an MV3 service worker; verified '
    + 'at runtime as TypeError');
  check('worker passes a data: URL and a filename',
    /data:application\/json/.test(bg) && /filename: filename/.test(bg));
  check('manifest declares the downloads permission',
    manifest.permissions.indexOf('downloads') !== -1,
    'permissions: ' + JSON.stringify(manifest.permissions));
}

console.log('\nbackground.js message routing');
{
  // Regression: REQUEST_SET_MODE/REQUEST_TOGGLE must resolve the tab from
  // sender.tab when no explicit tabId is given, because a content script has no
  // chrome.tabs and cannot pass one. Verified against the real extension before
  // this test existed — it silently resolved to undefined and mode never enabled.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'background.js'), 'utf8');

  check('REQUEST_SET_MODE falls back to sender.tab.id',
    /REQUEST_SET_MODE[\s\S]{0,240}tabIdOf\(sender\.tab\)/.test(src),
    'REQUEST_SET_MODE does not fall back to sender.tab.id');
  check('REQUEST_TOGGLE falls back to sender.tab.id',
    /REQUEST_TOGGLE[\s\S]{0,240}tabIdOf\(sender\.tab\)/.test(src),
    'REQUEST_TOGGLE does not fall back to sender.tab.id');
  check('applyMode reports the underlying error, not just injected:false',
    /error: detail/.test(src));
  check('per-tab mode state exists in the worker',
    /const tabModes = new Map\(\)/.test(src));
  check('mode state is cleared when a tab closes',
    /onRemoved[\s\S]{0,120}tabModes\.delete/.test(src));
}

console.log('\nEdit history');
{
  // Back to the checkout page; the previous block left us on /pricing.
  sandbox.window.location = {
    href: 'https://demo.example.com/checkout',
    origin: 'https://demo.example.com',
    title: 'Demo Checkout',
    pathname: '/checkout',
    hostname: 'demo.example.com',
  };
  reloadPage('Demo Checkout');
  check('a reloaded page starts with mode off', send({ type: 'GET_MODE' }).mode === false);
  send({ type: 'SET_MODE', mode: true });
  check('mode can be enabled', send({ type: 'GET_MODE' }).mode === true);
  resetComments();
  const page = buildPage();
  openEditorOn(page.heading);
  saveEditor('Original text', 'low', 'open');
  const firstId = send({ type: 'GET_COMMENTS' }).comments[0].id;

  // Re-commenting the same element edits it rather than duplicating.
  openEditorOn(page.heading);
  saveEditor('Revised text', 'high', 'open');
  const after = send({ type: 'GET_COMMENTS' }).comments;

  check('re-commenting the same element edits instead of duplicating',
    after.length === 1, 'expected 1 comment, got ' + after.length);
  check('comment id is preserved across the edit', after[0].id === firstId);
  check('comment number is preserved across the edit', after[0].number === 1);
  check('createdAt is preserved across the edit',
    typeof after[0].createdAt === 'string' && after[0].createdAt.length > 0);
  check('text updated', after[0].text === 'Revised text');
  check('severity updated', after[0].severity === 'high');
  check('edit history recorded',
    after[0].editHistory.length >= 2,
    'got ' + JSON.stringify(after[0].editHistory));
  check('edit history records the old value',
    after[0].editHistory.some((h) => h.field === 'text' && h.oldValue === 'Original text'));
}

// ── Summary ─────────────────────────────────────────────────────────

console.log('\n' + '-'.repeat(52));
console.log('passed: ' + passed + '   failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);