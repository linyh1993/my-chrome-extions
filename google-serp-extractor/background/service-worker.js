/**
 * Background Service Worker for Google SERP & SEO Extractor
 * Manifest V3 compliant
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[GSE] Google SERP & SEO Extractor installed successfully.');
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.cmd === 'UPDATE_BADGE') {
    const tabId = sender.tab ? sender.tab.id : undefined;
    if (tabId) {
      const count = request.count || 0;
      const text = count > 0 ? String(count) : '';
      chrome.action.setBadgeText({ text, tabId });

      // Green if all ready, orange if pending
      const color = request.ready ? '#059669' : '#d97706';
      chrome.action.setBadgeBackgroundColor({ color, tabId });
    }
    sendResponse({ ok: true });
    return false;
  }
});
