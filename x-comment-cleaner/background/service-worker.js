/**
 * X Spam Reply Cleaner - Extension Service Worker (Manifest V3)
 */

const DEFAULT_KEYWORDS = [
  "比她好看",
  "没她骚",
  "看主页",
  "看主頁",
  "看置顶",
  "私信",
  "私聊",
  "私我",
  "进群",
  "加v",
  "加V",
  "加VX",
  "门槛",
  "门槛群",
  "福利",
  "同城",
  "约拍",
  "资源群",
  "群内看",
  "微密圈",
  "无圣光"
];

const DEFAULT_SETTINGS = {
  enabled: true,
  hideMode: "collapse", // "collapse" or "hide"
  filterKeywords: true,
  filterMentionSpam: true,
  filterDuplicates: true,
  keywords: DEFAULT_KEYWORDS,
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
      sendResponse({ success: true, settings: { ...DEFAULT_SETTINGS, ...settings } });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});
