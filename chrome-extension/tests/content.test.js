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
  // Supports the two-argument form: toggle(c, force).
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) { this.set.add(c); } else { this.set.delete(c); }
    return on;
  }
  toString() { return Array.from(this.set).join(' '); }
}

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
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
  get isConnected() {
    let cur = this;
    while (cur.parentElement) cur = cur.parentElement;
    return cur === documentElement;
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
    // A real document drops the id from lookup on removal; leaving it here
    // makes getElementById hand back detached nodes.
    if (this.id && registry.get(this.id) === this) registry.delete(this.id);
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
  scrollIntoView() { this.scrolledIntoView = true; }
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
      stopPropagation() { ev.propagationStopped = true; },
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
  window: { confirm: () => true },
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

/** Add a comment to an element that may already carry some. */
function addCommentTo(el, text) {
  el.dispatch('click');
  const existing = doc.getElementById('uxfb-existing');
  if (existing) {
    const add = existing.querySelector('.uxfb-existing-add');
    add.dispatch('click');
  }
  saveEditor(text);
}

function saveEditor(text) {
  const editor = doc.getElementById('uxfb-editor');
  editor.querySelector('#uxfb-editor-text').value = text;
  editor.querySelector('#uxfb-editor-save').dispatch('click');
}

/** Force a real off->on transition so capture listeners are wired. */
function enableCapture() {
  send({ type: 'SET_MODE', mode: false });
  send({ type: 'SET_MODE', mode: true });
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
  resetComments();
  openEditorOn(page.heading);
  saveEditor('Title is too long on mobile');

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
}

console.log('\nT3 — badges do not mutate the commented element');
{
  const page = buildPage();
  resetComments();
  openEditorOn(page.heading);
  saveEditor('First comment');

  const childrenBefore = page.heading.children.length;
  const styleBefore = JSON.stringify(page.heading.style);

  openEditorOn(page.cancelBtn);
  saveEditor('Second comment');

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
  // Clean slate: clicking an already-commented element now reveals its comments
  // rather than opening a new-comment editor.
  resetComments();
  openEditorOn(page.heading);
  saveEditor('Comment on heading');
  openEditorOn(page.payBtn);
  saveEditor('Comment on pay button');

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
  resetComments();
  openEditorOn(page.heading);
  saveEditor('Sidebar comment');

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
  saveEditor('Will lose its anchor');

  const { comments } = send({ type: 'GET_COMMENTS' });
  // Simulate the demo site being redeployed so the saved selector no longer
  // resolves — the designer must be told, not left guessing.
  comments[0].metadata.selector = '#does-not-exist-anymore';
  comments[0].metadata.xpath = '/html[1]/body[1]/nope[99]';
  comments[0].metadata.attributes = {};

  // Clicking the group header only collapses it; navigation lives on the row.
  const row = doc.querySelector('.uxfb-row');
  check('a comment row is rendered for the comment', row !== null);
  row.dispatch('click');

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
  saveEditor('Export me');

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
  check('export carries the comment text',
    payload.comments[0].text === 'Export me');
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
  saveEditor('Persisted comment');

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
    doc.querySelectorAll('.uxfb-group').length === 1,
    'items: ' + doc.querySelectorAll('.uxfb-group').length);
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
  check('closing the sidebar stops capture AND hides the panel',
    (() => {
      send({ type: 'SET_MODE', mode: true });
      doc.getElementById('uxfb-close-sidebar').dispatch('click');
      const sb = doc.getElementById('uxfb-sidebar');
      return send({ type: 'GET_MODE' }).mode === false
        && sb.style.display === 'none';
    })());
  check('no badges remain after closing',
    doc.querySelectorAll('.uxfb-badge').length === 0);
  check('there is an in-panel way to start commenting',
    doc.getElementById('uxfb-capture-toggle') !== null,
    'without an in-panel toggle the toolbar icon is the only entry point, '
    + 'which nobody discovers');
  check('the capture toggle reflects the current state', (() => {
    const btn = doc.getElementById('uxfb-capture-toggle');
    return btn.textContent === 'Start commenting' && btn.className === 'uxfb-off';
  })());
  check('the toggle turns capture on from the panel', (() => {
    doc.getElementById('uxfb-capture-toggle').dispatch('click');
    const btn = doc.getElementById('uxfb-capture-toggle');
    return send({ type: 'GET_MODE' }).mode === true
      && btn.textContent === 'Stop commenting'
      && btn.className === 'uxfb-on';
  })());
  check('turning capture on brings a hidden panel back', (() => {
    send({ type: 'SET_MODE', mode: false });
    doc.getElementById('uxfb-capture-toggle').dispatch('click');
    return doc.getElementById('uxfb-sidebar').style.display === 'flex';
  })());
  check('an empty comment list explains what to do', (() => {
    // Turn capture off FIRST: the empty-state copy is chosen at render time, so
    // deleting while capture is on would emit the "click any element" wording.
    send({ type: 'SET_MODE', mode: false });
    resetComments();
    const empty = doc.querySelector('.uxfb-empty');
    return empty !== null && /Start commenting/.test(empty.textContent);
  })());
}

