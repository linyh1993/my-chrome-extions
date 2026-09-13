/**
 * SuperX Popup Controller
 */
document.addEventListener("DOMContentLoaded", async () => {
  const storage = window.__SuperX__.Storage;

  const toggleCleaner = document.getElementById("toggle-cleaner");
  const toggleBetterUI = document.getElementById("toggle-better-ui");
  const toggleFollowList = document.getElementById("toggle-follow-list");
  const toggleViralMonitor = document.getElementById("toggle-viral-monitor");
  const popupBlockedCount = document.getElementById("popup-blocked-count");
  const popupFollowCount = document.getElementById("popup-follow-count");
  const popupAutoBlock = document.getElementById("popup-auto-block");
  const popupModeCollapse = document.getElementById("popupModeCollapse");
  const popupModeHide = document.getElementById("popupModeHide");

  const popupHideTrends = document.getElementById("popup-hide-trends");
  const popupWiden = document.getElementById("popup-widen");
  const popupOutline = document.getElementById("popup-outline");

  const popupViralBadges = document.getElementById("popup-viral-badges");
  const popupViralBookmarks = document.getElementById("popup-viral-bookmarks");
  const popupViralCopyMd = document.getElementById("popup-viral-copy-md");

  const btnGotoCleaner = document.getElementById("btn-goto-cleaner-settings");
  const btnGotoFollowCurator = document.getElementById("btn-goto-follow-curator");
  const btnOpenSidepanel = document.getElementById("btn-open-sidepanel");

  // 2. 读取 SuperX 总控状态
  chrome.runtime.sendMessage({ type: "GET_CORE_STATE" }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) return;
    const features = response.state.features || {};
    if (toggleCleaner) {
      toggleCleaner.checked = features["x-comment-cleaner"] ? features["x-comment-cleaner"].enabled : true;
    }
    if (toggleBetterUI) {
      toggleBetterUI.checked = features["x-better-ui"] ? features["x-better-ui"].enabled : true;
    }
    if (toggleFollowList) {
      toggleFollowList.checked = features["x-follow-to-list"] ? features["x-follow-to-list"].enabled : true;
    }
    if (toggleViralMonitor) {
      toggleViralMonitor.checked = features["x-viral-monitor"] ? features["x-viral-monitor"].enabled : true;
    }
  });

  // 读取已捕获关注数
  chrome.storage.local.get(["superx_follow_list_captured_users"], (data) => {
    const list = Array.isArray(data.superx_follow_list_captured_users) ? data.superx_follow_list_captured_users : [];
    if (popupFollowCount) popupFollowCount.textContent = list.length;
  });

  // 3. 读取 x-comment-cleaner 专属配置
  let cleanerConfig = await storage.getConfig("x-comment-cleaner", {
    hideMode: 'collapse',
    autoBlock: false
  });

  chrome.storage.sync.get(["blockedCount"], (data) => {
    if (popupBlockedCount) popupBlockedCount.textContent = data.blockedCount || 0;
  });

  if (popupAutoBlock) popupAutoBlock.checked = cleanerConfig.autoBlock === true;
  if (cleanerConfig.hideMode === "hide") {
    if (popupModeHide) popupModeHide.checked = true;
  } else {
    if (popupModeCollapse) popupModeCollapse.checked = true;
  }

  // 4. 读取 x-better-ui 专属配置
  let uiConfig = await storage.getConfig("x-better-ui", {
    hideTrending: true,
    widenTimeline: true,
    generateOutline: true
  });

  if (popupHideTrends) popupHideTrends.checked = uiConfig.hideTrending !== false;
  if (popupWiden) popupWiden.checked = uiConfig.widenTimeline !== false;
  if (popupOutline) popupOutline.checked = uiConfig.generateOutline !== false;

  // 5. 事件绑定 - 主开关
  if (toggleCleaner) {
    toggleCleaner.addEventListener("change", () => {
      chrome.runtime.sendMessage({
        type: "UPDATE_FEATURE_STATE",
        featureId: "x-comment-cleaner",
        enabled: toggleCleaner.checked
      });
    });
  }

  if (toggleBetterUI) {
    toggleBetterUI.addEventListener("change", () => {
      chrome.runtime.sendMessage({
        type: "UPDATE_FEATURE_STATE",
        featureId: "x-better-ui",
        enabled: toggleBetterUI.checked
      });
    });
  }

  if (toggleFollowList) {
    toggleFollowList.addEventListener("change", () => {
      chrome.runtime.sendMessage({
        type: "UPDATE_FEATURE_STATE",
        featureId: "x-follow-to-list",
        enabled: toggleFollowList.checked
      });
    });
  }

  if (toggleViralMonitor) {
    toggleViralMonitor.addEventListener("change", () => {
      chrome.runtime.sendMessage({
        type: "UPDATE_FEATURE_STATE",
        featureId: "x-viral-monitor",
        enabled: toggleViralMonitor.checked
      });
    });
  }

  // 4.1 读取 x-viral-monitor 专属配置
  let viralConfig = {
    showBadges: true,
    showBookmarkCount: true,
    copyAsMarkdown: true
  };
  try {
    const vStored = await chrome.storage.local.get(["superx_viral_monitor_config"]);
    if (vStored.superx_viral_monitor_config) {
      viralConfig = { ...viralConfig, ...vStored.superx_viral_monitor_config };
    }
  } catch (e) {}

  if (popupViralBadges) popupViralBadges.checked = viralConfig.showBadges !== false;
  if (popupViralBookmarks) popupViralBookmarks.checked = viralConfig.showBookmarkCount !== false;
  if (popupViralCopyMd) popupViralCopyMd.checked = viralConfig.copyAsMarkdown !== false;

  const saveViralConfig = async () => {
    try {
      await chrome.storage.local.set({ superx_viral_monitor_config: viralConfig });
      chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] }, (tabs) => {
        tabs.forEach(t => {
          chrome.tabs.sendMessage(t.id, {
            type: 'SUPERX_VIRAL_UPDATE_CONFIG',
            config: viralConfig
          }).catch(() => {});
        });
      });
    } catch (e) {}
  };

  if (popupViralBadges) {
    popupViralBadges.addEventListener("change", () => {
      viralConfig.showBadges = popupViralBadges.checked;
      saveViralConfig();
    });
  }

  if (popupViralBookmarks) {
    popupViralBookmarks.addEventListener("change", () => {
      viralConfig.showBookmarkCount = popupViralBookmarks.checked;
      saveViralConfig();
    });
  }

  if (popupViralCopyMd) {
    popupViralCopyMd.addEventListener("change", () => {
      viralConfig.copyAsMarkdown = popupViralCopyMd.checked;
      saveViralConfig();
    });
  }

  // 6. 事件绑定 - 评论拦截快捷选项
  if (popupAutoBlock) {
    popupAutoBlock.addEventListener("change", async () => {
      cleanerConfig.autoBlock = popupAutoBlock.checked;
      await storage.setConfig("x-comment-cleaner", cleanerConfig);
    });
  }

  if (popupModeCollapse) {
    popupModeCollapse.addEventListener("change", async () => {
      if (popupModeCollapse.checked) {
        cleanerConfig.hideMode = "collapse";
        await storage.setConfig("x-comment-cleaner", cleanerConfig);
      }
    });
  }

  if (popupModeHide) {
    popupModeHide.addEventListener("change", async () => {
      if (popupModeHide.checked) {
        cleanerConfig.hideMode = "hide";
        await storage.setConfig("x-comment-cleaner", cleanerConfig);
      }
    });
  }

  // 7. 事件绑定 - 界面增强快捷选项
  if (popupHideTrends) {
    popupHideTrends.addEventListener("change", async () => {
      uiConfig.hideTrending = popupHideTrends.checked;
      await storage.setConfig("x-better-ui", uiConfig);
    });
  }

  if (popupWiden) {
    popupWiden.addEventListener("change", async () => {
      uiConfig.widenTimeline = popupWiden.checked;
      await storage.setConfig("x-better-ui", uiConfig);
    });
  }

  if (popupOutline) {
    popupOutline.addEventListener("change", async () => {
      uiConfig.generateOutline = popupOutline.checked;
      await storage.setConfig("x-better-ui", uiConfig);
    });
  }

  // 8. 唤起 Side Panel
  async function openSidePanel(targetTab) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.runtime.sendMessage({
        type: "OPEN_SIDE_PANEL",
        tabId: tab.id,
        tab: targetTab
      }, (res) => {
        if (res && res.success) {
          window.close();
        }
      });
    }
  }

  if (btnGotoCleaner) btnGotoCleaner.addEventListener("click", () => openSidePanel("tab-cleaner"));
  if (btnGotoFollowCurator) btnGotoFollowCurator.addEventListener("click", () => openSidePanel("tab-follow-list"));
  if (btnOpenSidepanel) btnOpenSidepanel.addEventListener("click", () => openSidePanel());

  // 9. 监听跨上下文 storage 实时更新计数
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.blockedCount && popupBlockedCount) {
      popupBlockedCount.textContent = changes.blockedCount.newValue || 0;
    }
  });
});
