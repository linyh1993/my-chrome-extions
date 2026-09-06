/**
 * @file Content Script 统一路由入口 (Content Script Router Entry)
 * 根据当前网页域名自动识别目标站点，并根据存储配置动态装载与启停对应的 DOM Extractor。
 */
(function () {
  if (window.__OMNI_RELAY_CONTENT_INJECTED__) return;
  window.__OMNI_RELAY_CONTENT_INJECTED__ = true;

  const STORAGE_KEY = 'omni_relay_settings';

  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  function detectSiteId(hostname) {
    const h = (hostname || '').toLowerCase();
    if (h.includes('reddit.com')) return 'reddit';
    if (h.includes('x.com') || h.includes('twitter.com')) return 'x';
    return null;
  }

  const siteId = detectSiteId(window.location.hostname);
  if (!siteId) return;

  function updateExtractorState(cfg) {
    if (!isExtensionValid()) return;

    const isGlobalEnabled = cfg?.enabled !== false;
    const siteCfg = cfg?.sites?.[siteId];
    const isSiteDomEnabled = isGlobalEnabled && siteCfg?.enabled !== false && siteCfg?.domExtract === true;

    if (siteId === 'reddit' && window.RedditExtractor) {
      if (isSiteDomEnabled) {
        window.RedditExtractor.start();
      } else {
        window.RedditExtractor.stop();
      }
    }
  }

  function init() {
    if (!isExtensionValid()) return;

    try {
      chrome.storage.sync.get({ [STORAGE_KEY]: null }, (syncData) => {
        if (chrome.runtime.lastError || !syncData[STORAGE_KEY]) {
          chrome.storage.local.get({ [STORAGE_KEY]: null }, (localData) => {
            updateExtractorState(localData[STORAGE_KEY] || {});
          });
          return;
        }
        updateExtractorState(syncData[STORAGE_KEY] || {});
      });

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (changes[STORAGE_KEY] && isExtensionValid()) {
          updateExtractorState(changes[STORAGE_KEY].newValue || {});
        }
      });
    } catch (e) {
      console.warn('[OmniRelay-Content] 初始化配置监听失败:', e);
    }
  }

  // 页面就绪后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