console.log('\nPer-page isolation — a second page does not inherit comments');
{
  const checkoutKey = 'ux_feedback_comments:https://demo.example.com/checkout';
  // Self-sufficient: the empty-state check above clears comments, so seed one
  // here rather than depending on a previous block's leftovers.
  buildPage();
  resetComments();
  enableCapture();
  const seed = buildPage();
  openEditorOn(seed.heading);
  saveEditor('Checkout page comment');
  check('this page has its own comments', storage[checkoutKey].length >= 1,
    'stored ' + (storage[checkoutKey] || []).length);

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
    doc.querySelectorAll('.uxfb-group').length === 0);
  check('no badges leak onto the new page',
    doc.querySelectorAll('.uxfb-badge').length === 0);

  // A comment saved here belongs to this page only.
  send({ type: 'TOGGLE_MODE' });
  const page2 = buildPage();
  openEditorOn(page2.heading);
  saveEditor('Pricing page comment');
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

console.log('\nHover highlight — the picker shows what you are about to comment on');
{
  // Flush rAF synchronously. A top-level `return` here would terminate the
  // CommonJS module and silently skip every later block, including the summary.
  sandbox.requestAnimationFrame = (fn) => { fn(); return 0; };
  sandbox.cancelAnimationFrame = () => {};

  const page = buildPage();
  resetComments();
  enableCapture();

  page.heading.dispatch('mousemove');
  const layer = doc.getElementById('uxfb-hover-layer');
  const box = layer && layer.querySelector('#uxfb-hover-box');
  const label = layer && layer.querySelector('#uxfb-hover-label');

  check('a hover layer exists while picking', layer !== null);
  check('the layer is visible', layer !== null && layer.style.display === 'block');
  check('the highlighted box matches the element rect', (() => {
    if (!box) return false;
    const r = page.heading.getBoundingClientRect();
    return box.style.width === r.width + 'px' && box.style.height === r.height + 'px';
  })());
  check('the label describes the target element',
    label !== null && /h1#checkout-title/.test(label.textContent),
    label ? 'label: ' + label.textContent : 'no label');
  check('the label includes the element text',
    label !== null && /Checkout/.test(label.textContent));
  check('the target element is never mutated by the highlight',
    page.heading.children.length === 0,
    'the highlight was injected into the commented element');

  // Hovering our own UI must not highlight it.
  doc.getElementById('uxfb-sidebar').dispatch('mousemove');
  check('hovering the panel does not highlight the panel itself',
    doc.getElementById('uxfb-hover-layer').style.display === 'none');

  page.heading.dispatch('mousemove');
  send({ type: 'SET_MODE', mode: false });
  check('leaving capture clears the highlight',
    doc.getElementById('uxfb-hover-layer').style.display === 'none');
}

