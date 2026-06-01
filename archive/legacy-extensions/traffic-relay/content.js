// content.js
(function () {
  const hostname = window.location.hostname;
  const localSite = typeof getSiteByHostname === 'function' ? getSiteByHostname(hostname) : null;

  const root = document.createElement('div');
  root.id = 'traffic-copier-root';

  const peek = document.createElement('button');
  peek.type = 'button';
  peek.id = 'traffic-copier-peek';
  peek.className = 'copier-peek';
  peek.title = '显示流量镜像面板';
  peek.textContent = '镜像';

  const panel = document.createElement('div');
  panel.id = 'traffic-copier-panel';
  panel.className = 'copier-panel';

  const header = document.createElement('div');
  header.className = 'copier-panel-header';

  const siteBadge = document.createElement('span');
  siteBadge.className = 'copier-site-badge';
  siteBadge.textContent = localSite ? localSite.label : hostname;
  siteBadge.title = localSite ? `站点: ${localSite.id}` : '未配置站点';

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
  text.textContent = '流量镜像';

  const switchLabel = document.createElement('label');
  switchLabel.className = 'copier-switch';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';

  const slider = document.createElement('span');
  slider.className = 'copier-slider';

  const hint = document.createElement('div');
  hint.className = 'copier-hint';
  hint.textContent = '也可在扩展侧边栏中操作';

  headerActions.appendChild(btnMinimize);
  headerActions.appendChild(btnHide);
  header.appendChild(siteBadge);
  header.appendChild(headerActions);

  switchLabel.appendChild(checkbox);
  switchLabel.appendChild(slider);
  row.appendChild(text);
  row.appendChild(switchLabel);
  body.appendChild(statusText);
  body.appendChild(row);
  body.appendChild(hint);

  panel.appendChild(header);
  panel.appendChild(body);
  root.appendChild(peek);
  root.appendChild(panel);
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

  function persistUiMode(mode) {
    saveUiState({ mode }, () => applyUiMode(mode));
  }

  function setMirrorStatus(isAttached, siteLabel, siteId) {
    checkbox.checked = isAttached;
    statusText.textContent = isAttached ? '状态：监听中' : '状态：已关闭';
    statusText.classList.toggle('copier-status-on', isAttached);
    if (siteLabel) {
      siteBadge.textContent = siteLabel;
      siteBadge.title = siteId ? `站点: ${siteId}` : '';
    }
  }

  btnMinimize.addEventListener('click', () => {
    persistUiMode(uiMode === 'minimized' ? 'expanded' : 'minimized');
  });

  btnHide.addEventListener('click', () => persistUiMode('hidden'));

  peek.addEventListener('click', () => persistUiMode('expanded'));

  checkbox.addEventListener('change', () => {
    chrome.runtime.sendMessage({ command: 'TOGGLE_DEBUGGER' });
  });

  chrome.runtime.onMessage.addListener((request) => {
    if (request.command === 'UPDATE_STATUS') {
      setMirrorStatus(request.status, request.siteLabel, request.siteId);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[UI_STATE_KEY]) return;
    const next = changes[UI_STATE_KEY].newValue;
    if (next?.mode) applyUiMode(next.mode);
  });

  loadUiState((state) => {
    applyUiMode(state.mode || 'expanded');
    chrome.runtime.sendMessage({ command: 'INIT_AND_ATTACH' });
  });
})();
