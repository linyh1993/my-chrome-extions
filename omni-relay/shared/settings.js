/**
 * @file 中继配置与存储状态管理器 (chrome.storage)
 * 支持版本控制迁移、多站点独立开关、本地 Endpoint 配置以及累计指标统计。
 */
const RelaySettings = (() => {
  const STORAGE_KEY = 'omni_relay_settings';
  const METRICS_KEY = 'omni_relay_metrics';
  const SCHEMA_VERSION = 1;

  const DEFAULT_SETTINGS = {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    endpointUrl: 'http://127.0.0.1:9090/relay',
    autoAttach: true,
    sites: {
      x: {
        enabled: true,
        networkMirror: true,
        domExtract: false
      },
      reddit: {
        enabled: true,
        networkMirror: true,
        domExtract: true
      }
    }
  };

  const DEFAULT_METRICS = {
    totalRelayedCount: 0,
    bySite: {
      x: 0,
      reddit: 0
    },
    byChannel: {
      network_http: 0,
      network_ws: 0,
      dom_extracted: 0
    },
    lastRelayedAt: null,
    lastDeliveryStatus: null
  };

  function normalizeSettings(raw) {
    const current = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    current.sites = { ...DEFAULT_SETTINGS.sites, ...(raw?.sites || {}) };
    current.endpointUrl = String(current.endpointUrl || DEFAULT_SETTINGS.endpointUrl).trim();
    if (!current.endpointUrl) current.endpointUrl = DEFAULT_SETTINGS.endpointUrl;
    current.enabled = current.enabled !== false;
    current.autoAttach = current.autoAttach !== false;
    return current;
  }

  function normalizeMetrics(raw) {
    return {
      ...DEFAULT_METRICS,
      ...(raw || {}),
      bySite: { ...DEFAULT_METRICS.bySite, ...(raw?.bySite || {}) },
      byChannel: { ...DEFAULT_METRICS.byChannel, ...(raw?.byChannel || {}) }
    };
  }

  /**
   * 加载设置 (优先 chrome.storage.sync，失败回退 local)
   */
  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (data) => {
        if (chrome.runtime.lastError) {
          chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (localData) => {
            resolve(normalizeSettings(localData[STORAGE_KEY]));
          });
          return;
        }
        resolve(normalizeSettings(data[STORAGE_KEY]));
      });
    });
  }

  /**
   * 保存设置
   */
  function saveSettings(partial) {
    return loadSettings().then((cur) => {
      const next = normalizeSettings({ ...cur, ...partial });
      return new Promise((resolve) => {
        chrome.storage.sync.set({ [STORAGE_KEY]: next }, () => {
          if (chrome.runtime.lastError) {
            chrome.storage.local.set({ [STORAGE_KEY]: next }, () => resolve(next));
          } else {
            resolve(next);
          }
        });
      });
    });
  }

  /**
   * 加载度量统计 (存放在 local 中)
   */
  function loadMetrics() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [METRICS_KEY]: DEFAULT_METRICS }, (data) => {
        resolve(normalizeMetrics(data[METRICS_KEY]));
      });
    });
  }

  /**
   * 记录一次成功的投递统计
   * @param {string} siteId
   * @param {string} channel
   * @param {number} count
   */
  async function recordSuccess(siteId, channel, count = 1) {
    const metrics = await loadMetrics();
    metrics.totalRelayedCount = (metrics.totalRelayedCount || 0) + count;
    metrics.bySite[siteId] = (metrics.bySite[siteId] || 0) + count;
    metrics.byChannel[channel] = (metrics.byChannel[channel] || 0) + count;
    metrics.lastRelayedAt = new Date().toISOString();
    metrics.lastDeliveryStatus = { ok: true, at: Date.now() };

    return new Promise((resolve) => {
      chrome.storage.local.set({ [METRICS_KEY]: metrics }, () => resolve(metrics));
    });
  }

  /**
   * 记录一次失败的投递状态
   * @param {string} error
   */
  async function recordFailure(error) {
    const metrics = await loadMetrics();
    metrics.lastDeliveryStatus = { ok: false, error: String(error), at: Date.now() };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [METRICS_KEY]: metrics }, () => resolve(metrics));
    });
  }

  /**
   * 重置度量统计
   */
  function resetMetrics() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [METRICS_KEY]: DEFAULT_METRICS }, () => resolve(DEFAULT_METRICS));
    });
  }

  return {
    STORAGE_KEY,
    METRICS_KEY,
    DEFAULT_SETTINGS,
    DEFAULT_METRICS,
    loadSettings,
    saveSettings,
    loadMetrics,
    recordSuccess,
    recordFailure,
    resetMetrics,
    normalizeSettings
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RelaySettings;
}
