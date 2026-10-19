/**
 * UX Feedback Extension — Background Service Worker (Manifest V3)
 *
 * Owns the desired feedback-mode state so the toolbar icon, the popup and the
 * page never disagree. content.js is the authority for what a given tab is
 * actually doing, but this worker keeps the last requested mode per tab so a
 * click from the icon and a click from the popup land on the same state rather
 * than each blind-toggling and cancelling the other out.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[UX Feedback] Extension installed');
});

/** tabId -> desired mode */
const tabModes = new Map();

function tabIdOf(tab) {
  return tab && typeof tab.id === 'number' ? tab.id : null;
}

async function applyMode(tabId, mode) {
  if (tabId === null) return { mode: mode, error: 'no tab' };
  tabModes.set(tabId, mode);
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'SET_MODE', mode });
  } catch (err) {
    // The content script is not present on this tab yet (chrome:// pages, a
    // page that loaded before the extension). Inject it, then retry once.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['scripts/content.js'],
      });
      return await chrome.tabs.sendMessage(tabId, { type: 'SET_MODE', mode });
    } catch (retryErr) {
      const detail = String((retryErr && retryErr.message) ||
        chrome.runtime.lastError || retryErr);
      console.warn('[UX Feedback] Could not set mode on tab', tabId, detail);
      return { mode: mode, injected: false, error: detail };
    }
  }
}

/**
 * Write the export to the user's Downloads folder as a .json file.
 *
 * Two things were learned by running this against a genuinely loaded extension:
 *  1. A content-script anchor+Blob click creates the anchor with the right
 *     filename but never starts a download, so the work moved here.
 *  2. `URL.createObjectURL` does not exist in an MV3 service worker, so the
 *     payload is handed over as a data: URL instead.
 */
async function downloadExport(payload, filename) {
  const json = JSON.stringify(payload, null, 2);
  const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  try {
    const id = await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false,
    });
    return { success: true, downloadId: id, bytes: json.length };
  } catch (err) {
    const detail = String((err && err.message) || chrome.runtime.lastError || err);
    console.warn('[UX Feedback] Export download failed:', detail);
    return { success: false, error: detail };
  }
}

// Toolbar icon: flip the remembered state for that tab.
chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tabIdOf(tab);
  const next = !tabModes.get(tabId);
  await applyMode(tabId, next);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabModes.delete(tabId);
});

// The popup and the page talk to the worker so both observe one mode value.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'REQUEST_TOGGLE': {
      // The popup has no sender.tab, so it passes tabId explicitly; a content
      // script sends without one and is identified by its own sender.
      const id = message.tabId !== undefined ? message.tabId : tabIdOf(sender.tab);
      const next = !tabModes.get(id);
      applyMode(id, next).then(sendResponse);
      return true; // async response
    }
    case 'REQUEST_SET_MODE': {
      const id = message.tabId !== undefined ? message.tabId : tabIdOf(sender.tab);
      applyMode(id, !!message.mode).then(sendResponse);
      return true;
    }
    case 'GET_TAB_MODE': {
      const id = message.tabId !== undefined ? message.tabId : tabIdOf(sender.tab);
      sendResponse({ mode: !!tabModes.get(id) });
      return false;
    }
    case 'DOWNLOAD_EXPORT': {
      // Run in the service worker so the download is started from a proper
      // extension context rather than a content script's isolated world.
      downloadExport(message.payload, message.filename).then(sendResponse);
      return true; // async response
    }
    case 'MODE_STATE':
      // The page is the authority for its own tab; record what it reports.
      if (sender && sender.tab) tabModes.set(sender.tab.id, !!message.mode);
      sendResponse({ received: true });
      return false;
    default:
      sendResponse({ received: true });
      return false;
  }
});