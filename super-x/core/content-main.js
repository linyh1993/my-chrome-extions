/**
 * SuperX Core - Content Main Entry
 * 组装各核心子系统并启动
 */
(function() {
  'use strict';

  console.log("[SuperX] Content Script initializing on", location.href);

  // 1. 监听来自 MAIN world 的网络与代理调用事件
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === "superx-network-hook") {
      if (window.__SuperX__ && window.__SuperX__.EventBus) {
        if (data.endpoint) {
          window.__SuperX__.EventBus.emit("graphql:response", {
            endpoint: data.endpoint,
            data: data.data
          });
        }
        if (data.type === "SUPERX_ADD_LIST_MEMBER_RESULT") {
          window.__SuperX__.EventBus.emit("list:add_result", data);
        }
      }
    }
  });

  // 2. 监听后台推送的状态变更消息
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "FEATURE_STATE_CHANGED") {
      const { featureId, enabled } = message;
      if (window.__SuperX__ && window.__SuperX__.FeatureManager) {
        window.__SuperX__.FeatureManager.toggleFeature(featureId, enabled);
      }
    }
  });

  // 3. 启动特性管理器
  if (window.__SuperX__ && window.__SuperX__.FeatureManager) {
    window.__SuperX__.FeatureManager.start().then(() => {
      console.log("[SuperX] All features started successfully.");
    }).catch((err) => {
      console.error("[SuperX] FeatureManager start error:", err);
    });
  }
})();
