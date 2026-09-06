/**
 * @file Omni Relay 弹窗控制器 (Popup Controller - ESM)
 */

const $ = (id) => document.getElementById(id);

function send(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...payload }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { ok: false });
      }
    });
  });
}

function setFooter(text, type = '') {
  const ftr = $('footerMsg');
  ftr.textContent = text || '就绪';
  ftr.className = type ? `ftr ${type}` : 'ftr';
}

function renderSites(sites, config) {
  const container = $('sitesList');
  container.innerHTML = '';

  sites.forEach((site) => {
    const siteCfg = config.sites?.[site.id] || { enabled: true, network: true, dom: false };

    const row = document.createElement('div');
    row.className = 'site-row';

    const top = document.createElement('div');
    top.className = 'site-top';
    top.innerHTML = `<span>${site.label}</span>
      <label class="opt-lbl">
        <input type="checkbox" data-site="${site.id}" data-field="enabled" ${siteCfg.enabled !== false ? 'checked' : ''} />
        启用
      </label>`;
    row.appendChild(top);

    const opts = document.createElement('div');
    opts.className = 'site-opts';

    if (site.network?.enabled) {
      opts.innerHTML += `<label class="opt-lbl">
        <input type="checkbox" data-site="${site.id}" data-field="network" ${siteCfg.network !== false ? 'checked' : ''} />
        CDP 流量镜像
      </label>`;
    }

    if (site.dom?.enabled) {
      opts.innerHTML += `<label class="opt-lbl">
        <input type="checkbox" data-site="${site.id}" data-field="dom" ${siteCfg.dom === true ? 'checked' : ''} />
        DOM 提取
      </label>`;
    }

    row.appendChild(opts);
    container.appendChild(row);
  });
}

function updateTabStatus(status) {
  const pill = $('tabStatusPill');
  const siteName = $('tabSiteName');
  const channels = $('tabChannels');

  if (!status.site) {
    pill.textContent = '未监听';
    pill.className = 'pill off';
    siteName.textContent = status.tabUrl ? new URL(status.tabUrl).hostname : '非目标网页';
    channels.textContent = '无';
    return;
  }

  siteName.textContent = status.site.label;
  const siteCfg = status.config?.sites?.[status.site.id];

  const activeChannels = [];
  if (siteCfg?.network !== false && status.site.network?.enabled) activeChannels.push('CDP 网络');
  if (siteCfg?.dom === true && status.site.dom?.enabled) activeChannels.push('DOM 提取');
  channels.textContent = activeChannels.length > 0 ? activeChannels.join(' + ') : '无活跃通道';

  if (!status.config?.enabled || siteCfg?.enabled === false) {
    pill.textContent = '已停用';
    pill.className = 'pill off';
  } else if (status.tabError?.debuggerBusy) {
    pill.textContent = '调试器被占用';
    pill.className = 'pill busy';
    setFooter('提示: DevTools 已开启，请先关闭 DevTools', 'err');
  } else if (status.isAttached) {
    pill.textContent = '监听中 (Active)';
    pill.className = 'pill active';
  } else if (status.isAttaching) {
    pill.textContent = '连接中...';
    pill.className = 'pill busy';
  } else {
    pill.textContent = '就绪 (DOM/Standby)';
    pill.className = 'pill';
  }
}

function updateMetrics(metrics) {
  $('mTotal').textContent = Number(metrics?.totalCount || 0).toLocaleString();
  $('mX').textContent = Number(metrics?.bySite?.x || 0).toLocaleString();
  $('mReddit').textContent = Number(metrics?.bySite?.reddit || 0).toLocaleString();
}

async function refresh() {
  const status = await send('GET_STATUS');
  if (!status.ok) {
    setFooter('后台 Service Worker 尚未就绪', 'err');
    return;
  }

  $('globalToggle').checked = status.config?.enabled !== false;
  $('endpointUrl').value = status.config?.endpointUrl || '';

  updateTabStatus(status);
  renderSites(status.sites || [], status.config || {});
  updateMetrics(status.metrics);
}

// 绑定操作
$('globalToggle').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  const status = await send('GET_STATUS');
  const cfg = status.config || {};
  cfg.enabled = enabled;
  await send('SAVE_SETTINGS', { settings: cfg });
  setFooter(enabled ? '系统已启动' : '系统已暂停', 'ok');
  refresh();
});

$('saveBtn').addEventListener('click', async () => {
  const endpointUrl = $('endpointUrl').value.trim();
  const status = await send('GET_STATUS');
  const cfg = status.config || { sites: {} };
  cfg.endpointUrl = endpointUrl;

  const checkboxes = $('sitesList').querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    const site = cb.dataset.site;
    const field = cb.dataset.field;
    if (!cfg.sites[site]) cfg.sites[site] = {};
    cfg.sites[site][field] = cb.checked;
  });

  await send('SAVE_SETTINGS', { settings: cfg });
  setFooter('配置已保存', 'ok');
  refresh();
});

$('pingBtn').addEventListener('click', async () => {
  const endpointUrl = $('endpointUrl').value.trim();
  const box = $('pingStatus');
  box.classList.remove('hidden', 'ok', 'err');
  box.textContent = '正在测试连接...';

  const res = await send('PING_ENDPOINT', { endpointUrl });
  if (res.ok) {
    box.classList.add('ok');
    box.textContent = `✅ ${res.message}`;
  } else {
    box.classList.add('err');
    box.textContent = `❌ ${res.message || '连接失败'}`;
  }
});

$('resetBtn').addEventListener('click', async () => {
  if (confirm('确认清零所有中继累计统计数据？')) {
    const res = await send('RESET_METRICS');
    if (res.ok) {
      updateMetrics(res.metrics);
      setFooter('统计已清零', 'ok');
    }
  }
});

document.addEventListener('DOMContentLoaded', refresh);
