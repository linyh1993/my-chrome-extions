/**
 * @file 中继总编排器 (Relay Orchestrator)
 * 管理所有 Tab 的生命周期、CDP 调试器挂载状态机、设置同步响应以及来自 Popup 和 Content Script 的消息路由。
 */
const RelayOrchestrator = (() => {
  const attachedTabs = new Set();
  const attachingTabs = new Map();
  const tabContexts = new Map(); // tabId -> { site, endpointUrl, sourceUrl }
  const attachErrorByTab = new Map();
  const retryTimersByTab = new Map();
  const RETRY_DELAY_MS = 2500;

  function isSiteNetworkEnabled(cfg, siteId) {
    if (cfg.enabled === false) return false;
    const siteCfg = cfg.sites?.[siteId];
    return siteCfg?.enabled !== false && siteCfg?.networkMirror !== false;
  }

  async function resolveTabSite(tabId) {
    if (!tabId) return null;
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab?.url) {
          resolve(null);
          return;
        }
        const site = SitesRegistry.getSiteByUrl(tab.url);
        resolve(site ? { site, url: tab.url } : null);
      });
    });
  }

  async function ensureTabAttached(tabId) {
    if (!tabId || attachedTabs.has(tabId)) {
      return { ok: true, isAttached: attachedTabs.has(tabId) };
    }
    if (attachingTabs.has(tabId)) {
      return attachingTabs.get(tabId);
    }

    const task = (async () => {
      const cfg = await RelaySettings.loadSettings();
      if (!cfg.enabled) {
        return { ok: true, isAttached: false, reason: 'global_disabled' };
      }

      const siteInfo = await resolveTabSite(tabId);
      if (!siteInfo) {
        return { ok: false, isAttached: false, reason: 'unsupported_site' };
      }

      if (!isSiteNetworkEnabled(cfg, siteInfo.site.id)) {
        return { ok: true, isAttached: false, reason: 'site_network_disabled' };
      }

      return attachDebuggerToTab(tabId, cfg, siteInfo.site, siteInfo.url);
    })().finally(() => {
      attachingTabs.delete(tabId);
    });

    attachingTabs.set(tabId, task);
    return task;
  }

  async function attachDebuggerToTab(tabId, cfg, site, sourceUrl) {
    const ctx = {
      site,
      endpointUrl: cfg.endpointUrl,
      sourceUrl
    };
    tabContexts.set(tabId, ctx);
    console.log(`[OmniRelay] 尝试为 Tab ${tabId} 挂载调试器 (${site.label})...`);

    const attachRes = await DebuggerSession.attach(tabId);
    if (!attachRes.ok) {
      console.warn(`[OmniRelay] Tab ${tabId} 调试器挂载失败:`, attachRes.message || attachRes.error);
      tabContexts.delete(tabId);
      attachErrorByTab.set(tabId, { at: Date.now(), ...attachRes });
      if (attachRes.debuggerBusy) {
        scheduleRetry(tabId);
      }
      return attachRes;
    }

    const netRes = await DebuggerSession.enableNetwork(tabId);
    if (!netRes.ok) {
      console.warn(`[OmniRelay] Tab ${tabId} Network.enable 失败:`, netRes.error);
      detachDebuggerFromTab(tabId);
      return netRes;
    }

    // 二次确认页面状态
    const [latestCfg, currentSiteInfo] = await Promise.all([
      RelaySettings.loadSettings(),
      resolveTabSite(tabId)
    ]);

    if (!latestCfg.enabled || !isSiteNetworkEnabled(latestCfg, site.id) || currentSiteInfo?.site?.id !== site.id) {
      detachDebuggerFromTab(tabId);
      return { ok: true, isAttached: false };
    }

    ctx.endpointUrl = latestCfg.endpointUrl;
    ctx.sourceUrl = currentSiteInfo?.url || sourceUrl;
    attachedTabs.add(tabId);
    attachErrorByTab.delete(tabId);
    clearRetryTimer(tabId);
    console.log(`[OmniRelay] ✅ Tab ${tabId} 调试器挂载就绪 (${site.label})`);
    return { ok: true, isAttached: true, site };
  }

  function scheduleRetry(tabId) {
    if (retryTimersByTab.has(tabId)) return;
    const timer = setTimeout(() => {
      retryTimersByTab.delete(tabId);
      ensureTabAttached(tabId);
    }, RETRY_DELAY_MS);
    retryTimersByTab.set(tabId, timer);
  }

  function clearRetryTimer(tabId) {
    const timer = retryTimersByTab.get(tabId);
    if (timer) {
      clearTimeout(timer);
      retryTimersByTab.delete(tabId);
    }
  }

  function clearTabState(tabId) {
    attachedTabs.delete(tabId);
    attachingTabs.delete(tabId);
    tabContexts.delete(tabId);
    attachErrorByTab.delete(tabId);
    clearRetryTimer(tabId);
    NetworkTracker.clearTab(tabId);
    WebSocketTracker.clearTab(tabId);
  }

  function detachDebuggerFromTab(tabId) {
    if (!attachedTabs.has(tabId)) {
      clearTabState(tabId);
      return;
    }
    DebuggerSession.detach(tabId).then(() => clearTabState(tabId));
  }

  function scanAndRestoreTabs() {
    RelaySettings.loadSettings().then((cfg) => {
      if (!cfg.enabled) return;
      const patterns = SitesRegistry.getAllUrlPatterns();
      chrome.tabs.query({ url: patterns }, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) ensureTabAttached(tab.id);
        }
      });
    });
  }

  // 初始化监听器
  function initListeners() {
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId) {
        console.log(`[OmniRelay] Tab ${source.tabId} 调试器已分离`);
        clearTabState(source.tabId);
      }
    });

    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source.tabId;
      if (!attachedTabs.has(tabId)) return;

      const ctx = tabContexts.get(tabId);
      if (!ctx?.site) return;

      if (NetworkTracker.handleEvent(tabId, method, params, ctx)) return;
      WebSocketTracker.handleEvent(tabId, method, params, ctx);
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      if (attachedTabs.has(tabId)) {
        detachDebuggerFromTab(tabId);
      } else {
        clearTabState(tabId);
      }
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete' || !tab?.url) return;
      const site = SitesRegistry.getSiteByUrl(tab.url);
      if (!site) {
        detachDebuggerFromTab(tabId);
        return;
      }
      ensureTabAttached(tabId);
    });

    chrome.tabs.onActivated.addListener(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) ensureTabAttached(tabId);
      });
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (changes[RelaySettings.STORAGE_KEY]) {
        const nextCfg = RelaySettings.normalizeSettings(changes[RelaySettings.STORAGE_KEY].newValue);
        if (!nextCfg.enabled) {
          for (const tabId of [...attachedTabs]) {
            detachDebuggerFromTab(tabId);
          }
          return;
        }

        for (const [tabId, ctx] of tabContexts.entries()) {
          ctx.endpointUrl = nextCfg.endpointUrl;
          if (!isSiteNetworkEnabled(nextCfg, ctx.site.id)) {
            detachDebuggerFromTab(tabId);
          }
        }
        scanAndRestoreTabs();
      }
    });
  }

  /**
   * 消息分发路由器
   */
  function handleMessage(msg, sender, sendResponse) {
    if (!msg?.action) return false;

    switch (msg.action) {
      case 'GET_STATUS': {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          const activeTab = tabs[0];
          const cfg = await RelaySettings.loadSettings();
          const metrics = await RelaySettings.loadMetrics();
          const sites = SitesRegistry.getAllSites();

          let tabSite = null;
          let isAttached = false;
          let isAttaching = false;
          let attachError = null;

          if (activeTab?.id && activeTab.url) {
            tabSite = SitesRegistry.getSiteByUrl(activeTab.url);
            isAttached = attachedTabs.has(activeTab.id);
            isAttaching = attachingTabs.has(activeTab.id);
            attachError = attachErrorByTab.get(activeTab.id) || null;

            if (tabSite && cfg.enabled && isSiteNetworkEnabled(cfg, tabSite.id)) {
              ensureTabAttached(activeTab.id);
            }
          }

          sendResponse({
            ok: true,
            tabId: activeTab?.id || null,
            tabUrl: activeTab?.url || '',
            site: tabSite,
            isAttached,
            isAttaching,
            attachError,
            config: cfg,
            metrics,
            allSites: sites
          });
        });
        return true;
      }

      case 'SAVE_SETTINGS': {
        RelaySettings.saveSettings(msg.settings || {}).then((saved) => {
          sendResponse({ ok: true, config: saved });
        });
        return true;
      }

      case 'TEST_PING': {
        HttpRelay.pingEndpoint(msg.endpointUrl).then((result) => {
          sendResponse(result);
        });
        return true;
      }

      case 'RESET_METRICS': {
        RelaySettings.resetMetrics().then((metrics) => {
          sendResponse({ ok: true, metrics });
        });
        return true;
      }

      case 'DOM_DATA_EXTRACTED': {
        // 来自 Content Script 的结构化数据上报
        (async () => {
          const cfg = await RelaySettings.loadSettings();
          if (!cfg.enabled) {
            sendResponse({ ok: false, reason: 'global_disabled' });
            return;
          }

          const siteId = msg.siteId || 'reddit';
          const siteCfg = cfg.sites?.[siteId];
          if (siteCfg?.enabled === false || siteCfg?.domExtract === false) {
            sendResponse({ ok: false, reason: 'site_dom_disabled' });
            return;
          }

          const site = SitesRegistry.getSiteById(siteId);
          const envelope = RelayProtocol.createEnvelope({
            siteId: site?.id || siteId,
            siteLabel: site?.label || siteId,
            channel: RelayProtocol.CHANNELS.DOM_EXTRACTED,
            action: msg.extractType || 'batch_items',
            sourceUrl: sender.tab?.url || msg.sourceUrl || '',
            payload: msg.data,
            metadata: {
              tabId: sender.tab?.id || null,
              itemCount: Array.isArray(msg.data) ? msg.data.length : 1
            }
          });

          const deliveryResult = await HttpRelay.postEnvelope(cfg.endpointUrl, envelope);
          sendResponse(deliveryResult);
        })();
        return true;
      }

      default:
        return false;
    }
  }

  function start() {
    initListeners();
    scanAndRestoreTabs();
    console.log('[OmniRelay] Service worker orchestrator running.');
  }

  return {
    start,
    handleMessage,
    scanAndRestoreTabs
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RelayOrchestrator;
}