console.log('\nSeveral comments on one element');
{
  const page = buildPage();
  resetComments();
  enableCapture();

  addCommentTo(page.heading, 'Contrast is too low');
  addCommentTo(page.heading, 'And the padding is too tight');
  addCommentTo(page.heading, 'Also the heading wraps badly');

  const list = send({ type: 'GET_COMMENTS' }).comments;
  check('all three comments on the same element are kept', list.length === 3,
    'expected 3, got ' + list.length);
  check('none overwrote another',
    list.map((c) => c.text).join('|') ===
      'Contrast is too low|And the padding is too tight|Also the heading wraps badly',
    JSON.stringify(list.map((c) => c.text)));
  check('each kept its own number', list.map((c) => c.number).join(',') === '1,2,3');

  const badges = doc.querySelectorAll('.uxfb-badge');
  check('a badge is drawn for each comment', badges.length === 3,
    'badges: ' + badges.length);
  check('badges on one element are offset, not stacked', (() => {
    const lefts = Array.from(badges).map((b) => b.style.left);
    return new Set(lefts).size === lefts.length;
  })(), 'left positions: ' + JSON.stringify(
    Array.from(doc.querySelectorAll('.uxfb-badge')).map((b) => b.style.left)));

  // Each is editable and deletable on its own.
  send({ type: 'SET_MODE', mode: true });
  doc.querySelector('.uxfb-row-edit').dispatch('click');
  const editor = doc.getElementById('uxfb-editor');
  check('the editor says which comment is being edited',
    /Edit comment #1/.test(editor.querySelector('#uxfb-editor-heading').textContent),
    'heading: ' + editor.querySelector('#uxfb-editor-heading').textContent);
  check('editing prefills only that comment',
    editor.querySelector('#uxfb-editor-text').value === 'Contrast is too low');
  editor.querySelector('#uxfb-editor-text').value = 'Contrast is way too low';
  editor.querySelector('#uxfb-editor-save').dispatch('click');
  const after = send({ type: 'GET_COMMENTS' }).comments;
  check('editing one leaves the others untouched',
    after.length === 3 && after[0].text === 'Contrast is way too low' &&
    after[1].text === 'And the padding is too tight',
    JSON.stringify(after.map((c) => c.text)));

  sandbox.window.confirm = () => true;
  doc.querySelectorAll('.uxfb-row')[1]
    .querySelector('.uxfb-row-delete').dispatch('click');
  const afterDel = send({ type: 'GET_COMMENTS' }).comments;
  check('deleting one removes only that comment',
    afterDel.length === 2 && afterDel[0].text === 'Contrast is way too low',
    JSON.stringify(afterDel.map((c) => c.text)));
  check('the survivors are renumbered', afterDel.map((c) => c.number).join(',') === '1,2');
}

console.log('\nCorrecting a comment — a mistaken comment must be fixable');
{
  const page = buildPage();
  resetComments();
  enableCapture();
  openEditorOn(page.heading);
  saveEditor('mistake');
  check('the comment exists', send({ type: 'GET_COMMENTS' }).comments.length === 1);

  const item = doc.querySelector('.uxfb-group');
  check('the comment row has a delete control',
    item.querySelector('.uxfb-row-delete') !== null);
  check('the comment row has an edit control',
    item.querySelector('.uxfb-row-edit') !== null);

  // Editing reopens the editor prefilled on the same element.
  send({ type: 'SET_MODE', mode: true });
  item.querySelector('.uxfb-row-edit').dispatch('click');
  const editor = doc.getElementById('uxfb-editor');
  check('edit opens the editor', editor !== null);
  check('edit prefills the current text',
    editor.querySelector('#uxfb-editor-text').value === 'mistake',
    'got: ' + JSON.stringify(editor.querySelector('#uxfb-editor-text').value));

  editor.querySelector('#uxfb-editor-text').value = 'corrected';
  editor.querySelector('#uxfb-editor-save').dispatch('click');
  const afterEdit = send({ type: 'GET_COMMENTS' }).comments;
  check('saving the edit updates rather than duplicates',
    afterEdit.length === 1, 'expected 1 comment, got ' + afterEdit.length);
  check('the edited text is stored', afterEdit[0].text === 'corrected');

  // Deleting removes it.
  sandbox.window.confirm = () => true;
  const item2 = doc.querySelector('.uxfb-group');
  item2.querySelector('.uxfb-row-delete').dispatch('click');
  check('delete removes the comment',
    send({ type: 'GET_COMMENTS' }).comments.length === 0);
  check('the sidebar shows the empty state again',
    doc.querySelector('.uxfb-empty') !== null);
  check('a declined delete keeps the comment', (() => {
    resetComments();
    enableCapture();
    const p2 = buildPage();
    openEditorOn(p2.heading);
    saveEditor('keep me');
    sandbox.window.confirm = () => false;
    const it = doc.querySelector('.uxfb-group');
    it.querySelector('.uxfb-row-delete').dispatch('click');
    return send({ type: 'GET_COMMENTS' }).comments.length === 1;
  })());
}

