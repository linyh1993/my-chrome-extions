/**
 * @file Omni Relay 后台服务工作进程 (Service Worker Entry)
 * 原生 ES Module 模式，组织生命周期、状态机与消息派发。
 */

import { SITES, matchSiteByUrl, getAllSiteUrlPatterns } from '../core/sites.js';
import { getSettings, getMetrics, saveSettings, resetMetrics } from '../core/storage.js';
import { CdpEngine } from '../core/cdp-engine.js';
import { createEnvelope, sendEnvelope, ping } from '../core/relay-client.js';

const cdp = new CdpEngine();

async function isSiteNetworkEnabled(siteId) {
  const cfg = await getSettings();
  if (!cfg.enabled) return false;
  return cfg.sites?.[siteId]?.enabled !== false && cfg.sites?.[siteId]?.network !== false;
}

async function ensureTabAttached(tabId) {
  if (!tabId || cdp.isAttached(tabId)) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;

  const site = matchSiteByUrl(tab.url);
  if (!site) return;

  const enabled = await isSiteNetworkEnabled(site.id);
  if (!enabled) return;

  const cfg = await getSettings();
  await cdp.attach(tabId, site, cfg.endpointUrl, tab.url);
}

function scanAndSyncTabs() {
  getSettings().then((cfg) => {
    if (!cfg.enabled) return;
    chrome.tabs.query({ url: getAllSiteUrlPatterns() }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) ensureTabAttached(tab.id);
      }
    });
  });
}

// 1. 生命周期事件
chrome.runtime.onInstalled.addListener(() => {
  console.log('[OmniRelay] Service worker initialized.');
  scanAndSyncTabs();
});

chrome.runtime.onStartup.addListener(() => {
  scanAndSyncTabs();
});

// 2. CDP 调试器事件
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId) {
    cdp.handleEvent(source.tabId, method, params);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    cdp.detach(source.tabId);
  }
});

// 3. Tab 路由与激活监听
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab?.url) return;
  const site = matchSiteByUrl(tab.url);
  if (!site) {
    cdp.detach(tabId);
  } else {
    ensureTabAttached(tabId);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  ensureTabAttached(activeInfo.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cdp.detach(tabId);
});

// 4. 存储响应式变更
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.omni_settings) {
    const nextCfg = changes.omni_settings.newValue;
    if (!nextCfg?.enabled) {
      for (const tabId of [...cdp.attachedTabs]) {
        cdp.detach(tabId);
      }
    } else {
      cdp.updateTabConfig(nextCfg.endpointUrl);
      scanAndSyncTabs();
    }
  }
});

// 5. 消息路由 (Popup & Content Script 通信)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.action) return false;

  switch (msg.action) {
    case 'GET_STATUS': {
      (async () => {
        const [tabs, config, metrics] = await Promise.all([
          chrome.tabs.query({ active: true, currentWindow: true }),
          getSettings(),
          getMetrics()
        ]);

        const activeTab = tabs[0];
        let site = null;
        let isAttached = false;
        let isAttaching = false;
        let tabError = null;

        if (activeTab?.id && activeTab.url) {
          site = matchSiteByUrl(activeTab.url);
          isAttached = cdp.isAttached(activeTab.id);
          isAttaching = cdp.isAttaching(activeTab.id);
          tabError = cdp.getTabError(activeTab.id);

          if (site && config.enabled && config.sites?.[site.id]?.network) {
            ensureTabAttached(activeTab.id);
          }
        }

        sendResponse({
          ok: true,
          tabUrl: activeTab?.url || '',
          site,
          isAttached,
          isAttaching,
          tabError,
          config,
          metrics,
          sites: SITES
        });
      })();
      return true;
    }

    case 'SAVE_SETTINGS': {
      saveSettings(msg.settings).then((config) => sendResponse({ ok: true, config }));
      return true;
    }

    case 'RESET_METRICS': {
      resetMetrics().then((metrics) => sendResponse({ ok: true, metrics }));
      return true;
    }

    case 'PING_ENDPOINT': {
      ping(msg.endpointUrl).then(sendResponse);
      return true;
    }

    case 'DOM_EXTRACTED': {
      (async () => {
        const cfg = await getSettings();
        if (!cfg.enabled) {
          sendResponse({ ok: false, reason: 'global_disabled' });
          return;
        }

        const siteId = msg.siteId || 'reddit';
        if (cfg.sites?.[siteId]?.dom === false) {
          sendResponse({ ok: false, reason: 'site_dom_disabled' });
          return;
        }

        const envelope = createEnvelope({
          siteId,
          siteLabel: msg.siteLabel || siteId,
          channel: 'dom_extracted',
          action: msg.extractAction || 'batch_items',
          sourceUrl: sender.tab?.url || msg.sourceUrl || '',
          payload: msg.data
        });

        const res = await sendEnvelope(cfg.endpointUrl, envelope);
        sendResponse(res);
      })();
      return true;
    }

    default:
      return false;
  }
});
