/**
 * SuperX Core - Storage
 * 命名空间隔离的存储引擎，防止模块间键名冲突
 */
(function() {
  window.__SuperX__ = window.__SuperX__ || {};

  const PREFIX_CONFIG = "superx:feature:";

  class StorageManager {
    /**
     * 获取指定模块的配置
     */
    async getConfig(featureId, defaultConfig = {}) {
      const key = `${PREFIX_CONFIG}${featureId}:config`;
      try {
        const res = await chrome.storage.local.get([key]);
        return res[key] !== undefined ? { ...defaultConfig, ...res[key] } : defaultConfig;
      } catch (err) {
        console.error(`[SuperX Storage] Failed to get config for '${featureId}':`, err);
        return defaultConfig;
      }
    }

    /**
     * 保存指定模块的配置
     */
    async setConfig(featureId, config) {
      const key = `${PREFIX_CONFIG}${featureId}:config`;
      try {
        await chrome.storage.local.set({ [key]: config });
        return true;
      } catch (err) {
        console.error(`[SuperX Storage] Failed to save config for '${featureId}':`, err);
        return false;
      }
    }

    /**
     * 获取指定模块的数据（如统计数据、缓存等）
     */
    async getData(featureId, defaultData = {}) {
      const key = `${PREFIX_CONFIG}${featureId}:data`;
      try {
        const res = await chrome.storage.local.get([key]);
        return res[key] !== undefined ? { ...defaultData, ...res[key] } : defaultData;
      } catch (err) {
        console.error(`[SuperX Storage] Failed to get data for '${featureId}':`, err);
        return defaultData;
      }
    }

    /**
     * 保存指定模块的数据
     */
    async setData(featureId, data) {
      const key = `${PREFIX_CONFIG}${featureId}:data`;
      try {
        await chrome.storage.local.set({ [key]: data });
        return true;
      } catch (err) {
        console.error(`[SuperX Storage] Failed to save data for '${featureId}':`, err);
        return false;
      }
    }

    /**
     * 导出所有 SuperX 相关数据
     */
    async exportAll() {
      const all = await chrome.storage.local.get(null);
      const superxData = {};
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith("superx")) {
          superxData[k] = v;
        }
      }
      return superxData;
    }
  }

  window.__SuperX__.Storage = new StorageManager();
})();
