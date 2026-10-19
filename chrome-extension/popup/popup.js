/**
 * UX Feedback Extension — Popup Script
 * Handles mode toggle, comment display, JSON export, and plain-text copy.
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggle-btn');
  const exportBtn = document.getElementById('export-btn');
  const copyBtn = document.getElementById('copy-btn');
  const statusEl = document.getElementById('status');
  const commentListEl = document.getElementById('comment-list');

  function updateStatus(mode) {
    statusEl.textContent = 'Feedback mode: ' + (mode ? 'ON' : 'OFF');
    statusEl.className = 'status ' + (mode ? 'on' : 'off');
  }

  function renderComments(comments) {
    if (!comments || comments.length === 0) {
      commentListEl.innerHTML = '<div class="empty">No comments yet. Toggle mode and click an element.</div>';
      return;
    }
    commentListEl.innerHTML = '';
    comments.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'comment-item';
      item.innerHTML = `
        <div class="meta">#${c.number} — ${c.metadata.tagName} — ${c.severity}/${c.status}</div>
        <div class="text">${escapeHtml(c.text)}</div>
        <div class="meta">${c.metadata.selector.slice(0, 80)}</div>
      `;
      commentListEl.appendChild(item);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function refreshState() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].id) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_MODE' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          updateStatus(false);
        } else {
          updateStatus(response.mode);
        }
      });
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_COMMENTS' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          renderComments([]);
        } else {
          renderComments(response.comments);
        }
      });
    });
  }

  // Ask the background worker, which owns the per-tab mode value, so the icon
  // and the popup cannot disagree by each blind-toggling the page.
  toggleBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].id) return;
      chrome.runtime.sendMessage(
        { type: 'REQUEST_TOGGLE', tabId: tabs[0].id },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            updateStatus(false);
          } else {
            updateStatus(!!response.mode);
          }
        }
      );
      refreshState();
    });
  });

  exportBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].id) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'EXPORT_JSON' });
    });
  });

  copyBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].id) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'COPY_PLAIN_TEXT' });
    });
  });

  refreshState();
});