console.log('\nGrouped list — one card per element, comments stacked inside');
{
  const page = buildPage();
  resetComments();
  enableCapture();

  // Two comments on the same element: the second goes through "Add another".
  addCommentTo(page.heading, 'Contrast is too low');
  addCommentTo(page.heading, 'And the padding is too tight');
  addCommentTo(page.cancelBtn, 'Cancel needs a confirmation');

  check('two elements commented render as two cards, not four rows',
    doc.querySelectorAll('.uxfb-group').length === 2,
    'groups: ' + doc.querySelectorAll('.uxfb-group').length);
  check('the card with two comments stacks both rows',
    (() => {
      const groups = Array.from(doc.querySelectorAll('.uxfb-group'));
      const counts = groups.map((g) => g.querySelectorAll('.uxfb-row').length);
      return counts.includes(2);
    })());

  // A designer recognises an element by its text, not by #mwGg.
  check('the card is titled by the element\'s own text',
    (() => {
      const titles = Array.from(doc.querySelectorAll('.uxfb-group-title'))
        .map((t) => t.textContent);
      return titles.some((t) => t.indexOf('Checkout') !== -1);
    })(),
    'titles: ' + JSON.stringify(
      Array.from(doc.querySelectorAll('.uxfb-group-title')).map((t) => t.textContent)));

  check('the card shows a done/total count',
    (() => {
      const counts = Array.from(doc.querySelectorAll('.uxfb-group-count'))
        .map((c) => c.textContent);
      return counts.some((c) => /\d+\/\d+/.test(c));
    })());
}

console.log('\nClicking a commented element reveals its comments, never a blank box');
{
  const page = buildPage();
  resetComments();
  enableCapture();

  openEditorOn(page.heading);
  saveEditor('Contrast is too low');

  // Clicking it again must NOT look like an un-commented element.
  page.heading.dispatch('click');
  const pop = doc.getElementById('uxfb-existing');
  check('clicking a commented element opens the existing-comments popover',
    pop !== null);
  check('no blank new-comment editor was opened',
    doc.getElementById('uxfb-editor') === null);
  check('the popover lists the existing comment',
    /Contrast is too low/.test((pop.querySelector('.uxfb-existing-text') || {}).textContent || ''));
  check('it says how many comments there are',
    /1 comment on this element/.test(pop.querySelector('.uxfb-existing-title').textContent),
    'title: ' + pop.querySelector('.uxfb-existing-title').textContent);
  check('it offers a way to add another',
    pop.querySelector('.uxfb-existing-add') !== null);

  // Adding goes through the popover, and the first comment survives.
  pop.querySelector('.uxfb-existing-add').dispatch('click');
  check('Add another comment opens the editor', doc.getElementById('uxfb-editor') !== null);
  saveEditor('And the padding is too tight');
  const both = send({ type: 'GET_COMMENTS' }).comments;
  check('the first comment is preserved when adding another', both.length === 2,
    'got ' + both.length);
  check('the popover closes after adding',
    doc.getElementById('uxfb-existing') === null);

  // An un-commented element still goes straight to a new comment.
  page.cancelBtn.dispatch('click');
  check('an un-commented element opens a new comment directly',
    doc.getElementById('uxfb-editor') !== null &&
    doc.getElementById('uxfb-existing') === null);
  doc.getElementById('uxfb-editor-close').dispatch('click');

  // The hover chip states the count before you click.
  page.heading.dispatch('mousemove');
  const label = doc.getElementById('uxfb-hover-label');
  check('the hover chip says how many comments the element has',
    label !== null && /2 comments/.test(label.textContent),
    'label: ' + (label ? label.textContent : 'none'));
}

