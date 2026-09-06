/**
 * @file Chrome Debugger 会话封装 (CDP Session Layer)
 * 安全管理 chrome.debugger 的 attach、detach 与 CDP 命令发送，统一归一化占用与权限异常。
 */
const DebuggerSession = (() => {
  const DEBUGGER_PROTOCOL_VERSION = '1.3';

  function normalizeAttachError(message) {
    const text = String(message || 'attach_failed');
    if (/another debugger|already attached|debugger.*use|DevTools.*open/i.test(text)) {
      return {
        ok: false,
        isAttached: false,
        debuggerBusy: true,
        error: 'debugger_in_use',
        message: 'DevTools 或其他扩展已占用调试器，请先关闭被检查页面的 DevTools'
      };
    }
    return { ok: false, isAttached: false, error: text, message: text };
  }

  function attach(tabId) {
    return new Promise((resolve) => {
      chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION, () => {
        if (chrome.runtime.lastError) {
          resolve(normalizeAttachError(chrome.runtime.lastError.message));
          return;
        }
        resolve({ ok: true, isAttached: true });
      });
    });
  }

  function enableNetwork(tabId) {
    return new Promise((resolve) => {
      chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
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
            // Detach 失败通常是因为 tab 已关闭或已被自动释放，记录 warn 即可
            console.debug(`[Debugger Tab ${tabId}] detach ignored:`, chrome.runtime.lastError.message);
          }
          resolve({ ok: true });
        });
      });
    });
  }

  function getResponseBody(tabId, requestId) {
    return new Promise((resolve) => {
      chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true, body: response?.body || '', base64Encoded: !!response?.base64Encoded });
      });
    });
  }

  return {
    attach,
    enableNetwork,
    detach,
    getResponseBody
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DebuggerSession;
}
