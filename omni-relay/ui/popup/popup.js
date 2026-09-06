/**
 * @file Omni Relay 弹窗控制台逻辑 (Popup Controller)
 */
const $ = (id) => document.getElementById(id);

let currentStatus = null;

function sendBgMessage(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false });
    });
  });
}

function setFooterMessage(text, tone = '') {
  const el = $('footerMsg');
  el.textContent = text || '就绪';
  el.className = tone ? `footer-msg is-${tone}` : 'footer-msg';
}

function renderSitesList(allSites, config) {
  const container = $('sitesList');
  container.innerHTML = '';

  allSites.forEach((site) => {
    const siteCfg = config.sites?.[site.id] || {
      enabled: true,
      networkMirror: site.network?.enabled || false,
      domExtract: site.dom?.enabled || false
    };

    const item = document.createElement('div');
    item.className = 'site-item';

    const header = document.createElement('div');
    header.className = 'site-header';

    const title = document.createElement('span');
    title.className = 'site-title';
    title.textContent = site.label;

    const siteToggleLabel = document.createElement('label');
    siteToggleLabel.className = 'site-opt-label';
    const siteToggle = document.createElement('input');
    siteToggle.type = 'checkbox';
    siteToggle.checked = siteCfg.enabled !== false;
    siteToggle.dataset.siteId = site.id;
    siteToggle.dataset.field = 'enabled';
    siteToggleLabel.appendChild(siteToggle);
    siteToggleLabel.appendChild(document.createTextNode('启用'));

    header.appendChild(title);
    header.appendChild(siteToggleLabel);
    item.appendChild(header);

    const options = document.createElement('div');
    options.className = 'site-options';

    if (site.network?.enabled) {
      const netLabel = document.createElement('label');
      netLabel.className = 'site-opt-label';
      const netCheck = document.createElement('input');
      netCheck.type = 'checkbox';
      netCheck.checked = siteCfg.networkMirror !== false;
      netCheck.dataset.siteId = site.id;
      netCheck.dataset.field = 'networkMirror';
      netLabel.appendChild(netCheck);
      netLabel.appendChild(document.createTextNode('CDP 流量镜像'));
      options.appendChild(netLabel);
    }

    if (site.dom?.enabled) {
      const domLabel = document.createElement('label');
      domLabel.className = 'site-opt-label';
      const domCheck = document.createElement('input');
      domCheck.type = 'checkbox';
      domCheck.checked = siteCfg.domExtract === true;
      domCheck.dataset.siteId = site.id;
      domCheck.dataset.field = 'domExtract';
      domLabel.appendChild(domCheck);
      domLabel.appendChild(document.createTextNode('DOM 语义提取'));
      options.appendChild(domLabel);
    }

    item.appendChild(options);
    container.appendChild(item);
  });
}

function updateTabCard(status) {
  const pill = $('tabStatusPill');
  const siteName = $('tabSiteName');
  const channels = $('tabChannels');

  if (!status?.site) {
    pill.textContent = '未监听';
    pill.className = 'status-pill disabled';
    siteName.textContent = status?.tabUrl ? new URL(status.tabUrl).hostname : '非目标网页';
    channels.textContent = '无';
    return;
  }

  siteName.textContent = status.site.label;

  const activeChannels = [];
  const siteCfg = status.config?.sites?.[status.site.id];
  if (siteCfg?.networkMirror !== false && status.site.network?.enabled) activeChannels.push('CDP 网络');
  if (siteCfg?.domExtract && status.site.dom?.enabled) activeChannels.push('DOM 提取');
  channels.textContent = activeChannels.length > 0 ? activeChannels.join(' + ') : '无活跃通道';

  if (!status.config?.enabled || siteCfg?.enabled === false) {
    pill.textContent = '已停用';
    pill.className = 'status-pill disabled';
  } else if (status.attachError?.debuggerBusy) {
    pill.textContent = '调试器被占用';
    pill.className = 'status-pill busy';
    setFooterMessage('提示: DevTools 已打开或被其他扩展占用', 'error');
  } else if (status.isAttached) {
    pill.textContent = '监听中 (Active)';
    pill.className = 'status-pill active';
  } else if (status.isAttaching) {
    pill.textContent = '连接中...';
    pill.className = 'status-pill busy';
  } else {
    pill.textContent = '就绪 (DOM/Standby)';
    pill.className = 'status-pill';
  }
}

function updateMetrics(metrics) {
  $('totalCountDisplay').textContent = Number(metrics?.totalRelayedCount || 0).toLocaleString();
  $('xCountDisplay').textContent = Number(metrics?.bySite?.x || 0).toLocaleString();
  $('redditCountDisplay').textContent = Number(metrics?.bySite?.reddit || 0).toLocaleString();
}

async function refresh() {
  const res = await sendBgMessage('GET_STATUS');
  if (!res?.ok) {
    setFooterMessage('Service Worker 未响应，请稍后或刷新', 'error');
    return;
  }

  currentStatus = res;
  $('globalSwitch').checked = res.config?.enabled !== false;
  $('endpointInput').value = res.config?.endpointUrl || '';

  updateTabCard(res);
  renderSitesList(res.allSites || [], res.config || {});
  updateMetrics(res.metrics);
}

// 事件绑定
$('globalSwitch').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  const cfg = await RelaySettings.loadSettings();
  cfg.enabled = enabled;
  await sendBgMessage('SAVE_SETTINGS', { settings: cfg });
  setFooterMessage(enabled ? '中继系统已启动' : '中继系统已暂停', 'success');
  refresh();
});

$('saveBtn').addEventListener('click', async () => {
  const endpointUrl = $('endpointInput').value.trim();
  const cfg = await RelaySettings.loadSettings();
  cfg.endpointUrl = endpointUrl;

  // 收集站点复选框
  const siteInputs = $('sitesList').querySelectorAll('input[type="checkbox"]');
  siteInputs.forEach((input) => {
    const siteId = input.dataset.siteId;
    const field = input.dataset.field;
    if (!cfg.sites[siteId]) cfg.sites[siteId] = {};
    cfg.sites[siteId][field] = input.checked;
  });

  const res = await sendBgMessage('SAVE_SETTINGS', { settings: cfg });
  if (res?.ok) {
    setFooterMessage('配置已保存并生效', 'success');
  } else {
    setFooterMessage('保存失败', 'error');
  }
  refresh();
});

$('pingBtn').addEventListener('click', async () => {
  const endpointUrl = $('endpointInput').value.trim();
  const feedback = $('pingFeedback');
  feedback.classList.remove('hidden', 'success', 'error');
  feedback.textContent = '正在测试连接...';

  const res = await sendBgMessage('TEST_PING', { endpointUrl });
  if (res?.ok) {
    feedback.classList.add('success');
    feedback.textContent = `✅ ${res.message}`;
  } else {
    feedback.classList.add('error');
    feedback.textContent = `❌ ${res.message || '连接失败'}`;
  }
});

$('resetMetricsBtn').addEventListener('click', async () => {
  if (confirm('确认清零所有中继累计统计数据？')) {
    const res = await sendBgMessage('RESET_METRICS');
    if (res?.ok) {
      updateMetrics(res.metrics);
      setFooterMessage('统计数据已重置', 'success');
    }
  }
});

document.addEventListener('DOMContentLoaded', refresh);
