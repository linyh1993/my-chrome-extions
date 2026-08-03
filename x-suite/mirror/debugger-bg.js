/** @file Mirror orchestration for tab lifecycle and CDP Network events. */
const MirrorBg = (() => {
  // Tab-level runtime state. Service worker may restart, so every map is cache only.
  const attachedTabs = new Set();
  const attachingTabs = new Map();
  const tabMirrorCtx = new Map();
  const attachErrorByTab = new Map();
  const retryTimersByTab = new Map();
  const debuggerRetryMs = 2000;

  function isMirrorEnabled(cfg) {
    return cfg?.enabled !== false;
  }

  function createMirrorCtx(site, cfg) {
    return {
      site,
      mirrorUrl: cfg?.mirrorUrl || MirrorSettings.DEFAULTS.mirrorUrl
    };
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

  async function ensureTabMirror(tabId) {
    if (!tabId || attachedTabs.has(tabId)) {
      return { ok: true, isAttached: attachedTabs.has(tabId) };
    }
    if (attachingTabs.has(tabId)) return attachingTabs.get(tabId);

    // One attach attempt per tab. Concurrent callers share the same Promise.
    const attachTask = (async () => {
      const cfg = await MirrorSettings.load();
      if (!isMirrorEnabled(cfg)) return { ok: true, isAttached: false, mirrorEnabled: false };

      const site = await resolveSiteForTab(tabId);
      if (!site) return { ok: false, isAttached: false, error: 'unsupported_site' };

      return attachDebugger(tabId, cfg, site);
    })().finally(() => {
      attachingTabs.delete(tabId);
    });

    attachingTabs.set(tabId, attachTask);
    return attachTask;
  }

  function restoreEnabledMirrors() {
    // Reconcile after startup/config changes; already-attached tabs are skipped by ensureTabMirror.
    MirrorSettings.load().then((cfg) => {
      if (!isMirrorEnabled(cfg)) return;
      chrome.tabs.query({ url: getSiteUrlPatterns() }, (tabs) => {
        for (const tab of tabs) if (tab.id) ensureTabMirror(tab.id);
      });
    });
  }

  async function enableMirrorOnTab(tabId, sendResponse) {
    const granted = await ensureDebuggerPermission();
    if (!granted) {
      sendResponse?.({ ok: false, isAttached: false, permissionDenied: true });
      return;
    }

    sendResponse?.({ ...(await ensureTabMirror(tabId)), mirrorEnabled: true });
  }

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

  function resolveSiteForTab(tabId) {
    return new Promise((resolve) => {
      if (!tabId) {
        resolve(null);
        return;
      }
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab?.url) {
          resolve(null);
          return;
        }
        resolve(getSiteByUrl(tab.url));
      });
    });
  }

  function buildTabStatus(tabId, cfg, site = null) {
    return {
      tabId,
      attachError: attachErrorByTab.get(tabId) || null,
      delivery: MirrorHttpRelay.getDelivery(tabId),
      isAttached: attachedTabs.has(tabId),
      isAttaching: attachingTabs.has(tabId),
      mirrorEnabled: isMirrorEnabled(cfg),
      site: tabMirrorCtx.get(tabId)?.site || site,
      siteLabel: site?.label ?? null
    };
  }

  function rememberAttachError(tabId, result) {
    attachErrorByTab.set(tabId, { at: Date.now(), ...result });
  }

  function scheduleBusyRetry(tabId) {
    if (retryTimersByTab.has(tabId)) return;
    const timer = setTimeout(() => {
      retryTimersByTab.delete(tabId);
      ensureTabMirror(tabId);
    }, debuggerRetryMs);
    retryTimersByTab.set(tabId, timer);
  }

  async function attachDebugger(tabId, cfg, site) {
    const ctx = createMirrorCtx(site, cfg);
    tabMirrorCtx.set(tabId, ctx);
    console.log(`[mirror Tab ${tabId}] attach debugger (${site.label})...`);

    const attachResult = await MirrorDebuggerSession.attach(tabId);
    if (!attachResult.ok) {
      console.error(`[mirror Tab ${tabId}] attach failed:`, attachResult.message || attachResult.error);
      tabMirrorCtx.delete(tabId);
      rememberAttachError(tabId, attachResult);
      if (attachResult.debuggerBusy) scheduleBusyRetry(tabId);
      return attachResult;
    }

    const networkResult = await MirrorDebuggerSession.enableNetwork(tabId);
    if (!networkResult.ok) {
      console.error(`[mirror Tab ${tabId}] Network.enable failed:`, networkResult.error);
      detachDebugger(tabId);
      return networkResult;
    }

    // Attach completion is async; verify config and URL again before marking active.
    const [nextCfg, currentSite] = await Promise.all([MirrorSettings.load(), resolveSiteForTab(tabId)]);
    if (!isMirrorEnabled(nextCfg) || currentSite?.id !== site.id) {
      detachDebugger(tabId);
      return { ok: true, isAttached: false, mirrorEnabled: isMirrorEnabled(nextCfg) };
    }

    ctx.mirrorUrl = nextCfg.mirrorUrl || ctx.mirrorUrl;
    attachedTabs.add(tabId);
    attachErrorByTab.delete(tabId);
    clearBusyRetry(tabId);
    return { ok: true, isAttached: true, site };
  }

  function clearBusyRetry(tabId) {
    const timer = retryTimersByTab.get(tabId);
    if (!timer) return;
    clearTimeout(timer);
    retryTimersByTab.delete(tabId);
  }

  function clearTabState(tabId) {
    // Detach, close, and navigation cleanup all converge here.
    attachedTabs.delete(tabId);
    attachingTabs.delete(tabId);
    tabMirrorCtx.delete(tabId);
    attachErrorByTab.delete(tabId);
    clearBusyRetry(tabId);
    MirrorHttpRelay.clearTab(tabId);
    MirrorHttpTracker.clearTab(tabId);
    MirrorWebSocketRelay.clearTab(tabId);
  }

  function detachDebugger(tabId) {
    if (!attachedTabs.has(tabId)) {
      clearTabState(tabId);
      return;
    }
    MirrorDebuggerSession.detach(tabId).then(() => clearTabState(tabId));
  }

  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) clearTabState(source.tabId);
  });

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (!attachedTabs.has(tabId)) return;

    const ctx = tabMirrorCtx.get(tabId);
    if (!ctx?.site) return;
    if (MirrorHttpTracker.handleEvent(tabId, method, params, ctx)) return;
    MirrorWebSocketRelay.handleEvent(tabId, method, params, ctx);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabs.has(tabId)) detachDebugger(tabId);
    else clearTabState(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab?.url) return;
    // Navigating away from X should release the debugger attachment and cached traffic.
    if (!getSiteByUrl(tab.url)) {
      detachDebugger(tabId);
      return;
    }
    ensureTabMirror(tabId);
  });

  chrome.tabs.onActivated.addListener(() => {
    chrome.tabs.query({ active: true, currentWindow: true, url: getSiteUrlPatterns() }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) ensureTabMirror(tabId);
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[MirrorSettings.STORAGE_KEY]) return;
    const nextCfg = MirrorSettings.normalize(changes[MirrorSettings.STORAGE_KEY].newValue);
    // Mirror enabled is global; turning it off stops every active tab.
    if (!isMirrorEnabled(nextCfg)) {
      for (const tabId of [...attachedTabs]) detachDebugger(tabId);
      return;
    }

    for (const ctx of tabMirrorCtx.values()) {
      ctx.mirrorUrl = nextCfg.mirrorUrl;
    }
    MirrorHttpTracker.updateMirrorUrl(nextCfg.mirrorUrl);
    MirrorWebSocketRelay.updateMirrorUrl(nextCfg.mirrorUrl);
    restoreEnabledMirrors();
  });

  function handleMessage(msg, sender, sendResponse) {
    switch (msg.action) {
      case 'GET_ACTIVE_TAB_STATUS':
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (!activeTab?.id) {
            sendResponse({ tabId: null, isAttached: false, site: null });
            return;
          }
          const site = getSiteByUrl(activeTab.url || '');
          const hostname = safeHostname(activeTab.url);
          Promise.all([hasDebuggerPermission(), MirrorSettings.load()]).then(([hasDebugger, cfg]) => {
            // Opening the popup doubles as a lightweight recovery path after worker wakeup.
            if (site && isMirrorEnabled(cfg)) ensureTabMirror(activeTab.id);
            sendResponse({
              ...buildTabStatus(activeTab.id, cfg, site),
              hostname,
              hasDebuggerPermission: hasDebugger
            });
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
            enableMirrorOnTab(activeTabId, sendResponse);
          });
        });
        return true;

      default:
        return false;
    }
  }

  function safeHostname(url) {
    try {
      return new URL(url || '').hostname;
    } catch {
      return '';
    }
  }

  function initOnInstalled() {
    console.log('[mirror] loaded sites:', SITES.map((site) => site.id).join(', '));
    restoreEnabledMirrors();
  }

  return { handleMessage, initOnInstalled, restoreEnabledMirrors };
})();
