/**
 * Popup script for Google SERP & SEO Extractor
 */

let currentData = null;
let activeTabId = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initPopup();
});

async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    showError('无法获取当前标签页');
    return;
  }
  activeTabId = tab.id;

  if (!tab.url || (!tab.url.includes('google.com') && !tab.url.includes('google.'))) {
    showError('请在 Google 搜索结果页面使用此插件');
    return;
  }

  // Fetch SERP data from content script
  await fetchData();

  // Bind buttons
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await fetchData(true);
    showToast('已刷新并提取最新数据');
  });

  document.getElementById('btn-copy-tsv').addEventListener('click', async () => {
    if (!currentData || !currentData.items || currentData.items.length === 0) {
      showToast('暂无可复制的数据');
      return;
    }
    const tsv = globalThis.GseExporter.itemsToTsv(currentData.items);
    try {
      await globalThis.GseExporter.copyTextToClipboard(tsv);
      showToast(`✅ 已复制 ${currentData.items.length} 条表格数据！`);
    } catch (e) {
      showToast('❌ 复制失败: ' + e.message);
    }
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    if (!currentData || !currentData.items || currentData.items.length === 0) {
      showToast('暂无可导出的数据');
      return;
    }
    const csv = globalThis.GseExporter.itemsToCsv(currentData.items);
    const q = (currentData.query || 'google_serp').replace(/[^\w\u4e00-\u9fa5\-]/g, '_');
    const filename = `SERP_${q}_${new Date().toISOString().slice(0,10)}.csv`;
    globalThis.GseExporter.downloadFile(csv, filename, 'text/csv;charset=utf-8;');
    showToast(`✅ 已导出 ${filename}`);
  });

  document.getElementById('btn-export-json').addEventListener('click', () => {
    if (!currentData || !currentData.items || currentData.items.length === 0) {
      showToast('暂无可导出的数据');
      return;
    }
    const json = globalThis.GseExporter.itemsToJson(currentData);
    const q = (currentData.query || 'google_serp').replace(/[^\w\u4e00-\u9fa5\-]/g, '_');
    const filename = `SERP_Full_${q}_${new Date().toISOString().slice(0,10)}.json`;
    globalThis.GseExporter.downloadFile(json, filename, 'application/json;charset=utf-8;');
    showToast(`✅ 已导出全量 JSON 数据！`);
  });

  document.getElementById('btn-open-modal').addEventListener('click', async () => {
    if (!activeTabId) return;
    try {
      await chrome.tabs.sendMessage(activeTabId, { cmd: 'OPEN_PREVIEW' });
      window.close();
    } catch (e) {
      showToast('无法在页面中打开，请刷新网页重试');
    }
  });
}

async function fetchData(triggerFresh = false) {
  try {
    const cmd = triggerFresh ? 'TRIGGER_EXTRACT' : 'GET_SERP_DATA';
    const response = await chrome.tabs.sendMessage(activeTabId, { cmd });
    if (response && response.ok && response.data) {
      renderData(response.data);
    } else {
      showError('未在页面中读取到搜索结果，请刷新页面');
    }
  } catch (err) {
    console.error('Failed to communicate with content script:', err);
    showError('无法连接页面，请刷新 Google 搜索页面后再试');
  }
}

