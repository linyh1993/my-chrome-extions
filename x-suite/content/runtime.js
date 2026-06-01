/** @file 扩展运行时：消息、session、失效回收 */
const XcfRuntime = (() => {
  const S = () => XcfContent;

  function isAlive() {
    if (S().extensionDead) return false;
    try {
      if (!chrome.runtime?.id) {
        S().extensionDead = true;
        return false;
      }
      return true;
    } catch {
      S().extensionDead = true;
      teardown();
      return false;
    }
  }

  function teardown() {
    if (S().contextTornDown) return;
    S().contextTornDown = true;
    S().extensionDead = true;
    S().pauseObserver = true;
    if (typeof XcfScan !== 'undefined') XcfScan.abortScrollCollect();
    S().domObserver?.disconnect();
    S().domObserver = null;
    clearTimeout(S().scanTimer);
    clearTimeout(S().scrollTimer);
    clearTimeout(S().scrollCaptureTimer);
    clearTimeout(S().afterScrollScanTimer);
    S().scanTimer = null;
    S().scrollTimer = null;
    S().scrollCaptureTimer = null;
    S().afterScrollScanTimer = null;
    if (typeof XcfScan !== 'undefined') {
      XcfScan.teardownCaptureObserver();
    }
  }

  function sendMessage(msg) {
    if (!isAlive()) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            if (/invalidated|context/i.test(String(chrome.runtime.lastError.message || ''))) {
              teardown();
            }
            resolve(null);
          } else {
            resolve(res);
          }
        });
      } catch {
        teardown();
        resolve(null);
      }
    });
  }

  function safeSessionSet(items) {
    if (!isAlive()) return;
    try {
      chrome.storage.session.set(items, () => {
        void chrome.runtime?.lastError;
      });
    } catch {
      teardown();
    }
  }

  async function persistSettings(partial) {
    S().storageEcho += 1;
    try {
      const next = await sendMessage({ type: XCF.MSG.SAVE_SETTINGS, partial });
      if (next) {
        S().settings = next;
        window.__xcfSettings = next;
      }
      XcfBootstrap.refreshPanel();
      return next;
    } finally {
      setTimeout(() => {
        S().storageEcho = Math.max(0, S().storageEcho - 1);
      }, 200);
    }
  }

  async function withStorageEcho(fn) {
    S().storageEcho += 1;
    try {
      return await fn();
    } finally {
      setTimeout(() => {
        S().storageEcho = Math.max(0, S().storageEcho - 1);
      }, 200);
    }
  }

  function withPausedObserver(fn) {
    S().pauseObserver = true;
    return Promise.resolve(fn()).finally(() => {
      setTimeout(() => {
        S().pauseObserver = false;
      }, 150);
    });
  }

  return {
    isAlive,
    teardown,
    sendMessage,
    safeSessionSet,
    persistSettings,
    withStorageEcho,
    withPausedObserver
  };
})();
