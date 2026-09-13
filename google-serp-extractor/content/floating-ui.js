/**
 * Floating Widget & Multi-Tab Preview Modal for Google SERP & SEO Extractor
 */

(function() {
  let rootEl = null;
  let capsuleEl = null;
  let modalEl = null;
  let toastTimeout = null;

  // Stored state
  let currentSerpData = {
    query: '',
    resultStats: null,
    items: [],
    totalFound: 0,
    aitdkReadyCount: 0,
    keReadyCount: 0,
    relatedKeywords: [],
    relatedProducts: [],
    peopleAlsoAsk: [],
    sponsoredAds: [],
    aiOverview: null,
    discussions: []
  };

  let currentTab = 'serp'; // 'serp' | 'keywords' | 'products' | 'ads' | 'paa' | 'ai'
  let accumulatedItems = [];
  let isAccumulateMode = false;
  let isMinimized = false;

  function initFloatingUI(callbacks = {}) {
    if (document.getElementById('gse-root')) return;

    rootEl = document.createElement('div');
    rootEl.id = 'gse-root';
    document.body.appendChild(rootEl);

    renderCapsule(callbacks);
  }

  function renderCapsule(callbacks) {
    if (!rootEl) return;

    const itemCount = (currentSerpData.items || []).length;
    const totalFound = currentSerpData.totalFound || 0;
    const aitdkCount = currentSerpData.aitdkReadyCount || 0;
    const keCount = currentSerpData.keReadyCount || 0;
    const kwCount = (currentSerpData.relatedKeywords || []).length;
    const prodCount = (currentSerpData.relatedProducts || []).length;

    const pageNum = currentSerpData.pageInfo?.pageNumber || 1;
    const collectedPages = currentSerpData.collectedPages || [pageNum];
    const isMultiPage = collectedPages.length > 1;

    const readiness = currentSerpData.readiness || {};
    const statsStr = currentSerpData.resultStats?.totalResults
      ? `${Number(currentSerpData.resultStats.totalResults).toLocaleString()} 结果`
      : `${totalFound} 项`;

    let badgeClass = 'pending';
    let badgeText = '';

    const sep = '<span class="gse-badge-sep">|</span>';
    const pageTag = `<span class="gse-capsule-page-tag">第${pageNum}页</span>`;

    const pluginList = Object.values(readiness.plugins || {});
    const pluginBadgesReady = pluginList.map(p => `<span title="${escapeHtml(p.name)} 数据加载数">${p.badgeKey}:${p.loadedCount}</span>`).join(sep);
    const pluginBadgesLoading = pluginList.map(p => `<span title="${escapeHtml(p.name)} 加载进度">${p.badgeKey}:${p.loadedCount}/${totalFound}</span>`).join(sep);

    if (readiness.state === 'NO_PLUGINS') {
      badgeClass = 'ready';
      badgeText = `${pageTag} ${sep} <span>${statsStr}</span> <span style="font-size:10px; opacity:0.7;">(纯净SERP)</span>`;
    } else if (readiness.state === 'READY') {
      badgeClass = 'ready';
      badgeText = `
        <span style="color: #059669; font-weight: bold;">🟢 已就绪</span>
        ${sep}
        ${pageTag}
        ${sep}
        <span>${statsStr}</span>
        ${pluginBadgesReady ? `${sep}${pluginBadgesReady}` : ''}
      `;
    } else {
      badgeClass = 'pending';
      badgeText = `
        <span style="color: #d97706; font-weight: bold;">⏳ 插件加载中</span>
        ${sep}
        ${pageTag}
        ${pluginBadgesLoading ? `${sep}${pluginBadgesLoading}` : ''}
      `;
    }

    if (kwCount > 0) {
      badgeText += `${sep}<span title="关键词库总数">词:${kwCount}</span>`;
    }
    if (prodCount > 0) {
      badgeText += `${sep}<span title="竞品产品数">品:${prodCount}</span>`;
    }

    const accBtnText = isAccumulateMode
      ? `➕ 累积中 (${itemCount}条${isMultiPage ? ' 跨' + collectedPages.length + '页' : ''})`
      : '➕ 追加模式';

    const badgeTitle = readiness.statusText || currentSerpData.resultStats?.raw || '搜索项与就绪统计';

    if (globalThis.GseTemplates?.capsuleTemplate) {
      rootEl.innerHTML = globalThis.GseTemplates.capsuleTemplate({
        isMinimized,
        statsStr,
        badgeClass,
        badgeText,
        badgeTitle,
        accBtnText,
        isAccumulateMode
      });
    }

    bindCapsuleEvents(callbacks);
  }

  function bindCapsuleEvents(callbacks) {
    const btnExtract = document.getElementById('gse-btn-extract');
    const btnCopy = document.getElementById('gse-btn-copy');
    const btnCsv = document.getElementById('gse-btn-csv');
    const btnPreview = document.getElementById('gse-btn-preview');
    const btnAccumulate = document.getElementById('gse-btn-accumulate');
    const btnToggleMin = document.getElementById('gse-btn-toggle-min');
    const btnBrand = document.getElementById('gse-btn-brand');

    if (btnBrand) {
      btnBrand.addEventListener('click', () => {
        isMinimized = !isMinimized;
        renderCapsule(callbacks);
      });
    }

    if (btnToggleMin) {
      btnToggleMin.addEventListener('click', () => {
        isMinimized = !isMinimized;
        renderCapsule(callbacks);
      });
    }

    if (btnExtract) {
      btnExtract.addEventListener('click', () => {
        if (callbacks.onExtract) callbacks.onExtract();
        showToast('已提取最新数据！');
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener('click', async () => {
        const items = getActiveItems();
        if (!items || items.length === 0) {
          showToast('当前没有可复制的数据');
          return;
        }
        const activeCols = globalThis.GseExporter?.getActiveSerpColumns?.(currentSerpData.activePluginIds);
        const tsv = globalThis.GseExporter.itemsToTsv(items, activeCols);
        try {
          await globalThis.GseExporter.copyTextToClipboard(tsv);
          showToast(`✅ 已复制 ${items.length} 条数据至剪贴板，直接粘贴进 Excel / Google Sheets！`);
        } catch (e) {
          showToast('❌ 复制失败: ' + e.message);
        }
      });
    }

    if (btnCsv) {
      btnCsv.addEventListener('click', () => {
        const items = getActiveItems();
        if (!items || items.length === 0) {
          showToast('当前没有可导出的数据');
          return;
        }
        const activeCols = globalThis.GseExporter?.getActiveSerpColumns?.(currentSerpData.activePluginIds);
        const csv = globalThis.GseExporter.itemsToCsv(items, activeCols);
        const query = (currentSerpData.query || 'google_serp').replace(/[^\w\u4e00-\u9fa5\-]/g, '_');
        const filename = `SERP_${query}_${new Date().toISOString().slice(0,10)}.csv`;
        globalThis.GseExporter.downloadFile(csv, filename, 'text/csv;charset=utf-8;');
        showToast(`✅ 已导出 ${filename}`);
      });
    }

    if (btnPreview) {
      btnPreview.addEventListener('click', () => {
        openPreviewModal(callbacks);
      });
    }

    if (btnAccumulate) {
      btnAccumulate.addEventListener('click', () => {
        const nextMode = !isAccumulateMode;
        isAccumulateMode = nextMode;
        if (callbacks.onToggleAccumulate) {
          callbacks.onToggleAccumulate(nextMode);
        }
        showToast(nextMode ? '已开启跨页追加模式！翻页将持续累加数据' : '已关闭追加模式，仅保留当前页');
      });
    }

    const btnSyncDb = document.getElementById('gse-btn-sync-db');
    if (btnSyncDb) {
      btnSyncDb.addEventListener('click', async () => {
        const items = getActiveItems();
        if (!items || items.length === 0) {
          showToast('当前无有效搜索数据可入库');
          return;
        }
        btnSyncDb.disabled = true;
        showToast('正在向本地数据库中继同步...');
        if (callbacks.onSyncRelay) {
          const res = await callbacks.onSyncRelay(currentSerpData);
          if (res && res.ok) {
            showToast(`✅ ${res.message || '已成功落库至本地数据库'}`);
          } else {
            showToast(`❌ 同步失败: ${res?.error || '无法连接 proxy-server (9090)'}`);
          }
        }
        btnSyncDb.disabled = false;
      });
    }
  }

  function getActiveItems() {
    return currentSerpData.items || [];
  }

  function updateStatus(serpData, callbacks) {
    currentSerpData = serpData;
    if (callbacks && typeof callbacks.isAccumulateMode === 'boolean') {
      isAccumulateMode = callbacks.isAccumulateMode;
    } else if (serpData.isAccumulated) {
      isAccumulateMode = true;
    }
    renderCapsule(callbacks);
    if (globalThis.GseModalUI?.isOpen?.()) {
      globalThis.GseModalUI.updateStatus(serpData, callbacks);
    }
  }

  function showToast(message) {
    const toast = document.getElementById('gse-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2500);
  }

  function openPreviewModal(callbacks) {
    if (globalThis.GseModalUI) {
      globalThis.GseModalUI.openPreviewModal(rootEl, currentSerpData, {
        ...callbacks,
        isAccumulateMode
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  globalThis.GseFloatingUI = {
    initFloatingUI,
    updateStatus,
    showToast,
    openPreviewModal
  };
})();
