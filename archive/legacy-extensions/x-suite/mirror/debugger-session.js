/** @file chrome.debugger 最小封装：attach、Network.enable、detach 与占用错误归一化。 */
const MirrorDebuggerSession = (() => {
  const debuggerVersion = '1.3';

  function attachErrorResult(message) {
    const text = String(message || 'attach_failed');
    if (/another debugger|already attached|debugger.*use/i.test(text)) {
      return {
        ok: false,
        isAttached: false,
        debuggerBusy: true,
        error: 'debugger_in_use',
        message: text
      };
    }
    return { ok: false, isAttached: false, error: text, message: text };
  }

  function attach(tabId) {
    return new Promise((resolve) => {
      chrome.debugger.attach({ tabId }, debuggerVersion, () => {
        if (chrome.runtime.lastError) {
          resolve(attachErrorResult(chrome.runtime.lastError.message));
          return;
        }
        resolve({ ok: true });
      });
    });
  }

  function enableNetwork(tabId) {
    return new Promise((resolve) => {
      chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            isAttached: false,
            error: chrome.runtime.lastError.message || 'network_enable_failed'
          });
          return;
        }
        resolve({ ok: true });
      });
    });
  }

  function detach(tabId) {
    return new Promise((resolve) => {
      chrome.debugger.sendCommand({ tabId }, 'Network.disable', {}, () => {
        chrome.debugger.detach({ tabId }, () => {
          if (chrome.runtime.lastError) {
            console.warn(`[mirror Tab ${tabId}] detach:`, chrome.runtime.lastError.message);
          }
          resolve();
        });
      });
    });
  }

  return { attach, enableNetwork, detach };
})();
