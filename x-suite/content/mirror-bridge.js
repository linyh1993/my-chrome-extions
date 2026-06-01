/** @file 将流量镜像状态同步到统一页内面板（不单独挂载 UI） */
(function () {
  const hostname = window.location.hostname;
  if (typeof getSiteByHostname !== 'function' || !getSiteByHostname(hostname)) return;

  chrome.runtime.onMessage.addListener((request) => {
    if (request.domain !== 'mirror' || request.action !== 'UPDATE_STATUS') return;
    if (typeof XcfPanel === 'undefined') return;
    XcfPanel.updateMirror({
      status: request.status,
      enabled: request.mirrorEnabled,
      siteLabel: request.siteLabel
    });
  });

  function syncMirrorStatus() {
    chrome.runtime.sendMessage({ domain: 'mirror', action: 'ENSURE_TAB_MIRROR' });
    chrome.runtime.sendMessage({ domain: 'mirror', action: 'SYNC_STATUS' });
  }

  function start() {
    setTimeout(syncMirrorStatus, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
