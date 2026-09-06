/**
 * @file Content Script 路由器 (Content Script Router)
 * 监听存储配置，按需启停当前站点的 DOM Extractor。
 */

(function () {
  if (window.__OMNI_RELAY_CONTENT_INJECTED__) return;
  window.__OMNI_RELAY_CONTENT_INJECTED__ = true;

  const SETTINGS_KEY = 'omni_settings';

  function isValidContext() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  function detectSiteId() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('reddit.com')) return 'reddit';
    if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
    return null;
  }

  const siteId = detectSiteId();
  if (!siteId) return;

  function syncState(cfg) {
    if (!isValidContext()) return;
    const isGlobal = cfg?.enabled !== false;
    const isSiteDom = cfg?.sites?.[siteId]?.dom === true;

    if (siteId === 'reddit' && window.RedditExtractor) {
      if (isGlobal && isSiteDom) {
        window.RedditExtractor.start();
      } else {
        window.RedditExtractor.stop();
      }
    }
  }

  function init() {
    if (!isValidContext()) return;

    chrome.storage.local.get([SETTINGS_KEY], (res) => {
      if (chrome.runtime.lastError) return;
      syncState(res[SETTINGS_KEY]);
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (changes[SETTINGS_KEY] && isValidContext()) {
        syncState(changes[SETTINGS_KEY].newValue);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
