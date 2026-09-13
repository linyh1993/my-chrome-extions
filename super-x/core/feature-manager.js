/**
 * SuperX Core - FeatureManager
 * 插件化业务特性的生命周期与分发中枢
 */
(function() {
  window.__SuperX__ = window.__SuperX__ || {};

  class FeatureManager {
    constructor() {
      this.features = new Map();
      this.enabledState = new Map();
      this.initialized = false;
    }

    /**
     * 注册业务模块
     */
    register(feature) {
      if (!feature || !feature.id) {
        throw new Error("[SuperX FeatureManager] Invalid feature registration: missing id");
      }
      this.features.set(feature.id, feature);
      this.enabledState.set(feature.id, !!feature.defaultEnabled);
      console.log(`[SuperX FeatureManager] Registered feature: ${feature.id} (${feature.name})`);
    }

    /**
     * 启动整个 SuperX 特性管理体系
     */
    async start() {
      if (this.initialized) return;
      this.initialized = true;

      // 1. 读取总控配置
      let coreState = null;
      try {
        const res = await chrome.storage.local.get(["superx_core"]);
        coreState = res.superx_core;
      } catch (err) {
        console.warn("[SuperX FeatureManager] Failed to read core state:", err);
      }

      const globalEnabled = coreState ? coreState.globalEnabled !== false : true;
      const featureConfigs = (coreState && coreState.features) || {};

      // 2. 初始化各模块
      for (const [id, feature] of this.features.entries()) {
        const isEnabled = globalEnabled && (
          featureConfigs[id] ? featureConfigs[id].enabled : feature.defaultEnabled
        );
        this.enabledState.set(id, isEnabled);

        const context = {
          storage: window.__SuperX__.Storage,
          eventBus: window.__SuperX__.EventBus
        };

        try {
          if (typeof feature.init === "function") {
            await feature.init(context);
          }
          if (isEnabled && typeof feature.enable === "function") {
            await feature.enable();
          }
        } catch (err) {
          console.error(`[SuperX FeatureManager] Error initializing feature '${id}':`, err);
        }
      }

      // 3. 挂载全局 DOM 观察分发
      const domObserver = window.__SuperX__.DOMObserver;
      if (domObserver) {
        domObserver.onTweets((tweets) => {
          this._dispatchDOMNodes(tweets);
        });

        domObserver.onRouteChange((newUrl, prevUrl) => {
          this._dispatchRouteChange(newUrl, prevUrl);
        });

        domObserver.start();
      }

      // 4. 挂载 GraphQL 网络响应分发
      const eventBus = window.__SuperX__.EventBus;
      if (eventBus) {
        eventBus.on("graphql:response", ({ endpoint, data }) => {
          this._dispatchGraphQLResponse(endpoint, data);
        });
      }
    }

    async toggleFeature(featureId, enable) {
      const feature = this.features.get(featureId);
      if (!feature) return;

      const current = !!this.enabledState.get(featureId);
      if (current === enable) return;

      this.enabledState.set(featureId, enable);
      try {
        if (enable && typeof feature.enable === "function") {
          await feature.enable();
        } else if (!enable && typeof feature.disable === "function") {
          await feature.disable();
        }
      } catch (err) {
        console.error(`[SuperX FeatureManager] Error toggling feature '${featureId}':`, err);
      }
    }

    _dispatchDOMNodes(nodes) {
      for (const [id, feature] of this.features.entries()) {
        if (this.enabledState.get(id) && typeof feature.onDOMNodes === "function") {
          try {
            feature.onDOMNodes(nodes);
          } catch (err) {
            console.error(`[SuperX FeatureManager] Error in onDOMNodes for '${id}':`, err);
          }
        }
      }
    }

    _dispatchRouteChange(newUrl, prevUrl) {
      for (const [id, feature] of this.features.entries()) {
        if (this.enabledState.get(id) && typeof feature.onRouteChange === "function") {
          try {
            feature.onRouteChange(newUrl, prevUrl);
          } catch (err) {
            console.error(`[SuperX FeatureManager] Error in onRouteChange for '${id}':`, err);
          }
        }
      }
    }

    _dispatchGraphQLResponse(endpoint, data) {
      for (const [id, feature] of this.features.entries()) {
        if (this.enabledState.get(id) && typeof feature.onGraphQLResponse === "function") {
          try {
            feature.onGraphQLResponse(endpoint, data);
          } catch (err) {
            console.error(`[SuperX FeatureManager] Error in onGraphQLResponse for '${id}':`, err);
          }
        }
      }
    }
  }

  window.__SuperX__.FeatureManager = new FeatureManager();
})();