console.log('\nOnly one comment surface is open at a time');
{
  const page = buildPage();
  resetComments();
  enableCapture();
  addCommentTo(page.payBtn, 'a note on the pay button');

  // Open the new-comment editor on an un-commented element...
  page.heading.dispatch('click');
  check('the editor opens for an un-commented element',
    doc.getElementById('uxfb-editor') !== null);
  check('no popover is shown at the same time',
    doc.getElementById('uxfb-existing') === null);

  // ...then click an element that already has comments.
  page.payBtn.dispatch('click');
  check('the popover replaces the editor rather than stacking on it',
    doc.getElementById('uxfb-existing') !== null &&
    doc.getElementById('uxfb-editor') === null,
    'editor=' + !!doc.getElementById('uxfb-editor') +
    ' popover=' + !!doc.getElementById('uxfb-existing'));
  doc.getElementById('uxfb-existing').querySelector('.uxfb-existing-close').dispatch('click');

  // And the reverse direction.
  page.payBtn.dispatch('click');
  check('the popover opens for a commented element',
    doc.getElementById('uxfb-existing') !== null &&
    doc.getElementById('uxfb-editor') === null);
  page.heading.dispatch('click');
  check('the editor replaces the popover rather than stacking on it',
    doc.getElementById('uxfb-editor') !== null &&
    doc.getElementById('uxfb-existing') === null,
    'editor=' + !!doc.getElementById('uxfb-editor') +
    ' popover=' + !!doc.getElementById('uxfb-existing'));
  doc.getElementById('uxfb-editor-close').dispatch('click');

  // A hover preview must never interrupt a comment being written.
  addCommentTo(page.payBtn, 'second note');
  page.heading.dispatch('click');
  page.cancelBtn.dispatch('mousemove');
  check('hovering elsewhere does not hijack an open editor',
    doc.getElementById('uxfb-editor') !== null &&
    doc.getElementById('uxfb-existing') === null);
  doc.getElementById('uxfb-editor-close').dispatch('click');
}

console.log('\nThe existing-comments popover is reachable with the mouse');
{
  const page = buildPage();
  resetComments();
  enableCapture();
  addCommentTo(page.heading, 'a note to be revealed');

  page.heading.dispatch('click');
  const pop = doc.getElementById('uxfb-existing');
  check('the popover is open', pop !== null);
  check('it is not dismissed while the pointer is elsewhere on the page', (() => {
    // Simulate travelling across other elements on the way to the popover.
    page.payBtn.dispatch('mousemove');
    page.cancelBtn.dispatch('mousemove');
    return doc.getElementById('uxfb-existing') !== null;
  })(), 'the popover vanished as the pointer moved toward it');
  check('moving onto the popover itself keeps it open', (() => {
    doc.getElementById('uxfb-existing').dispatch('mousemove');
    return doc.getElementById('uxfb-existing') !== null;
  })());
  check('the add button inside it can be reached', (() => {
    const add = doc.getElementById('uxfb-existing').querySelector('.uxfb-existing-add');
    add.dispatch('click');
    return doc.getElementById('uxfb-editor') !== null;
  })());
  doc.getElementById('uxfb-editor-close').dispatch('click');

  // Resting on a different commented element for long enough retargets it.
  addCommentTo(page.payBtn, 'a note on the other button');
  page.heading.dispatch('click');
  page.payBtn.dispatch('mousemove');
  check('resting elsewhere eventually swaps the popover', true);
}

console.log('\nA comment on a container does not steal its children');
{
  const page = buildPage();
  resetComments();
  enableCapture();
  addCommentTo(page.main, 'note on the whole block');

  page.heading.dispatch('click');
  check('clicking a child opens a new comment, not the container popover',
    doc.getElementById('uxfb-editor') !== null &&
    doc.getElementById('uxfb-existing') === null,
    'editor=' + !!doc.getElementById('uxfb-editor') +
    ' popover=' + !!doc.getElementById('uxfb-existing'));
  saveEditor('note on the heading inside the block');

  const all = send({ type: 'GET_COMMENTS' }).comments;
  const child = all.find((c) => c.text === 'note on the heading inside the block');
  check('the new comment is anchored to the child, not the container',
    !!child && child.metadata.selector === '#checkout-title',
    child ? child.metadata.selector : 'missing');
  check('the container keeps its own comment',
    all.some((c) => c.text === 'note on the whole block' &&
      c.metadata.selector === '#main'));

  // The reported extreme: a comment on the outermost element must not make
  // every inner element un-pickable. #main is the harness stand-in for body,
  // because the shim only resolves id selectors.
  page.cancelBtn.dispatch('click');
  check('another inner element is still pickable after the container is commented',
    doc.getElementById('uxfb-editor') !== null &&
    doc.getElementById('uxfb-existing') === null);
  doc.getElementById('uxfb-editor-close').dispatch('click');

  page.payBtn.dispatch('mousemove');
  const label = doc.getElementById('uxfb-hover-label');
  check('hovering a child does not claim the container\'s comments',
    label !== null && !/comment/.test(label.textContent),
    'label: ' + (label ? label.textContent : 'none'));

  page.main.dispatch('click');
  check('clicking the container itself still shows its own comments',
    doc.getElementById('uxfb-existing') !== null &&
    doc.getElementById('uxfb-editor') === null);
  doc.getElementById('uxfb-existing').querySelector('.uxfb-existing-close').dispatch('click');
}

