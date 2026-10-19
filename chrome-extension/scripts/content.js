/**
 * UX Feedback Extension — Content Script
 * Injected into every page. Handles toggle mode, click interception,
 * element metadata capture, badge rendering, sidebar panel, JSON export,
 * and chrome.storage.local persistence.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ux_feedback_comments';
  let mode = false;
  let comments = [];
  let sidebarEl = null;
  let editorEl = null;
  let currentTargetEl = null;
  let editingCommentId = null;
  let onlyOutstanding = false;
  let activeCommentId = null;
  let openCommentId = null;

  // ── Utilities ──────────────────────────────────────────────────────

  function generateId() {
    return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function nextNumber() {
    return comments.length + 1;
  }

  // ── DOM Selector & XPath ───────────────────────────────────────────

  function getCssSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const path = [];
    let current = el;
    while (current && current !== document.documentElement) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segment = '#' + CSS.escape(current.id);
        path.unshift(segment);
        break;
      } else if (current.classList.length) {
        segment += '.' + Array.from(current.classList).map(CSS.escape).join('.');
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          segment += ':nth-of-type(' + index + ')';
        }
      }
      path.unshift(segment);
      current = parent;
    }
    return path.join(' > ');
  }

  function getXPath(el) {
    const segments = [];
    let current = el;
    while (current && current !== document.documentElement) {
      let segment = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          segment = segment + '[' + index + ']';
        }
      }
      segments.unshift(segment);
      current = parent;
    }
    return '/' + segments.join('/');
  }

  function getAttributes(el) {
    const attrs = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }

  function getComputedStyles(el) {
    const cs = window.getComputedStyle(el);
    // getPropertyValue takes CSS (kebab-case) names; the camelCase key is kept
    // in the output for consumers. Reading camelCase from getPropertyValue
    // silently yields '' in a real browser.
    const important = [
      ['display', 'display'], ['visibility', 'visibility'], ['opacity', 'opacity'],
      ['position', 'position'], ['width', 'width'], ['height', 'height'],
      ['color', 'color'], ['backgroundColor', 'background-color'],
      ['fontSize', 'font-size'], ['fontWeight', 'font-weight'],
      ['textAlign', 'text-align'], ['borderWidth', 'border-width'],
      ['borderRadius', 'border-radius'], ['margin', 'margin'],
      ['padding', 'padding'], ['zIndex', 'z-index'],
    ];
    const styles = {};
    for (const [key, cssProp] of important) {
      styles[key] = cs.getPropertyValue(cssProp).trim();
    }
    return styles;
  }

  function getAncestors(el) {
    const ancestors = [];
    let current = el.parentElement;
    while (current && current !== document.documentElement) {
      ancestors.push({
        tag: current.tagName.toLowerCase(),
        selector: getCssSelector(current),
        text: current.textContent.trim().slice(0, 100),
      });
      current = current.parentElement;
    }
    return ancestors;
  }

  function getSiblings(el) {
    const parent = el.parentElement;
    if (!parent) return [];
    return Array.from(parent.children)
      .filter((c) => c !== el && !c.classList.contains('uxfb-badge'))
      .map((c) => ({
        tag: c.tagName.toLowerCase(),
        selector: getCssSelector(c),
        text: c.textContent.trim().slice(0, 100),
      }));
  }

  function getRects(el) {
    const rect = el.getBoundingClientRect();
    return {
      viewport: {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
      },
      page: {
        x: rect.x + window.scrollX, y: rect.y + window.scrollY,
        width: rect.width, height: rect.height,
      },
    };
  }

  function isVisible(el) {
    if (!el || el === document.documentElement) return true;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getInteractionState(el) {
    return {
      tagName: el.tagName.toLowerCase(),
      hasFocus: el === document.activeElement,
      isHovered: el.matches(':hover'),
      isFocused: el.matches(':focus'),
      isEnabled: !el.disabled,
      isChecked: el.checked || false,
      isExpanded: el.getAttribute('aria-expanded') || null,
      role: el.getAttribute('role') || null,
      tabIndex: el.tabIndex,
    };
  }

  // ── Metadata Capture ───────────────────────────────────────────────

  function captureElementMetadata(el) {
    return {
      id: generateId(),
      selector: getCssSelector(el),
      xpath: getXPath(el),
      tagName: el.tagName.toLowerCase(),
      text: el.textContent.trim().slice(0, 500),
      attributes: getAttributes(el),
      computedStyle: getComputedStyles(el),
      rects: getRects(el),
      ancestors: getAncestors(el),
      siblings: getSiblings(el),
      visibility: isVisible(el),
      interactionState: getInteractionState(el),
      capturedAt: new Date().toISOString(),
    };
  }

  // ── Persistence ────────────────────────────────────────────────────

  /**
   * Comments are scoped per page (origin + pathname), matching the goal's
   * "comments stored locally per page" decision. A single global key would leak
   * one demo site's comments and badges onto every other site the designer
   * visits, and their selectors would not resolve there.
   */
  function pageStorageKey() {
    return STORAGE_KEY + ':' + window.location.origin + window.location.pathname;
  }

  function persistComments() {
    chrome.storage.local.set({ [pageStorageKey()]: comments }, function () {
      if (chrome.runtime.lastError) {
        console.warn('[UX Feedback] Storage error:', chrome.runtime.lastError);
      }
    });
  }

  function loadComments(callback) {
    chrome.storage.local.get([pageStorageKey()], function (data) {
      const stored = data[pageStorageKey()];
      comments = Array.isArray(stored) ? stored : [];
      if (callback) callback();
    });
  }

  // ── Badge Rendering ────────────────────────────────────────────────
  //
  // Badges live in a dedicated overlay appended to <body>, never inside the
  // commented element. Appending a badge to the target would mutate that
  // element's children and inline styles, which then leaks into
  // getSiblings/getAncestors/getComputedStyles for every comment captured
  // afterwards and corrupts the AI-ready export.

  function getBadgeLayer() {
    let layer = document.getElementById('uxfb-badge-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'uxfb-badge-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  // Several comments can now share one element, so badges are offset leftwards
  // by their index instead of stacking on the same pixel.
  function positionBadge(badge, el, index) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      badge.style.display = 'none';
      return;
    }
    const offset = (index || 0) * 28;
    badge.style.display = 'flex';
    badge.style.left = Math.max(4, rect.right - 12 - offset) + 'px';
    badge.style.top = rect.top - 12 + 'px';
  }

  function renderBadge(el, number, index) {
    if (!el || el === document.documentElement || el === document.body) return;
    const layer = getBadgeLayer();
    const badge = document.createElement('div');
    badge.className = 'uxfb-badge';
    badge.dataset.uxfbTarget = number;
    badge.dataset.uxfbIndex = index || 0;
    badge.textContent = number;
    badge.title = 'UX Feedback #' + number;
    positionBadge(badge, el, index);
    layer.appendChild(badge);
  }

  function removeBadges() {
    const layer = document.getElementById('uxfb-badge-layer');
    if (layer) layer.innerHTML = '';
  }

  function repositionBadges() {
    const layer = document.getElementById('uxfb-badge-layer');
    if (!layer) return;
    comments.forEach((comment) => {
      const el = resolveElement(comment);
      if (!el) return;
      const badge = layer.querySelector(
        '.uxfb-badge[data-uxfb-target="' + comment.number + '"]'
      );
      if (badge) positionBadge(badge, el, Number(badge.dataset.uxfbIndex) || 0);
    });
  }

  function refreshAllBadges() {
    removeBadges();
    // Count how many comments land on each element so their badges can fan out.
    const perElement = new Map();
    comments.forEach((comment) => {
      const el = resolveElement(comment);
      if (!el) return;
      const index = perElement.get(el) || 0;
      perElement.set(el, index + 1);
      renderBadge(el, comment.number, index);
    });
  }

  /**
   * Resolve a comment's element. Prefers the CSS selector, then falls back to
   * XPath, then to a unique attribute match, so a comment stays anchored even
   * after the demo site is redeployed and class names churn.
   */
  function resolveElement(comment) {
    const meta = comment.metadata;
    let el = null;
    try {
      el = document.querySelector(meta.selector);
    } catch (err) {
      el = null; // invalid selector — fall through to XPath
    }
    if (el) return el;

    if (meta.xpath) {
      try {
        const result = document.evaluate(
          meta.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        el = result.singleNodeValue;
        if (el && el.nodeType === 1) return el;
      } catch (err) {
        el = null;
      }
    }

    // Last resort: a stable id from the captured attributes.
    const attrs = meta.attributes || {};
    if (attrs.id) {
      const byId = document.getElementById(attrs.id);
      if (byId) return byId;
    }
    return null;
  }

  // ── Sidebar Panel ──────────────────────────────────────────────────

  function injectSidebar() {
    if (sidebarEl) return;
    sidebarEl = document.createElement('div');
    sidebarEl.id = 'uxfb-sidebar';
    sidebarEl.innerHTML = `
      <div id="uxfb-sidebar-header">
        <h2>UX Feedback</h2>
        <span id="uxfb-sidebar-count">0</span>
        <button id="uxfb-outstanding-filter" class="">Outstanding only</button>
        <button id="uxfb-close-sidebar" title="Hide the UX Feedback panel">×</button>
      </div>
      <div id="uxfb-capture-bar">
        <button id="uxfb-capture-toggle" class="uxfb-off">Start commenting</button>
        <p id="uxfb-capture-hint">Click the button, then click any element on the page.</p>
      </div>
      <div id="uxfb-shortcuts">
        <span><kbd>Alt</kbd><kbd>C</kbd> capture</span>
        <span><kbd>J</kbd><kbd>K</kbd> move</span>
        <span><kbd>R</kbd> done</span>
        <span><kbd>Esc</kbd> close</span>
        <span><kbd>\u2318</kbd><kbd>Enter</kbd> save</span>
      </div>
      <div id="uxfb-sidebar-comments"></div>
    `;
    document.body.appendChild(sidebarEl);

    // The capture toggle is the only in-panel way to start commenting. Without
    // it the toolbar icon was the sole entry point, which nobody discovers.
    sidebarEl.querySelector('#uxfb-outstanding-filter').addEventListener('click', () => {
      onlyOutstanding = !onlyOutstanding;
      updateSidebar();
    });
    sidebarEl.querySelector('#uxfb-capture-toggle').addEventListener('click', () => {
      setMode(!mode);
    });
    // x hides the panel outright rather than silently disabling capture behind a
    // control that reads as "close". Turning capture back on reveals it again.
    sidebarEl.querySelector('#uxfb-close-sidebar').addEventListener('click', () => {
      setMode(false);
      sidebarEl.style.display = 'none';
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Group comments by the element they point at.
   *
   * A designer thinks in terms of what they can see on the page, not CSS
   * selectors, so each group is titled by the element's own text; the selector
   * is kept alongside it because that is what the exported JSON needs.
   */
  function groupComments() {
    const groups = new Map();
    comments.forEach((c) => {
      const el = resolveElement(c);
      if (!el) return;
      let g = groups.get(el);
      if (!g) {
        g = {
          el: el,
          comments: [],
          text: (c.metadata.text || '').replace(/\s+/g, ' ').trim(),
          tagName: c.metadata.tagName,
          selector: c.metadata.selector,
        };
        groups.set(el, g);
      }
      g.comments.push(c);
    });
    return Array.from(groups.values());
  }

  function isDone(comment) {
    return comment.done === true;
  }

  function toggleCommentDone(commentId) {
    const c = comments.find((x) => x.id === commentId);
    if (!c) return;
    c.done = !c.done;
    c.updatedAt = new Date().toISOString();
    persistComments();
    updateSidebar();
    refreshAllBadges();
  }

  function setGroupDone(group, done) {
    group.comments.forEach((c) => { c.done = done; });
    persistComments();
    updateSidebar();
    refreshAllBadges();
  }

  function groupTitle(group) {
    const t = group.text;
    if (t) {
      return t.length > 64 ? t.slice(0, 64) + '…' : t;
    }
    return group.tagName + (group.selector ? ' — ' + group.selector.slice(0, 40) : '');
  }

  function updateSidebar() {
    if (!sidebarEl) return;
    const container = sidebarEl.querySelector('#uxfb-sidebar-comments');
    const all = comments;
    const doneCount = all.filter(isDone).length;

    // Header badge shows progress: outstanding out of total.
    const countEl = sidebarEl.querySelector('#uxfb-sidebar-count');
    countEl.textContent = doneCount === all.length && all.length > 0
      ? all.length + ' ✓' : (all.length - doneCount) + '/' + all.length;

    const filterBtn = sidebarEl.querySelector('#uxfb-outstanding-filter');
    if (filterBtn) {
      filterBtn.textContent = onlyOutstanding ? 'Show all' : 'Outstanding only';
      filterBtn.className = onlyOutstanding ? 'uxfb-on-filter' : '';
    }

    container.innerHTML = '';

    if (all.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'uxfb-empty';
      empty.textContent = mode
        ? 'No comments yet. Click any element on the page to leave the first one.'
        : 'No comments yet. Press "Start commenting", then click any element.';
      container.appendChild(empty);
      return;
    }

    let groups = groupComments();
    if (onlyOutstanding) {
      groups = groups
        .map((g) => ({ ...g, comments: g.comments.filter((c) => !isDone(c)) }))
        .filter((g) => g.comments.length > 0);
      if (groups.length === 0) {
        const done = document.createElement('p');
        done.className = 'uxfb-empty';
        done.textContent = 'Everything is marked done. Nothing outstanding.';
        container.appendChild(done);
        return;
      }
    }

    groups.forEach((group) => {
      const gDone = group.comments.filter(isDone).length;
      const gTotal = group.comments.length;
      const allDone = gDone === gTotal;

      const card = document.createElement('div');
      card.className = 'uxfb-group' + (allDone ? ' uxfb-group-done' : '');

      const head = document.createElement('div');
      head.className = 'uxfb-group-head';
      // Built with textContent rather than interpolated HTML: comment text is
      // user input and must never be parsed as markup.
      const gDoneBtn = document.createElement('button');
      gDoneBtn.className = 'uxfb-group-check';
      gDoneBtn.title = 'Mark all ' + (allDone ? 'not done' : 'done');
      gDoneBtn.setAttribute('aria-pressed', String(allDone));
      gDoneBtn.textContent = allDone ? '\u2713' : '';
      head.appendChild(gDoneBtn);

      const titleEl = document.createElement('span');
      titleEl.className = 'uxfb-group-title';
      titleEl.textContent = groupTitle(group);
      head.appendChild(titleEl);

      const countEl2 = document.createElement('span');
      countEl2.className = 'uxfb-group-count';
      countEl2.textContent = gDone + '/' + gTotal;
      head.appendChild(countEl2);

      const jumpBtn = document.createElement('button');
      jumpBtn.className = 'uxfb-sidebar-scroll';
      jumpBtn.title = 'Scroll to element';
      jumpBtn.textContent = '\u2197';
      head.appendChild(jumpBtn);
      card.appendChild(head);

      const body = document.createElement('div');
      body.className = 'uxfb-group-body';

      group.comments.forEach((comment) => {
        const row = document.createElement('div');
        row.className = 'uxfb-row' + (isDone(comment) ? ' uxfb-row-done' : '') +
          (openCommentId === comment.id || activeCommentId === comment.id
            ? ' active' : '');
        row.dataset.uxfbId = comment.id;
        const rowDone = document.createElement('button');
        rowDone.className = 'uxfb-check';
        rowDone.title = 'Mark ' + (isDone(comment) ? 'not done' : 'done');
        rowDone.setAttribute('aria-pressed', String(isDone(comment)));
        row.appendChild(rowDone);

        const numEl = document.createElement('span');
        numEl.className = 'uxfb-row-number';
        numEl.textContent = '#' + comment.number;
        row.appendChild(numEl);

        const textEl = document.createElement('span');
        textEl.className = 'uxfb-row-text';
        textEl.textContent = comment.text;
        row.appendChild(textEl);

        const editBtn = document.createElement('button');
        editBtn.className = 'uxfb-row-edit';
        editBtn.title = 'Edit';
        editBtn.textContent = '\u270e';
        row.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'uxfb-row-delete';
        delBtn.title = 'Delete';
        delBtn.textContent = '\u2715';
        row.appendChild(delBtn);
        rowDone.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleCommentDone(comment.id);
        });
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          startEditingComment(comment);
        });
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeComment(comment);
        });
        row.addEventListener('click', () => {
          openCommentId = comment.id;
          updateSidebar();
          scrollToElement(comment);
        });
        body.appendChild(row);
      });

      card.appendChild(body);
      gDoneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setGroupDone(group, !allDone);
      });
      jumpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        scrollToElement({ metadata: group, number: '' });
      });
      head.addEventListener('click', () => {
        const showing = card.style.display !== 'none' && !card.classList.contains('uxfb-collapsed');
        card.classList.toggle('uxfb-collapsed', showing);
      });
      container.appendChild(card);
    });
  }

  // ── Comment Editor ─────────────────────────────────────────────────

  function openEditor(el, x, y, initialText, commentId) {
    closeEditor();
    // Likewise, opening a new comment must dismiss any existing-comments popover.
    closeExisting();
    clearHover();
    currentTargetEl = el;
    editingCommentId = commentId || null;
    editorEl = document.createElement('div');
    editorEl.id = 'uxfb-editor';
    editorEl.style.position = 'fixed';
    editorEl.style.left = Math.max(8, Math.min(x, window.innerWidth - 360)) + 'px';
    editorEl.style.top = Math.max(8, Math.min(y, window.innerHeight - 300)) + 'px';
    editorEl.style.zIndex = '100001';
    editorEl.innerHTML = `
      <div id="uxfb-editor-header">
        <h3 id="uxfb-editor-heading">New comment</h3>
        <button id="uxfb-editor-close">\u00d7</button>
      </div>
      <textarea id="uxfb-editor-text" placeholder="Describe your feedback about this element\u2026" rows="4"></textarea>
      <div id="uxfb-editor-options">
        <button id="uxfb-editor-save">Save</button>
      </div>
    `;
    document.body.appendChild(editorEl);

    if (initialText) {
      editorEl.querySelector('#uxfb-editor-text').value = initialText;
    }
    const editing = commentId
      ? comments.find((c) => c.id === commentId)
      : null;
    editorEl.querySelector('#uxfb-editor-heading').textContent = editing
      ? 'Edit comment #' + editing.number
      : 'New comment';

    editorEl.querySelector('#uxfb-editor-close').addEventListener('click', closeEditor);
    editorEl.querySelector('#uxfb-editor-save').addEventListener('click', saveComment);
  }

  function closeEditor() {
    if (editorEl) {
      editorEl.remove();
      editorEl = null;
    }
    currentTargetEl = null;
    editingCommentId = null;
  }

  function saveComment() {
    if (!currentTargetEl || !editorEl) return;

    const text = editorEl.querySelector('#uxfb-editor-text').value.trim();
    if (!text) { closeEditor(); return; }

    // Only an explicit edit updates a comment. Clicking an element that
    // already has comments now always adds another one, so several points can
    // be made about the same block without overwriting each other.
    const existingIdx = editingCommentId
      ? comments.findIndex((c) => c.id === editingCommentId)
      : -1;
    const now = new Date().toISOString();
    let comment;

    if (existingIdx >= 0) {
      // Read the previous values BEFORE mutating the array, otherwise the old
      // number/createdAt/history are already gone and the update cannot land.
      const prev = comments[existingIdx];
      const history = prev.editHistory || [];
      if (prev.text !== text) {
        history.push({ field: 'text', oldValue: prev.text, newValue: text, at: now });
      }
      comment = {
        id: prev.id,
        number: prev.number,
        text: text,
        done: prev.done === true,
        metadata: captureElementMetadata(currentTargetEl),
        createdAt: prev.createdAt,
        updatedAt: now,
        editHistory: history,
      };
      comments[existingIdx] = comment;
    } else {
      comment = {
        id: generateId(),
        number: nextNumber(),
        text: text,
        done: false,
        metadata: captureElementMetadata(currentTargetEl),
        createdAt: now,
        updatedAt: now,
        editHistory: [],
      };
      comments.push(comment);
    }

    persistComments();
    refreshAllBadges();
    updateSidebar();
    openCommentId = comment.id;
    closeEditor();
  }

  // ── Delete Comment ─────────────────────────────────────────────────

  /** Re-open the editor on an existing comment so its text can be corrected. */
  function startEditingComment(comment) {
    const el = resolveElement(comment);
    if (!el) {
      showNotice('Cannot edit #' + comment.number +
        ' \u2014 its element is no longer on this page.');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const r = el.getBoundingClientRect();
    openEditor(el, r.left + r.width / 2, r.top + r.height / 2,
      comment.text, comment.id);
  }

  function removeComment(comment) {
    if (!window.confirm('Delete comment #' + comment.number + '?\n\n"' +
      comment.text + '"')) {
      return;
    }
    deleteComment(comment.id);
  }

  function deleteComment(commentId) {
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    comments = comments.filter((c) => c.id !== commentId);
    comments.forEach((c, i) => { c.number = i + 1; });

    persistComments();
    refreshAllBadges();
    updateSidebar();
  }

  // ── Element Navigation & Flash ─────────────────────────────────────

  function scrollToElement(comment) {
    const el = resolveElement(comment);
    if (!el) {
      // Silent failure here would leave the designer thinking the element is
      // still on the page when it is gone — surface it instead.
      showNotice(
        'Cannot find element #' + (comment.number || '?') + ' on this page (' +
        (comment.metadata.tagName || 'unknown') + '). The page may have changed.'
      );
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    flashElement(el);
  }

  function flashElement(el) {
    const originalOutline = el.style.outline;
    const originalOffset = el.style.outlineOffset;
    el.style.outline = '3px solid #4285f4';
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      // Restore both properties: capturing an edit while the flash is still up
      // would otherwise save the extension's own highlight into the metadata.
      el.style.outline = originalOutline;
      el.style.outlineOffset = originalOffset;
    }, 2000);
  }

  function showNotice(text) {
    let notice = document.getElementById('uxfb-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'uxfb-notice';
      document.body.appendChild(notice);
    }
    notice.textContent = text;
    notice.classList.add('uxfb-notice-visible');
    clearTimeout(notice._uxfbTimer);
    notice._uxfbTimer = setTimeout(() => {
      notice.classList.remove('uxfb-notice-visible');
    }, 4000);
  }

  // ── Hover Highlight ────────────────────────────────────────────────
  //
  // While picking, the element under the cursor is outlined and labelled so the
  // designer can see exactly what they are about to anchor a comment to. The
  // highlight lives in its own overlay layer, never on the target itself, for
  // the same reason badges do not.

  let hoverEl = null;
  let hoverFrame = null;

  function getHoverLayer() {
    let layer = document.getElementById('uxfb-hover-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'uxfb-hover-layer';
      const box = document.createElement('div');
      box.id = 'uxfb-hover-box';
      const label = document.createElement('div');
      label.id = 'uxfb-hover-label';
      layer.appendChild(box);
      layer.appendChild(label);
      document.body.appendChild(layer);
    }
    return layer;
  }

  /** A short, human-readable description of what would be commented on. */
  function describeElement(el) {
    if (!el || el.nodeType !== 1) return '';
    let text = el.tagName.toLowerCase();
    if (el.id) {
      text += '#' + el.id;
    } else if (el.classList && el.classList.length) {
      text += '.' + el.classList[0];
    }
    const own = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (own) {
      text += '  "' + (own.length > 28 ? own.slice(0, 28) + '…' : own) + '"';
    }
    // Count only comments on this exact element. An ancestor's comments belong
    // to the ancestor; claiming them here would make a child look already
    // commented and the designer could not tell what a click would anchor to.
    const n = commentsFor(el).length;
    if (n > 0) {
      text += '  ·  ' + n + (n === 1 ? ' comment' : ' comments');
    }
    return text;
  }

  function drawHover(el) {
    const layer = getHoverLayer();
    const box = layer.querySelector('#uxfb-hover-box');
    const label = layer.querySelector('#uxfb-hover-label');
    if (!el || !el.isConnected) { clearHover(); return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { clearHover(); return; }
    layer.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    label.textContent = describeElement(el);
    // Prefer above the element; flip below when it would leave the viewport.
    const above = r.top - 20;
    label.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 240)) + 'px';
    label.style.top = (above < 4 ? r.bottom + 4 : above) + 'px';
  }

  function clearHover() {
    const layer = document.getElementById('uxfb-hover-layer');
    if (layer) layer.style.display = 'none';
    hoverEl = null;
  }

  // A short delay before the preview appears, so sweeping the cursor across a
  // page does not flash a popover at every element.
  let hoverPreviewTimer = null;

  function onHoverMove(e) {
    if (!mode) return;
    const t = e.target;
    // Never highlight our own UI, or the designer cannot hover past it.
    if (t && t.closest && t.closest(
      '#uxfb-sidebar, #uxfb-editor, #uxfb-badge-layer, #uxfb-hover-layer, #uxfb-existing')) {
      // Travelling into the popover must NOT dismiss it: cancel any pending
      // swap and leave the current popover alone.
      clearTimeout(hoverPreviewTimer);
      clearHover();
      return;
    }
    if (t === hoverEl) return;
    hoverEl = t;
    clearTimeout(hoverPreviewTimer);
    // Coalesce to one paint per frame; mousemove fires far faster than the
    // screen refreshes.
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = null;
      drawHover(hoverEl);
      scheduleHoverPreview(hoverEl);
    });
  }

  function scheduleHoverPreview(el) {
    clearTimeout(hoverPreviewTimer);
    hoverPreviewTimer = setTimeout(() => {
      // Never take over a comment the user is currently writing.
      if (editorEl) return;
      // Only now, after resting on the new element, is the current popover
      // retargeted. Passing over other elements in transit never closes it.
      closeExisting();
      // Preview the element under the pointer, never an ancestor. A comment on
      // a container must not pop up while the designer is aiming at a child.
      const list = commentsFor(el);
      if (!list.length) return;
      const r = el.getBoundingClientRect();
      showExistingComments(el, list, r.left + r.width / 2, r.top + r.height / 2);
    }, 300);
  }

  /** Close the popover on a click outside it, never on mere movement. */
  function onDocumentMouseDown(e) {
    const t = e.target;
    if (t && t.closest && t.closest(
      '#uxfb-existing, #uxfb-sidebar, #uxfb-editor')) {
      return;
    }
    closeExisting();
  }

  // ── Click Interception ─────────────────────────────────────────────

  function onPageClick(e) {
    if (!mode) return;
    // Don't intercept clicks inside our own UI
    if (e.target.closest(
      '#uxfb-sidebar, #uxfb-editor, #uxfb-badge-layer, #uxfb-hover-layer, #uxfb-existing')) {
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    // A click anchors to the element under the pointer, not to the nearest
    // commented ancestor. Walking up made a comment on a container (and, at
    // the extreme, on body) swallow every click inside it, so a designer
    // could not comment a heading inside a div that already had a note.
    let target = e.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    if (!target || target.nodeType !== 1) return;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // This exact element already has comments: show them first, so a second
    // comment on the same element is a deliberate choice.
    const existing = commentsFor(target);
    if (existing.length > 0) {
      showExistingComments(target, existing, x, y);
      return;
    }
    openEditor(target, x, y);
  }

  /** Every comment anchored to this exact element. */
  function commentsFor(el) {
    if (!el || el.nodeType !== 1) return [];
    return comments.filter((c) => resolveElement(c) === el);
  }

  /**
   * Popover listing the comments already attached to an element, plus a way to
   * add another. Shown both as a hover preview and on click, so the hover state
   * is exactly what the click would open.
   */
  function showExistingComments(el, list, x, y) {
    closeExisting();
    // The editor is the other answer to a click; never show both at once.
    closeEditor();
    const pop = document.createElement('div');
    pop.id = 'uxfb-existing';

    const head = document.createElement('div');
    head.className = 'uxfb-existing-head';
    const title = document.createElement('span');
    title.className = 'uxfb-existing-title';
    title.textContent = list.length === 1
      ? '1 comment on this element' : list.length + ' comments on this element';
    head.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'uxfb-existing-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '\u00d7';
    head.appendChild(closeBtn);
    pop.appendChild(head);

    list.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'uxfb-existing-row' + (isDone(c) ? ' is-done' : '');

      const check = document.createElement('button');
      check.className = 'uxfb-check';
      check.title = isDone(c) ? 'Mark not done' : 'Mark done';
      check.setAttribute('aria-pressed', String(isDone(c)));
      check.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleCommentDone(c.id);
      });
      row.appendChild(check);

      const text = document.createElement('span');
      text.className = 'uxfb-existing-text';
      text.textContent = c.text;
      row.appendChild(text);

      const edit = document.createElement('button');
      edit.className = 'uxfb-existing-edit';
      edit.title = 'Edit';
      edit.textContent = '\u270e';
      edit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeExisting();
        startEditingComment(c);
      });
      row.appendChild(edit);

      const del = document.createElement('button');
      del.className = 'uxfb-existing-delete';
      del.title = 'Delete';
      del.textContent = '\u2715';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeExisting();
        removeComment(c);
      });
      row.appendChild(del);

      pop.appendChild(row);
    });

    const add = document.createElement('button');
    add.className = 'uxfb-existing-add';
    add.textContent = '+ Add another comment';
    add.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeExisting();
      openEditor(el, x, y);
    });
    pop.appendChild(add);

    positionPopover(pop, x, y);
    document.body.appendChild(pop);
    closeBtn.addEventListener('click', closeExisting);
  }

  /** Keep a popover on screen, preferring below the element when it would clip. */
  function positionPopover(pop, x, y) {
    const w = 300;
    const left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8));
    pop.style.left = left + 'px';
    pop.style.top = (y + 18) + 'px';
    if (y + 18 + pop.offsetHeight > window.innerHeight - 8) {
      pop.style.top = Math.max(8, y - pop.offsetHeight - 18) + 'px';
    }
  }

  function closeExisting() {
    const pop = document.getElementById('uxfb-existing');
    if (pop) pop.remove();
  }

  // ── Toggle Mode ────────────────────────────────────────────────────

  function toggleMode() {
    setMode(!mode);
  }

  /**
   * Enter or leave feedback mode explicitly.
   *
   * The sidebar is always present once init() has run (AC-1), so enabling mode
   * only starts click interception and badge rendering; disabling stops those
   * and closes the editor without tearing the sidebar down. The panel's close
   * button calls setMode(false) but leaves the sidebar on screen, so the
   * designer can always get back to the comment list.
   */
  function setMode(next) {
    const wasMode = mode;
    mode = next;
    // Wire listeners only on an actual transition. Re-adding them on every
    // setMode(true) leaked duplicate handlers until they shadowed each other.
    if (mode && !wasMode) {
      document.addEventListener('click', onPageClick, true);
      document.addEventListener('mousemove', onHoverMove, true);
      // Badges are positioned from the target's rect, so they must follow the
      // page as it scrolls and the viewport as it resizes.
      window.addEventListener('scroll', repositionBadges, true);
      window.addEventListener('resize', repositionBadges);
      document.body.style.cursor = 'crosshair';
      refreshAllBadges();
    } else if (wasMode) {
      document.removeEventListener('click', onPageClick, true);
      document.removeEventListener('mousemove', onHoverMove, true);
      window.removeEventListener('scroll', repositionBadges, true);
      window.removeEventListener('resize', repositionBadges);
      closeEditor();
      clearHover();
      closeExisting();
      clearTimeout(hoverPreviewTimer);
      removeBadges();
      document.body.style.cursor = '';
    }
    // Let the popup and background know the real state; content.js is the only
    // place the mode lives, so every entry point must be told from here.
    chrome.runtime.sendMessage(
      { type: 'MODE_STATE', mode: mode },
      function () { void chrome.runtime.lastError; }
    );
    updateCaptureControls();
  }

  /** Reflect capture state on the in-panel toggle and its hint. */
  function updateCaptureControls() {
    if (!sidebarEl) return;
    const btn = sidebarEl.querySelector('#uxfb-capture-toggle');
    const hint = sidebarEl.querySelector('#uxfb-capture-hint');
    if (btn) {
      btn.textContent = mode ? 'Stop commenting' : 'Start commenting';
      btn.className = mode ? 'uxfb-on' : 'uxfb-off';
    }
    if (hint) {
      hint.textContent = mode
        ? 'Capture on — click any element on the page to comment.'
        : 'Click the button, then click any element on the page.';
    }
    // Entering capture is also how a hidden panel comes back.
    if (mode && sidebarEl) sidebarEl.style.display = 'flex';
  }

  // ── Export JSON ────────────────────────────────────────────────────

  function buildExportData() {
    const page = {
      url: window.location.href,
      title: document.title,
      pathname: window.location.pathname,
      hostname: window.location.hostname,
    };
    return {
      // `page` carries the AC-4 contract (page.url). `pageContext` is kept as
      // the richer alias so existing consumers keep working.
      page: page,
      pageContext: {
        ...page,
        exportedAt: new Date().toISOString(),
      },
      comments: comments.map((c) => ({
        id: c.id,
        number: c.number,
        text: c.text,
        element: {
          selector: c.metadata.selector,
          xpath: c.metadata.xpath,
          tagName: c.metadata.tagName,
          text: c.metadata.text,
          attributes: c.metadata.attributes,
          computedStyle: c.metadata.computedStyle,
          rects: c.metadata.rects,
          ancestors: c.metadata.ancestors,
          siblings: c.metadata.siblings,
          visibility: c.metadata.visibility,
          interactionState: c.metadata.interactionState,
        },
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        editHistory: c.editHistory,
      })),
    };
  }

  /**
   * Hand the payload to the background worker, which owns the actual download.
   *
   * Creating a Blob URL and clicking a temporary <a download> from a content
   * script is unreliable: verified against a genuinely loaded extension, the
   * anchor was created with the right filename and a valid
   * Blob{type:"application/json"}, yet Chrome never initiated a download, while
   * the identical code in the page's main world downloaded fine. Doing it from
   * the service worker through chrome.downloads also keeps the work off the
   * page and avoids leaving a temporary anchor in the DOM.
   */
  function exportJson() {
    const data = buildExportData();
    const filename =
      `ux-feedback-${window.location.hostname}-${Date.now()}.json`;
    chrome.runtime.sendMessage(
      { type: 'DOWNLOAD_EXPORT', payload: data, filename: filename },
      function () { void chrome.runtime.lastError; }
    );
  }

  // ── Copy to Plain Text ─────────────────────────────────────────────

  function copyAsPlainText() {
    let text = 'UX Feedback — ' + document.title + '\n';
    text += 'URL: ' + window.location.href + '\n';
    text += 'Comments: ' + comments.length + '\n\n';
    comments.forEach((c) => {
      text += '#' + c.number + ' ' + c.text + '\n';
      text += '  Selector: ' + c.metadata.selector + '\n';
      text += '  XPath: ' + c.metadata.xpath + '\n';
      text += '  Element: ' + c.metadata.tagName + '\n\n';
    });
    navigator.clipboard.writeText(text).then(() => {
      alert('Comments copied to clipboard as plain text.');
    }).catch(() => {
      console.warn('[UX Feedback] Could not copy to clipboard');
    });
  }

  // ── Keyboard ───────────────────────────────────────────────────────
  //
  // Five bindings, chosen because they converge across Pastel, Wake and the
  // xNet commenting spec rather than being invented here:
  //   Esc        close what is open, else leave comment mode
  //   Alt+C      toggle comment mode
  //   J / K      next / previous comment
  //   R          mark the focused comment done
  //   Cmd/Ctrl+Enter  submit the comment being written

  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'textarea' || tag === 'input' ||
      (tag === 'select') || el.isContentEditable === true;
  }

  function moveActiveComment(delta) {
    if (comments.length === 0) return;
    const ordered = comments.slice().sort((a, b) => a.number - b.number);
    const current = ordered.findIndex((c) => c.id === activeCommentId);
    const next = current === -1
      ? (delta > 0 ? 0 : ordered.length - 1)
      : (current + delta + ordered.length) % ordered.length;
    const target = ordered[next];
    activeCommentId = target.id;
    openCommentId = target.id;
    updateSidebar();
    scrollToElement(target);
    const row = docRowFor(target.id);
    if (row && row.scrollIntoView) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function docRowFor(commentId) {
    if (!sidebarEl) return null;
    const rows = sidebarEl.querySelectorAll('.uxfb-row');
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].dataset && rows[i].dataset.uxfbId === commentId) return rows[i];
    }
    return null;
  }

  function onKeyDown(e) {
    // Enter submits only with a modifier: an annotation tool is used to write
    // prose, so a bare Enter must stay a newline.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (editorEl) {
        e.preventDefault();
        saveComment();
      }
      return;
    }

    if (e.key === 'Escape') {
      // Scoped: close the topmost thing first, only then leave comment mode.
      if (editorEl) { closeEditor(); return; }
      if (document.getElementById('uxfb-existing')) { closeExisting(); return; }
      if (mode) { e.preventDefault(); setMode(false); }
      return;
    }

    if (isTypingTarget(e.target)) return;

    if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      toggleMode();
      return;
    }

    // Comment-navigation keys only mean something while capturing.
    if (!mode) return;

    if (e.key === 'j' || e.key === 'J') { e.preventDefault(); moveActiveComment(1); return; }
    if (e.key === 'k' || e.key === 'K') { e.preventDefault(); moveActiveComment(-1); return; }

    if (e.key === 'r' || e.key === 'R') {
      if (!activeCommentId) return;
      e.preventDefault();
      toggleCommentDone(activeCommentId);
    }
  }

  // ── Message Handler ────────────────────────────────────────────────

  function handleMessage(msg, sender, sendResponse) {
    switch (msg.type) {
      case 'TOGGLE_MODE':
        toggleMode();
        sendResponse({ mode: mode });
        break;
      case 'SET_MODE':
        // Used by the background worker and popup to set an explicit state
        // rather than blind-flipping, so all entry points agree on the result.
        setMode(!!msg.mode);
        sendResponse({ mode: mode });
        break;
      case 'GET_MODE':
        sendResponse({ mode: mode });
        break;
      case 'EXPORT_JSON':
        exportJson();
        sendResponse({ success: true });
        break;
      case 'COPY_PLAIN_TEXT':
        copyAsPlainText();
        sendResponse({ success: true });
        break;
      case 'DELETE_COMMENT':
        deleteComment(msg.commentId);
        sendResponse({ success: true });
        break;
      case 'GET_COMMENTS':
        sendResponse({ comments: comments });
        break;
      case 'GET_EXPORT_DATA':
        // Same payload exportJson() serialises, without triggering a download.
        sendResponse({ export: buildExportData() });
        break;
      default:
        sendResponse({ unknown: true });
    }
    return false;
  }

  // ── Init ───────────────────────────────────────────────────────────

  function init() {
    // AC-1: the sidebar is present on every page load, without the designer
    // having to toggle anything first. Restored comments and their badges are
    // rendered into it as soon as storage resolves.
    injectSidebar();
    loadComments(() => {
      if (mode) refreshAllBadges();
      updateSidebar();
    });
    chrome.runtime.onMessage.addListener(handleMessage);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onDocumentMouseDown, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
