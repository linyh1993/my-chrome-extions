/** @file Content 入口：初始化与设置同步 */
const XcfBootstrap = (() => {
  const S = () => XcfContent;

  function refreshPanel() {
    if (typeof XcfPanel === 'undefined') return;
    XcfPanel.update(S().settings || {}, XcfFold.getStats());
  }

  function applySettings(next) {
    if (next) {
      S().settings = next;
      window.__xcfSettings = next;
    }
    refreshPanel();
  }

  async function mergeSettingsFromStorage(raw) {
    await XcfSettings.ensureSpamKeywords();
    S().settings = XcfSettings.normalizeSettings(raw || {});
    window.__xcfSettings = S().settings;
  }

  function disableFiltering() {
    XcfScan.abortScrollCollect();
    XcfScan.clearTimers();
    S().pauseObserver = true;
    XcfScan.teardownCaptureObserver();
    XcfFold.resetPageState();
    S().overrideTweetIds.clear();
    S().loggedArchiveKeys.clear();
    S().loggedThreadRoots.clear();
    setTimeout(() => {
      S().pauseObserver = false;
      refreshPanel();
    }, 150);
  }

  async function init() {
    S().settings = await XcfSettings.load();
    window.__xcfSettings = S().settings;

    if (typeof XcfPanel !== 'undefined') {
      XcfPanel.mount({
        onEnabledChange: async (enabled) => {
          await XcfRuntime.persistSettings({ enabled });
          if (!enabled) disableFiltering();
          else if (XcfRoute.isPostThreadActive()) XcfScan.scheduleScan(true);
        },
        onPanelUiChange: (patch) => {
          const panelUi = { ...(S().settings.panelUi || {}), ...patch };
          XcfRuntime.persistSettings({ panelUi });
        }
      });
      refreshPanel();
    }

    XcfRoute.hookHistory(() => XcfRoute.onRouteChange());
    XcfScan.hookScroll();
    XcfScan.observeDom();
    window.__xcfRefoldAllNoise = () => XcfProcessor.refoldAllNoise();

    await XcfArchiveLog.hydrateKeys();
    if (S().settings.enabled !== false && XcfRoute.isPostThreadActive()) {
      XcfScan.scheduleScan(true);
      XcfScan.scheduleScrollCollectIfNeeded(1200);
    } else if (S().settings.enabled === false) {
      disableFiltering();
    }

    if (!XcfRuntime.isAlive()) return;

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!XcfRuntime.isAlive()) return;
        if (area !== 'sync' || !changes[XcfSettings.STORAGE_KEY]) return;
        if (S().storageEcho > 0) return;
        mergeSettingsFromStorage(changes[XcfSettings.STORAGE_KEY].newValue).then(() => {
          if (S().settings.enabled === false) disableFiltering();
          else if (XcfRoute.isPostThreadActive()) XcfScan.scheduleScan(false);
          refreshPanel();
        });
      });

      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!XcfRuntime.isAlive()) return false;
        if (msg.type === XCF.MSG.SETTINGS_CHANGED) {
          XcfSettings.load().then((s) => {
            applySettings(s);
            if (s.enabled === false) disableFiltering();
            else if (XcfRoute.isPostThreadActive()) XcfScan.scheduleScan(false);
            sendResponse({ ok: true });
          });
          return true;
        }
        if (msg.type === XCF.MSG.GET_PAGE_STATS) {
          sendResponse(XcfFold.getStats());
          return false;
        }
        return false;
      });
    } catch {
      XcfRuntime.teardown();
    }
  }

  return { refreshPanel, applySettings, init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => XcfBootstrap.init());
} else {
  XcfBootstrap.init();
}
