(function () {
  const hostname = window.location.hostname;

  const root = document.createElement('div');
  root.id = 'traffic-copier-root';

  const peek = document.createElement('button');
  peek.type = 'button';
  peek.className = 'copier-peek';
  peek.title = '显示流量复刻面板';
  peek.textContent = '复刻';

  const panel = document.createElement('div');
  panel.className = 'copier-panel';

  const header = document.createElement('div');
  header.className = 'copier-panel-header';

  const siteBadge = document.createElement('span');
  siteBadge.className = 'copier-site-badge';
  siteBadge.textContent = hostname || '—';

  const headerActions = document.createElement('div');
  headerActions.className = 'copier-header-actions';

  const btnMinimize = document.createElement('button');
  btnMinimize.type = 'button';
  btnMinimize.className = 'copier-icon-btn';
  btnMinimize.title = '收起为紧凑条';
  btnMinimize.textContent = '−';

  const btnHide = document.createElement('button');
  btnHide.type = 'button';
  btnHide.className = 'copier-icon-btn';
  btnHide.title = '完全隐藏（保留边缘标签）';
  btnHide.textContent = '×';

  const body = document.createElement('div');
  body.className = 'copier-panel-body';

  const statusText = document.createElement('div');
  statusText.className = 'copier-status-text';
  statusText.textContent = '状态：连接中…';

  const row = document.createElement('div');
  row.className = 'copier-toggle-row';

  const text = document.createElement('span');
  text.className = 'copier-text';
  text.textContent = '流量复刻';

  const switchLabel = document.createElement('label');
  switchLabel.className = 'copier-switch';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';

  const slider = document.createElement('span');
  slider.className = 'copier-slider';

  const hint = document.createElement('div');
  hint.className = 'copier-hint';
  hint.textContent = '也可在扩展侧边栏中操作';

  headerActions.append(btnMinimize, btnHide);
  header.append(siteBadge, headerActions);
  switchLabel.append(checkbox, slider);
  row.append(text, switchLabel);
  body.append(statusText, row, hint);
  panel.append(header, body);
  root.append(peek, panel);
  document.body.appendChild(root);

  let uiMode = 'expanded';

  function applyUiMode(mode) {
    uiMode = mode;
    root.dataset.mode = mode;
    peek.hidden = mode !== 'hidden';
    panel.hidden = mode === 'hidden';
    panel.classList.toggle('copier-panel--compact', mode === 'minimized');
    btnMinimize.title = mode === 'minimized' ? '展开面板' : '收起为紧凑条';
    btnMinimize.textContent = mode === 'minimized' ? '□' : '−';
  }

  function setMirrorStatus(isAttached, siteLabel) {
    checkbox.checked = isAttached;
    statusText.textContent = isAttached ? '状态：监听中' : '状态：已关闭';
    statusText.classList.toggle('copier-status-on', isAttached);
    if (siteLabel) siteBadge.textContent = siteLabel;
  }

  btnMinimize.addEventListener('click', () => {
    saveUiState({ mode: uiMode === 'minimized' ? 'expanded' : 'minimized' }, () => {
      applyUiMode(uiMode === 'minimized' ? 'expanded' : 'minimized');
    });
  });

  btnHide.addEventListener('click', () => {
    saveUiState({ mode: 'hidden' }, () => applyUiMode('hidden'));
  });

  peek.addEventListener('click', () => {
    saveUiState({ mode: 'expanded' }, () => applyUiMode('expanded'));
  });

  checkbox.addEventListener('change', () => {
    chrome.runtime.sendMessage({ command: 'TOGGLE_DEBUGGER' });
  });

  chrome.runtime.onMessage.addListener((request) => {
    if (request.command === 'UPDATE_STATUS') {
      setMirrorStatus(request.status, request.siteLabel || request.hostname);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[UI_STATE_KEY]?.newValue?.mode) {
      applyUiMode(changes[UI_STATE_KEY].newValue.mode);
    }
  });

  loadUiState((state) => {
    applyUiMode(state.mode || 'expanded');
    chrome.runtime.sendMessage({ command: 'INIT_AND_ATTACH' });
  });
})();