function renderData(data) {
  currentData = data;

  const statusTag = document.getElementById('status-tag');
  const queryText = document.getElementById('query-text');
  const volumeText = document.getElementById('volume-text');
  const statTotal = document.getElementById('stat-total');
  const statAitdk = document.getElementById('stat-aitdk');
  const statKe = document.getElementById('stat-ke');
  const previewCount = document.getElementById('preview-count');
  const previewList = document.getElementById('preview-list');

  statusTag.textContent = '已连接';
  statusTag.className = 'status-indicator ready';

  queryText.textContent = data.query || '(未命名查询)';

  const statsMetaText = document.getElementById('stats-meta-text');
  if (statsMetaText) {
    if (data.resultStats && data.resultStats.raw) {
      statsMetaText.textContent = `📊 ${data.resultStats.raw}`;
      statsMetaText.style.display = 'block';
    } else {
      statsMetaText.style.display = 'none';
    }
  }

  if (data.pageVolumeInfo) {
    volumeText.textContent = `📈 ${data.pageVolumeInfo}`;
    volumeText.style.display = 'block';
  } else {
    volumeText.style.display = 'none';
  }

  statTotal.textContent = data.totalFound || 0;
  statAitdk.textContent = data.aitdkReadyCount || 0;
  statKe.textContent = data.keReadyCount || 0;

  // Render module count chips
  const chipsContainer = document.getElementById('modules-chips');
  if (chipsContainer) {
    const kwCount = (data.relatedKeywords || []).length;
    const prodCount = (data.relatedProducts || []).length;
    const adCount = (data.sponsoredAds || []).length;
    const paaCount = (data.peopleAlsoAsk || []).length;
    const hasAi = Boolean(data.aiOverview?.hasAiOverview);
    const hasDiff = Boolean(data.seoDifficulty?.hasDifficulty);

    const pageNum = data.pageInfo?.pageNumber || 1;
    const collectedPages = data.collectedPages || [pageNum];
    const isMultiPage = collectedPages.length > 1;

    let chipsHtml = '';
    chipsHtml += `<span class="status-indicator ready" style="background:#dbeafe; color:#1d4ed8; font-weight:700;">第 ${pageNum} 页</span>`;
    if (isMultiPage) {
      chipsHtml += `<span class="status-indicator ready" style="background:#d1fae5; color:#047857; font-weight:700;">已累积 ${collectedPages.length} 页</span>`;
    }
    if (kwCount > 0) chipsHtml += `<span class="status-indicator">词库: ${kwCount}</span>`;
    if (hasDiff) chipsHtml += `<span class="status-indicator">SEO难度: ${data.seoDifficulty.seoDifficulty}</span>`;
    if (prodCount > 0) chipsHtml += `<span class="status-indicator">产品: ${prodCount}</span>`;
    if (adCount > 0) chipsHtml += `<span class="status-indicator">广告: ${adCount}</span>`;
    if (paaCount > 0) chipsHtml += `<span class="status-indicator">PAA: ${paaCount}</span>`;
    if (hasAi) chipsHtml += `<span class="status-indicator ready">AI 概览</span>`;
    chipsContainer.innerHTML = chipsHtml;
  }

  const items = data.items || [];
  previewCount.textContent = `${items.length} 项`;

  if (items.length === 0) {
    previewList.innerHTML = `<div class="empty-hint">当前页面未检测到有效搜索结果</div>`;
    return;
  }

  const topItems = items.slice(0, 5);
  previewList.innerHTML = topItems.map(item => `
    <div class="preview-item">
      <div class="preview-item-title" title="${escapeHtml(item.title)}">
        <span style="color:#0369a1; font-weight:700;">#${item.rank}</span> <span style="font-size:10px; color:#64748b; background:#f1f5f9; padding:1px 4px; border-radius:3px;">P${item.page || 1}</span> ${escapeHtml(item.title)}
      </div>
      <div class="preview-item-meta">
        <span>DA: <b>${escapeHtml(item.mozDa || '-')}</b></span>
        <span>AITDK: <b>${escapeHtml(item.monthlyVisits || '-')}</b></span>
        <span>流量: <b>${escapeHtml(item.pageTraffic || '-')}</b></span>
      </div>
    </div>
  `).join('');
}

function showError(msg) {
  const statusTag = document.getElementById('status-tag');
  statusTag.textContent = '未连接';
  statusTag.className = 'status-indicator error';

  const previewList = document.getElementById('preview-list');
  previewList.innerHTML = `<div class="empty-hint" style="color: #ef4444;">${escapeHtml(msg)}</div>`;
}

function showToast(msg) {
  const toast = document.getElementById('popup-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
