const spSite = document.getElementById('sp-site');
const spStatus = document.getElementById('sp-status');
const spToggle = document.getElementById('sp-toggle');

function refreshTabStatus() {
  chrome.runtime.sendMessage({ command: 'GET_ACTIVE_TAB_STATUS' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      spSite.textContent = '—';
      spStatus.textContent = '无法获取';
      spToggle.disabled = true;
      return;
    }

    spToggle.disabled = !res.tabId;

    if (!res.site) {
      spSite.textContent = res.hostname || '未配置站点';
      spStatus.textContent = '—';
      spToggle.checked = false;
      return;
    }

    spSite.textContent = res.site.label;
    spStatus.textContent = res.isAttached ? '监听中' : '已关闭';
    spStatus.classList.toggle('sp-status-on', res.isAttached);
    spToggle.checked = res.isAttached;
  });
}

spToggle.addEventListener('change', () => {
  chrome.runtime.sendMessage({ command: 'TOGGLE_DEBUGGER_ACTIVE_TAB' });
});

function setPageUiMode(mode) {
  saveUiState({ mode }, refreshTabStatus);
}

document.getElementById('sp-ui-expanded').addEventListener('click', () => setPageUiMode('expanded'));
document.getElementById('sp-ui-minimized').addEventListener('click', () => setPageUiMode('minimized'));
document.getElementById('sp-ui-hidden').addEventListener('click', () => setPageUiMode('hidden'));

chrome.runtime.onMessage.addListener((request) => {
  if (request.command === 'UPDATE_STATUS') refreshTabStatus();
});

refreshTabStatus();
