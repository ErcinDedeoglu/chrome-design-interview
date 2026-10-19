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

  function positionBadge(badge, el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      badge.style.display = 'none';
      return;
    }
    badge.style.display = 'flex';
    badge.style.left = rect.right - 12 + 'px';
    badge.style.top = rect.top - 12 + 'px';
  }

  function renderBadge(el, number) {
    if (!el || el === document.documentElement || el === document.body) return;
    const layer = getBadgeLayer();
    const badge = document.createElement('div');
    badge.className = 'uxfb-badge';
    badge.dataset.uxfbTarget = number;
    badge.textContent = number;
    badge.title = 'UX Feedback #' + number;
    positionBadge(badge, el);
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
      if (badge) positionBadge(badge, el);
    });
  }

  function refreshAllBadges() {
    removeBadges();
    comments.forEach((comment) => {
      const el = resolveElement(comment);
      if (el) renderBadge(el, comment.number);
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
        <button id="uxfb-close-sidebar" title="Close sidebar">×</button>
      </div>
      <div id="uxfb-sidebar-filters">
        <select id="uxfb-filter-severity" title="Filter by severity">
          <option value="">All Severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <select id="uxfb-filter-status" title="Filter by status">
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in-progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
      <div id="uxfb-sidebar-comments"></div>
    `;
    document.body.appendChild(sidebarEl);

    // The close button ends comment capture but deliberately leaves the sidebar in
// place: AC-1 requires the panel on screen, and hiding it would also hide the
// way back into the comment list.
    sidebarEl.querySelector('#uxfb-close-sidebar').addEventListener('click', () => {
      setMode(false);
    });
    sidebarEl.querySelector('#uxfb-filter-severity').addEventListener('change', updateSidebar);
    sidebarEl.querySelector('#uxfb-filter-status').addEventListener('change', updateSidebar);
  }

  function updateSidebar() {
    if (!sidebarEl) return;
    const container = sidebarEl.querySelector('#uxfb-sidebar-comments');
    const severityFilter = sidebarEl.querySelector('#uxfb-filter-severity').value;
    const statusFilter = sidebarEl.querySelector('#uxfb-filter-status').value;

    let filtered = comments;
    if (severityFilter) {
      filtered = filtered.filter((c) => c.severity === severityFilter);
    }
    if (statusFilter) {
      filtered = filtered.filter((c) => c.status === statusFilter);
    }

    sidebarEl.querySelector('#uxfb-sidebar-count').textContent = filtered.length;

    container.innerHTML = '';
    filtered.forEach((comment) => {
      const item = document.createElement('div');
      item.className = 'uxfb-sidebar-item' + (openCommentId === comment.id ? ' active' : '');
      item.innerHTML = `
        <div class="uxfb-sidebar-item-header">
          <span class="uxfb-sidebar-number">#${comment.number}</span>
          <span class="uxfb-sidebar-target">${escapeHtml(comment.metadata.tagName)}</span>
          <span class="uxfb-sidebar-severity ${comment.severity}">${comment.severity}</span>
          <span class="uxfb-sidebar-status ${comment.status}">${comment.status}</span>
        </div>
        <div class="uxfb-sidebar-item-text">${escapeHtml(comment.text)}</div>
        <div class="uxfb-sidebar-item-meta">
          <span>${comment.metadata.selector.slice(0, 60)}</span>
          <button class="uxfb-sidebar-scroll" title="Scroll to element">↗</button>
        </div>
      `;
      item.querySelector('.uxfb-sidebar-scroll').addEventListener('click', (e) => {
        e.stopPropagation();
        scrollToElement(comment);
      });
      item.addEventListener('click', () => {
        openCommentId = comment.id;
        updateSidebar();
        scrollToElement(comment);
      });
      container.appendChild(item);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Element Navigation & Flash ─────────────────────────────────────

  function scrollToElement(comment) {
    const el = resolveElement(comment);
    if (!el) {
      // Silent failure here would leave the designer thinking the element is
      // still on the page when it is gone — surface it instead.
      showNotice(
        'Cannot find element #' + comment.number + ' on this page (' +
        comment.metadata.tagName + '). The page may have changed.'
      );
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    flashElement(el);
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

  function flashElement(el) {
    const originalOutline = el.style.outline;
    el.style.outline = '3px solid #4285f4';
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = originalOutline;
    }, 2000);
  }

  // ── Comment Editor ─────────────────────────────────────────────────

  function openEditor(el, x, y) {
    closeEditor();
    currentTargetEl = el;
    editorEl = document.createElement('div');
    editorEl.id = 'uxfb-editor';
    editorEl.style.position = 'fixed';
    editorEl.style.left = Math.min(x, window.innerWidth - 360) + 'px';
    editorEl.style.top = Math.min(y, window.innerHeight - 300) + 'px';
    editorEl.style.zIndex = '100001';
    editorEl.innerHTML = `
      <div id="uxfb-editor-header">
        <h3>New Comment</h3>
        <button id="uxfb-editor-close">×</button>
      </div>
      <textarea id="uxfb-editor-text" placeholder="Describe your feedback about this element…" rows="4"></textarea>
      <div id="uxfb-editor-options">
        <select id="uxfb-editor-severity">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
        </select>
        <select id="uxfb-editor-status">
          <option value="open" selected>Open</option>
          <option value="in-progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
        <button id="uxfb-editor-save">Save</button>
      </div>
    `;
    document.body.appendChild(editorEl);

    editorEl.querySelector('#uxfb-editor-close').addEventListener('click', closeEditor);
    editorEl.querySelector('#uxfb-editor-save').addEventListener('click', saveComment);
  }

  function closeEditor() {
    if (editorEl) {
      editorEl.remove();
      editorEl = null;
    }
    currentTargetEl = null;
  }

  function saveComment() {
    if (!currentTargetEl || !editorEl) return;

    const text = editorEl.querySelector('#uxfb-editor-text').value.trim();
    if (!text) { closeEditor(); return; }

    const severity = editorEl.querySelector('#uxfb-editor-severity').value;
    const status = editorEl.querySelector('#uxfb-editor-status').value;

    // Remove comment if editing existing one
    const existingIdx = comments.findIndex(
      (c) => resolveElement(c) === currentTargetEl
    );
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
      if (prev.severity !== severity) {
        history.push({ field: 'severity', oldValue: prev.severity, newValue: severity, at: now });
      }
      if (prev.status !== status) {
        history.push({ field: 'status', oldValue: prev.status, newValue: status, at: now });
      }
      comment = {
        id: prev.id,
        number: prev.number,
        text: text,
        severity: severity,
        status: status,
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
        severity: severity,
        status: status,
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

  function deleteComment(commentId) {
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    comments = comments.filter((c) => c.id !== commentId);
    // Renumber
    comments.forEach((c, i) => {
      c.number = i + 1;
    });

    persistComments();
    refreshAllBadges();
    updateSidebar();
  }

  // ── Click Interception ─────────────────────────────────────────────

  function onPageClick(e) {
    if (!mode) return;
    // Don't intercept clicks inside our own UI
    if (e.target.closest('#uxfb-sidebar, #uxfb-editor, .uxfb-badge')) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const target = e.target;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    openEditor(target, x, y);
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
    mode = next;
    if (mode) {
      document.addEventListener('click', onPageClick, true);
      // Badges are positioned from the target's rect, so they must follow the
      // page as it scrolls and the viewport as it resizes.
      window.addEventListener('scroll', repositionBadges, true);
      window.addEventListener('resize', repositionBadges);
      document.body.style.cursor = 'crosshair';
      refreshAllBadges();
    } else {
      document.removeEventListener('click', onPageClick, true);
      window.removeEventListener('scroll', repositionBadges, true);
      window.removeEventListener('resize', repositionBadges);
      closeEditor();
      removeBadges();
      document.body.style.cursor = '';
    }
    // Let the popup and background know the real state; content.js is the only
    // place the mode lives, so every entry point must be told from here.
    chrome.runtime.sendMessage(
      { type: 'MODE_STATE', mode: mode },
      function () { void chrome.runtime.lastError; }
    );
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
        severity: c.severity,
        status: c.status,
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
      text += '#' + c.number + ' [' + c.severity + '/' + c.status + '] ' + c.text + '\n';
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
