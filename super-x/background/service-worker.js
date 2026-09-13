/**
 * SuperX - Background Service Worker (Manifest V3, ESM)
 */

// 默认总控与各模块状态
const DEFAULT_SUPERX_STATE = {
  version: "1.0.0",
  globalEnabled: true,
  features: {
    "x-comment-cleaner": { enabled: true },
    "x-better-ui": { enabled: true },
    "x-follow-to-list": { enabled: true }
  }
};

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[SuperX SW] Installed:", details.reason);
  try {
    const data = await chrome.storage.local.get(["superx_core"]);
    if (!data.superx_core) {
      await chrome.storage.local.set({ superx_core: DEFAULT_SUPERX_STATE });
    }

    // 设置侧边栏行为：允许通过 API 打开
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
  } catch (err) {
    console.error("[SuperX SW] Install initialization error:", err);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "OPEN_SIDE_PANEL") {
    const tabId = sender.tab?.id || request.tabId;
    if (request.tab) {
      chrome.storage.session.set({ superx_active_sidepanel_tab: request.tab }).catch(() => {});
    }
    if (tabId && chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ tabId }).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    sendResponse({ success: false, error: "Side panel not supported or tab missing" });
    return false;
  }

  if (request.type === "GET_CORE_STATE") {
    chrome.storage.local.get(["superx_core"]).then((data) => {
      sendResponse({ success: true, state: data.superx_core || DEFAULT_SUPERX_STATE });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.type === "UPDATE_FEATURE_STATE") {
    const { featureId, enabled } = request;
    chrome.storage.local.get(["superx_core"]).then(async (data) => {
      const core = data.superx_core || DEFAULT_SUPERX_STATE;
      if (!core.features) core.features = {};
      core.features[featureId] = { ...(core.features[featureId] || {}), enabled };
      await chrome.storage.local.set({ superx_core: core });

      // 通知所有已打开的 tab
      const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: "FEATURE_STATE_CHANGED",
            featureId,
            enabled
          }).catch(() => {});
        }
      }

      sendResponse({ success: true, core });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

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
});
