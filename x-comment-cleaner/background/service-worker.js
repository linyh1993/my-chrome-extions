/**
 * X Spam Reply Cleaner - Extension Service Worker (Manifest V3)
 */

importScripts('../shared/rules.js');

const rulesEngine = globalThis.XCleanerRules || {};
const DEFAULT_SETTINGS = rulesEngine.DEFAULT_CLEANER_SETTINGS || {
  enabled: true,
  hideMode: 'collapse',
  filterKeywords: true,
  filterHomophones: true,
  filterPureNumbers: true,
  filterMentionSpam: true,
  filterDuplicates: true,
  filterSimhash: true,
  filterHeuristics: true,
  packSettings: {},
  customKeywords: [],
  whitelist: [],
  blockedCount: 0
};

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const current = await chrome.storage.sync.get(null);
    const toSet = {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (current[key] === undefined) {
        toSet[key] = value;
      }
    }

    if (Object.keys(toSet).length > 0) {
      await chrome.storage.sync.set(toSet);
    }
  } catch (err) {
    console.error("[X Cleaner SW] Error initializing defaults:", err);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "INCREMENT_BLOCKED_COUNT") {
    const delta = typeof request.delta === "number" ? request.delta : 1;
    chrome.storage.sync.get(["blockedCount"]).then((data) => {
      const newCount = (data.blockedCount || 0) + delta;
      chrome.storage.sync.set({ blockedCount: newCount });
      sendResponse({ success: true, count: newCount });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.type === "GET_SETTINGS") {
    chrome.storage.sync.get(null).then((settings) => {
      sendResponse({
        success: true,
        settings: {
          ...DEFAULT_SETTINGS,
          ...settings
        }
      });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});
