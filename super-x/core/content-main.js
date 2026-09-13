/**
 * SuperX Core - Content Main Entry
 * 组装各核心子系统并启动
 */
(function() {
  'use strict';

  console.log("[SuperX] Content Script initializing on", location.href);

  // 1. 监听来自 MAIN world 的 GraphQL 网络事件
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === "superx-network-hook") {
      if (window.__SuperX__ && window.__SuperX__.EventBus) {
        window.__SuperX__.EventBus.emit("graphql:response", {
          endpoint: data.endpoint,
          data: data.data
        });
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
