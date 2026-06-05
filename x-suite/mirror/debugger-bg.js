/** @file 流量镜像：debugger 与 Network 转发（service worker 侧） */
const MirrorBg = (() => {
  const attachedTabs = new Set();
  const tabSiteConfig = new Map();
  const debuggerVersion = '1.3';
  const trackedRequests = new Map();

  function hasDebuggerPermission() {
    return new Promise((resolve) => {
      if (!chrome.permissions?.contains) {
        resolve(true);
        return;
      }
      chrome.permissions.contains({ permissions: ['debugger'] }, resolve);
    });
  }

  function requestDebuggerPermission() {
    return new Promise((resolve) => {
      if (!chrome.permissions?.request) {
        resolve(false);
        return;
      }
      chrome.permissions.request({ permissions: ['debugger'] }, (granted) => {
        resolve(Boolean(granted) && !chrome.runtime.lastError);
      });
    });
  }

  async function ensureDebuggerPermission() {
    if (await hasDebuggerPermission()) return true;
    return requestDebuggerPermission();
  }

  function isMirrorEnabled(cfg) {
    return cfg?.enabled !== false;
  }

  function getSiteUrlPatterns() {
    const patterns = new Set();
    for (const site of SITES) {
      for (const pattern of site.urlPatterns || []) patterns.add(pattern);
    }
    return [...patterns];
  }

  function persistMirrorEnabled(enabled) {
    return MirrorSettings.save({ enabled: Boolean(enabled) });
  }

  function ensureTabMirror(tabId) {
    if (!tabId || attachedTabs.has(tabId)) return;
    MirrorSettings.load().then((cfg) => {
      if (!isMirrorEnabled(cfg)) return;
      resolveSiteForTab(tabId, (site) => {
        if (site) enableMirrorOnTab(tabId);
      });
    });
  }

  function restoreEnabledMirrors() {
    MirrorSettings.load().then((cfg) => {
      if (!isMirrorEnabled(cfg)) return;
      chrome.tabs.query(
        {
          url: [
            '*://x.com/*',
            '*://*.x.com/*',
            '*://twitter.com/*',
            '*://*.twitter.com/*'
          ]
        },
        (tabs) => {
          for (const tab of tabs) {
            if (tab.id) ensureTabMirror(tab.id);
          }
        }
      );
    });
  }

  function tabMirrorState(tabId, sendResponse) {
    MirrorSettings.load().then((cfg) => {
      const mirrorEnabled = isMirrorEnabled(cfg);
      if (!tabId) {
        sendResponse?.({ mirrorEnabled, isAttached: false, siteLabel: null });
        return;
      }
      resolveSiteForTab(tabId, (site) => {
        sendResponse?.({
          mirrorEnabled,
          isAttached: attachedTabs.has(tabId),
          siteLabel: site?.label ?? null
        });
      });
    });
  }

  function enableMirrorOnTab(tabId, sendResponse) {
    ensureDebuggerPermission().then((granted) => {
      if (!granted) {
        updatePageStatus(tabId, false);
        sendResponse?.({
          ok: false,
          isAttached: false,
          permissionDenied: true
        });
        return;
      }
      if (!attachedTabs.has(tabId)) attachDebugger(tabId);
      else updatePageStatus(tabId, true, tabSiteConfig.get(tabId));
      sendResponse?.({
        ok: true,
        isAttached: attachedTabs.has(tabId) || granted
      });
    });
  }

  function resolveSiteForTab(tabId, callback) {
    if (!tabId) {
      callback(null);
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      if (!tab?.url) {
        callback(null);
        return;
      }
      callback(getSiteByUrl(tab.url));
    });
  }

  function updatePageStatus(tabId, isAttached, site = null) {
    MirrorSettings.load().then((cfg) => {
      const payload = {
        domain: 'mirror',
        action: 'UPDATE_STATUS',
        status: isAttached,
        mirrorEnabled: isMirrorEnabled(cfg),
        siteLabel: site?.label ?? null,
        siteId: site?.id ?? null
      };

      chrome.tabs.sendMessage(tabId, payload, () => {
        if (chrome.runtime.lastError) {
          /* content 未就绪 */
        }
      });

      chrome.runtime.sendMessage(payload).catch(() => {
        /* side panel 未打开 */
      });
    });
  }

  function attachDebugger(tabId) {
    resolveSiteForTab(tabId, (site) => {
      if (!site) {
        updatePageStatus(tabId, false);
        return;
      }

      tabSiteConfig.set(tabId, site);
      console.log(`[mirror Tab ${tabId}] 附加调试器 (${site.label})…`);

      chrome.debugger.attach({ tabId }, debuggerVersion, () => {
        if (chrome.runtime.lastError) {
          console.error(
            `[mirror Tab ${tabId}] attach 失败:`,
            chrome.runtime.lastError.message
          );
          tabSiteConfig.delete(tabId);
          updatePageStatus(tabId, false);
          return;
        }
        chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
          if (chrome.runtime.lastError) {
            console.error(
              `[mirror Tab ${tabId}] Network.enable 失败:`,
              chrome.runtime.lastError.message
            );
            detachDebugger(tabId);
          } else {
            attachedTabs.add(tabId);
            updatePageStatus(tabId, true, site);
          }
        });
      });
    });
  }

  function clearTabState(tabId) {
    attachedTabs.delete(tabId);
    tabSiteConfig.delete(tabId);
    for (const [requestId, data] of trackedRequests.entries()) {
      if (data.tabId === tabId) trackedRequests.delete(requestId);
    }
  }

  function detachDebugger(tabId) {
    if (!attachedTabs.has(tabId)) {
      clearTabState(tabId);
      updatePageStatus(tabId, false);
      return;
    }

    const finish = () => {
      clearTabState(tabId);
      updatePageStatus(tabId, false);
    };

    chrome.debugger.sendCommand({ tabId }, 'Network.disable', {}, () => {
      chrome.debugger.detach({ tabId }, () => {
        if (chrome.runtime.lastError) {
          console.warn(
            `[mirror Tab ${tabId}] detach:`,
            chrome.runtime.lastError.message
          );
        }
        finish();
      });
    });
  }

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source.tabId;
    if (!tabId) return;
    clearTabState(tabId);
    updatePageStatus(tabId, false);
  });

  async function forwardFullTraffic(trafficData) {
    const payload = {
      siteId: trafficData.siteId,
      request: trafficData.request,
      response: trafficData.response,
      responseBody: trafficData.responseBody
    };

    let mirrorUrl = trafficData.mirrorUrl;
    if (typeof MirrorSettings !== 'undefined') {
      try {
        const cfg = await MirrorSettings.load();
        mirrorUrl = cfg.mirrorUrl || mirrorUrl;
      } catch {
        /* 使用请求缓存 URL */
      }
    }

    try {
      const response = await fetch(mirrorUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error(
          `[mirror Tab ${trafficData.tabId}] 本地接口:`,
          response.status,
          response.statusText
        );
      }
    } catch (error) {
      console.error(
        `[mirror Tab ${trafficData.tabId}] 本地请求失败:`,
        error.message
      );
    }
  }

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (!attachedTabs.has(tabId)) return;

    const site = tabSiteConfig.get(tabId);
    if (!site) return;

    switch (method) {
      case 'Network.requestWillBeSent': {
        const { requestId, request } = params;
        if (!shouldTrackRequest(request.url, site)) break;
      trackedRequests.set(requestId, {
        tabId,
        siteId: site.id,
        jsonResponsesOnly: !!site.jsonResponsesOnly,
          request,
          response: null,
          responseBody: null
        });
        break;
      }

      case 'Network.responseReceived': {
        const { requestId, response } = params;
        const trackedData = trackedRequests.get(requestId);
        if (!trackedData) break;
        if (trackedData.jsonResponsesOnly && !isJsonResponse(response)) {
          trackedRequests.delete(requestId);
          break;
        }
        trackedData.response = response;
        break;
      }

      case 'Network.loadingFinished': {
        const { requestId } = params;
        if (!trackedRequests.has(requestId)) break;

        chrome.debugger.sendCommand(
          { tabId },
          'Network.getResponseBody',
          { requestId },
          (bodyInfo) => {
            if (chrome.runtime.lastError) {
              trackedRequests.delete(requestId);
              return;
            }
            const trackedData = trackedRequests.get(requestId);
            if (!trackedData) return;
            if (trackedData.request && trackedData.response) {
              trackedData.responseBody = bodyInfo.body;
              forwardFullTraffic(trackedData);
            }
            trackedRequests.delete(requestId);
          }
        );
        break;
      }
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabs.has(tabId)) detachDebugger(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab?.url) return;
    if (!getSiteByUrl(tab.url)) return;
    ensureTabMirror(tabId);
  });

  chrome.tabs.onActivated.addListener(() => {
    chrome.tabs.query(
      { active: true, currentWindow: true, url: getSiteUrlPatterns() },
      (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) ensureTabMirror(tabId);
      }
    );
  });

  function handleMessage(msg, sender, sendResponse) {
    const tabId = sender.tab?.id;

    switch (msg.action) {
      case 'HAS_DEBUGGER_PERMISSION':
        hasDebuggerPermission().then((granted) => {
          sendResponse({ granted });
        });
        return true;

      case 'GET_ACTIVE_TAB_STATUS':
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (!activeTab?.id) {
            sendResponse({ tabId: null, isAttached: false, site: null });
            return;
          }
          const site = getSiteByUrl(activeTab.url || '');
          let hostname = '';
          try {
            hostname = new URL(activeTab.url || '').hostname;
          } catch {
            /* ignore */
          }
          Promise.all([hasDebuggerPermission(), MirrorSettings.load()]).then(
            ([hasDebugger, cfg]) => {
              sendResponse({
                tabId: activeTab.id,
                hostname,
                isAttached: attachedTabs.has(activeTab.id),
                mirrorEnabled: isMirrorEnabled(cfg),
                site: tabSiteConfig.get(activeTab.id) || site,
                hasDebuggerPermission: hasDebugger
              });
            }
          );
        });
        return true;

      case 'GET_TAB_MIRROR_STATE':
        tabMirrorState(tabId, sendResponse);
        return true;

      case 'ENSURE_TAB_MIRROR':
        if (tabId) ensureTabMirror(tabId);
        tabMirrorState(tabId, sendResponse);
        return true;

      case 'SET_MIRROR_ENABLED':
        if (!tabId) {
          sendResponse({ ok: false, isAttached: false });
          return true;
        }
        persistMirrorEnabled(msg.enabled).then(() => {
          if (!msg.enabled) {
            detachDebugger(tabId);
            sendResponse({ ok: true, isAttached: false, mirrorEnabled: false });
            return;
          }
          enableMirrorOnTab(tabId, (res) => {
            sendResponse?.({ ...res, mirrorEnabled: true });
          });
        });
        return true;

      case 'SET_MIRROR_ENABLED_ACTIVE_TAB':
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTabId = tabs[0]?.id;
          if (!activeTabId) {
            sendResponse({ ok: false, isAttached: false });
            return;
          }
          persistMirrorEnabled(msg.enabled).then(() => {
            if (!msg.enabled) {
              detachDebugger(activeTabId);
              sendResponse({ ok: true, isAttached: false, mirrorEnabled: false });
              return;
            }
            enableMirrorOnTab(activeTabId, (res) => {
              sendResponse?.({ ...res, mirrorEnabled: true });
            });
          });
        });
        return true;

      case 'TOGGLE_DEBUGGER_ACTIVE_TAB':
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTabId = tabs[0]?.id;
          if (!activeTabId) return;
          if (attachedTabs.has(activeTabId)) {
            detachDebugger(activeTabId);
          } else {
            enableMirrorOnTab(activeTabId);
          }
        });
        return true;

      case 'GET_STATUS':
        sendResponse({ isAttached: tabId ? attachedTabs.has(tabId) : false });
        return true;

      case 'SYNC_STATUS':
        if (tabId) {
          MirrorSettings.load().then((cfg) => {
            if (isMirrorEnabled(cfg)) ensureTabMirror(tabId);
            updatePageStatus(
              tabId,
              attachedTabs.has(tabId),
              tabSiteConfig.get(tabId)
            );
          });
        }
        return true;

      case 'TOGGLE_DEBUGGER':
        if (!tabId) return true;
        if (attachedTabs.has(tabId)) detachDebugger(tabId);
        else enableMirrorOnTab(tabId);
        return true;

      default:
        return false;
    }
  }

  function initOnInstalled() {
    console.log('[mirror] 已加载站点:', SITES.map((s) => s.id).join(', '));
    restoreEnabledMirrors();
  }

  return { handleMessage, initOnInstalled, restoreEnabledMirrors };
})();
