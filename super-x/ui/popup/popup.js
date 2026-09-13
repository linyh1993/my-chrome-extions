/**
 * SuperX Popup Controller
 */
document.addEventListener("DOMContentLoaded", async () => {
  const toggleCleaner = document.getElementById("toggle-cleaner");
  const toggleBetterUI = document.getElementById("toggle-better-ui");
  const btnSidepanel = document.getElementById("btn-open-sidepanel");

  // 1. 初始化读取当前模块开启状态
  chrome.runtime.sendMessage({ type: "GET_CORE_STATE" }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      console.warn("Failed to get core state:", chrome.runtime.lastError);
      return;
    }

    const features = response.state.features || {};
    if (toggleCleaner) {
      toggleCleaner.checked = features["x-comment-cleaner"] ? features["x-comment-cleaner"].enabled : true;
    }
    if (toggleBetterUI) {
      toggleBetterUI.checked = features["x-better-ui"] ? features["x-better-ui"].enabled : true;
    }
  });

  // 2. 绑定开关事件
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

  // 3. 打开侧边栏
  if (btnSidepanel) {
    btnSidepanel.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.runtime.sendMessage({
          type: "OPEN_SIDE_PANEL",
          tabId: tab.id
        }, (res) => {
          if (res && res.success) {
            window.close(); // 顺利唤起侧栏后关闭 Popup
          } else {
            console.warn("Could not open side panel:", res?.error);
          }
        });
      }
    });
  }
});