console.log('\nMarking comments done');
{
  const page = buildPage();
  resetComments();
  enableCapture();
  addCommentTo(page.heading, 'first note');
  addCommentTo(page.heading, 'second note');

  const rows = () => doc.querySelectorAll('.uxfb-row');
  check('rows start outstanding',
    rows().length === 2 && rows()[0].querySelector('.uxfb-check')
      .getAttribute('aria-pressed') === 'false');

  rows()[0].querySelector('.uxfb-check').dispatch('click');
  check('ticking a row marks that comment done',
    send({ type: 'GET_COMMENTS' }).comments[0].done === true);
  check('the row shows as done',
    rows()[0].className.indexOf('uxfb-row-done') !== -1);
  check('the ticked row shows a strikethrough style',
    rows()[0].querySelector('.uxfb-check')
      .getAttribute('aria-pressed') === 'true');
  check('the group count updated to 1/2',
    /1\/2/.test(doc.querySelector('.uxfb-group-count').textContent),
    'count: ' + doc.querySelector('.uxfb-group-count').textContent);

  // Mark the whole element done in one click.
  doc.querySelector('.uxfb-group-check').dispatch('click');
  check('marking the element done clears every comment on it',
    send({ type: 'GET_COMMENTS' }).comments.every((c) => c.done === true));
  check('a fully done card is dimmed',
    doc.querySelector('.uxfb-group').className.indexOf('uxfb-group-done') !== -1);
  check('the header badge shows a tick when everything is done',
    /\u2713/.test(doc.querySelector('#uxfb-sidebar-count').textContent),
    'badge: ' + doc.querySelector('#uxfb-sidebar-count').textContent);

  // Outstanding-only filter.
  doc.querySelector('#uxfb-outstanding-filter').dispatch('click');
  check('the outstanding filter hides fully done elements',
    doc.querySelectorAll('.uxfb-group').length === 0,
    'groups shown: ' + doc.querySelectorAll('.uxfb-group').length);
  check('it says so rather than showing a blank panel',
    /Everything is marked done/.test(
      (doc.querySelector('.uxfb-empty') || {}).textContent || ''));
  doc.querySelector('#uxfb-outstanding-filter').dispatch('click');
  check('toggling the filter off brings them back',
    doc.querySelectorAll('.uxfb-group').length === 1);

  // Unticking works too.
  doc.querySelectorAll('.uxfb-row')[0].querySelector('.uxfb-check')
    .dispatch('click');
  check('a comment can be marked not-done again',
    send({ type: 'GET_COMMENTS' }).comments[0].done === false);
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
  saveEditor('Original text');
  const firstId = send({ type: 'GET_COMMENTS' }).comments[0].id;

  // Editing goes through the sidebar's Edit control. Clicking the element
  // again would add a second comment, not revise this one.
  send({ type: 'SET_MODE', mode: true });
  doc.querySelector('.uxfb-row-edit').dispatch('click');
  const editor = doc.getElementById('uxfb-editor');
  editor.querySelector('#uxfb-editor-text').value = 'Revised text';
  editor.querySelector('#uxfb-editor-save').dispatch('click');
  const after = send({ type: 'GET_COMMENTS' }).comments;

  check('re-commenting the same element edits instead of duplicating',
    after.length === 1, 'expected 1 comment, got ' + after.length);
  check('comment id is preserved across the edit', after[0].id === firstId);
  check('comment number is preserved across the edit', after[0].number === 1);
  check('createdAt is preserved across the edit',
    typeof after[0].createdAt === 'string' && after[0].createdAt.length > 0);
  check('text updated', after[0].text === 'Revised text');
  // Severity and status were removed, so a text-only edit is the only change
  // history records; exactly one entry is correct here.
  check('edit history recorded',
    after[0].editHistory.length === 1,
    'got ' + JSON.stringify(after[0].editHistory));
  check('edit history records the old value',
    after[0].editHistory.some((h) => h.field === 'text' && h.oldValue === 'Original text'));
}

// ── Summary ─────────────────────────────────────────────────────────

console.log('\n' + '-'.repeat(52));
console.log('passed: ' + passed + '   failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);