const spSite = document.getElementById('sp-site');
const spStatus = document.getElementById('sp-status');
const spToggle = document.getElementById('sp-toggle');

function mirrorMsg(action, payload = {}) {
  return { domain: 'mirror', action, ...payload };
}

function sendFilter(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

function refreshTabStatus() {
  chrome.runtime.sendMessage(mirrorMsg('GET_ACTIVE_TAB_STATUS'), (res) => {
    if (chrome.runtime.lastError || !res) {
      spSite.textContent = '—';
      spStatus.textContent = '无法获取';
      spToggle.disabled = true;
      return;
    }

    spToggle.disabled = !res.tabId;

    if (!res.site) {
      spSite.textContent = res.hostname || '非 X 页面';
      spStatus.textContent = '—';
      spToggle.checked = false;
      return;
    }

    spSite.textContent = res.site.label;
    if (!res.hasDebuggerPermission) {
      spStatus.textContent = '需授权 debugger';
      spStatus.classList.remove('sp-status-on');
      spToggle.checked = false;
      return;
    }
    spStatus.textContent = res.isAttached ? '监听中' : '已关闭';
    spStatus.classList.toggle('sp-status-on', res.isAttached);
    spToggle.checked = res.isAttached;
  });
}

spToggle.addEventListener('change', () => {
  chrome.runtime.sendMessage(
    mirrorMsg('SET_MIRROR_ENABLED_ACTIVE_TAB', { enabled: spToggle.checked }),
    (res) => {
      if (chrome.runtime.lastError || res?.ok === false || res?.permissionDenied) {
        refreshTabStatus();
      }
    }
  );
});

async function setPageUiMode(mode) {
  await sendFilter(XCF.MSG.SAVE_SETTINGS, {
    partial: { panelUi: XCF.panelUiFromDisplayMode(mode) }
  });
  refreshTabStatus();
}

document.getElementById('sp-ui-expanded').addEventListener('click', () => setPageUiMode('expanded'));
document.getElementById('sp-ui-minimized').addEventListener('click', () => setPageUiMode('minimized'));
document.getElementById('sp-ui-hidden').addEventListener('click', () => setPageUiMode('hidden'));

chrome.runtime.onMessage.addListener((request) => {
  if (request.domain === 'mirror' && request.action === 'UPDATE_STATUS') {
    refreshTabStatus();
  }
});

MirrorSettings.load().then((cfg) => {
  const el = document.getElementById('sp_mirror_url_hint');
  if (el) {
    el.textContent = `默认不自动开启。接收地址：${cfg.mirrorUrl}（可在选项页修改）`;
  }
});

document.getElementById('sp_open_options_mirror')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.session.set({ [XCF.SESSION.OPTIONS_MAIN]: 'mirror' }, () => {
    chrome.runtime.openOptionsPage();
  });
});

refreshTabStatus();
