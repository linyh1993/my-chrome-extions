const spHostname = document.getElementById('sp-hostname');
const spStatus = document.getElementById('sp-status');
const spMirror = document.getElementById('sp-mirror');
const spToggle = document.getElementById('sp-toggle');

function refreshTabStatus() {
  chrome.runtime.sendMessage({ command: 'GET_ACTIVE_TAB_STATUS' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      spHostname.textContent = '—';
      spStatus.textContent = '无法获取';
      spMirror.textContent = '—';
      spToggle.disabled = true;
      return;
    }

    spToggle.disabled = !res.tabId || !res.site;
    spMirror.textContent = res.config?.mirrorUrl || '—';

    if (!res.site) {
      spHostname.textContent = res.hostname || '未配置';
      spStatus.textContent = '—';
      spToggle.checked = false;
      return;
    }

    spHostname.textContent = `${res.site.label} (${res.hostname})`;
    spStatus.textContent = res.isAttached ? '监听中' : '已关闭';
    spStatus.classList.toggle('sp-status-on', res.isAttached);
    spToggle.checked = res.isAttached;
  });
}

spToggle.addEventListener('change', () => {
  chrome.runtime.sendMessage({ command: 'TOGGLE_DEBUGGER_ACTIVE_TAB' });
});

document.getElementById('sp-ui-expanded').addEventListener('click', () => {
  saveUiState({ mode: 'expanded' }, refreshTabStatus);
});
document.getElementById('sp-ui-minimized').addEventListener('click', () => {
  saveUiState({ mode: 'minimized' }, refreshTabStatus);
});
document.getElementById('sp-ui-hidden').addEventListener('click', () => {
  saveUiState({ mode: 'hidden' }, refreshTabStatus);
});

document.getElementById('sp-open-options').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((request) => {
  if (request.command === 'UPDATE_STATUS') refreshTabStatus();
});

refreshTabStatus();
