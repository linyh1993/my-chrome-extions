/**
 * @file 配置与状态存储管理 (Storage & State Manager)
 * 封装 chrome.storage.local 读写、设置规范化及运行时度量统计。
 */

export const SETTINGS_KEY = 'omni_settings';
export const METRICS_KEY = 'omni_metrics';

export const DEFAULT_SETTINGS = {
  version: 1,
  enabled: true,
  endpointUrl: 'http://127.0.0.1:9090/relay',
  sites: {
    x: { enabled: true, network: true, dom: false },
    reddit: { enabled: true, network: true, dom: true }
  }
};

export const DEFAULT_METRICS = {
  totalCount: 0,
  bySite: { x: 0, reddit: 0 },
  lastDelivery: null
};

export function normalizeSettings(raw) {
  const cfg = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  cfg.endpointUrl = String(cfg.endpointUrl || DEFAULT_SETTINGS.endpointUrl).trim();
  if (!cfg.endpointUrl) cfg.endpointUrl = DEFAULT_SETTINGS.endpointUrl;
  cfg.enabled = cfg.enabled !== false;
  cfg.sites = { ...DEFAULT_SETTINGS.sites, ...(raw?.sites || {}) };
  return cfg;
}

export async function getSettings() {
  const data = await chrome.storage.local.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return normalizeSettings(data[SETTINGS_KEY]);
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...partial });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getMetrics() {
  const data = await chrome.storage.local.get({ [METRICS_KEY]: DEFAULT_METRICS });
  return { ...DEFAULT_METRICS, ...(data[METRICS_KEY] || {}) };
}

export async function recordRelaySuccess(siteId, count = 1) {
  const metrics = await getMetrics();
  metrics.totalCount += count;
  metrics.bySite[siteId] = (metrics.bySite[siteId] || 0) + count;
  metrics.lastDelivery = { ok: true, at: Date.now() };
  await chrome.storage.local.set({ [METRICS_KEY]: metrics });
  return metrics;
}

export async function recordRelayFailure(error) {
  const metrics = await getMetrics();
  metrics.lastDelivery = { ok: false, error: String(error), at: Date.now() };
  await chrome.storage.local.set({ [METRICS_KEY]: metrics });
  return metrics;
}

export async function resetMetrics() {
  await chrome.storage.local.set({ [METRICS_KEY]: DEFAULT_METRICS });
  return DEFAULT_METRICS;
}
