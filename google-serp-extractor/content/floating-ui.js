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

    const pageTag = `<span style="background: #2563eb; color: #fff; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 11px;">第${pageNum}页</span>`;

    const pluginList = Object.values(readiness.plugins || {});
    const pluginBadgesReady = pluginList.map(p => `<span title="${escapeHtml(p.name)} 数据加载数">${p.badgeKey}:${p.loadedCount}</span>`).join('<span style="margin: 0 3px; opacity: 0.5;">|</span>');
    const pluginBadgesLoading = pluginList.map(p => `<span title="${escapeHtml(p.name)} 加载进度">${p.badgeKey}:${p.loadedCount}/${totalFound}</span>`).join('<span style="margin: 0 3px; opacity: 0.5;">|</span>');

    if (readiness.state === 'NO_PLUGINS') {
      badgeClass = 'ready';
      badgeText = `${pageTag} <span style="margin: 0 3px; opacity: 0.5;">|</span> <span>${statsStr}</span> <span style="font-size:10px; opacity:0.7;">(纯净SERP)</span>`;
    } else if (readiness.state === 'READY') {
      badgeClass = 'ready';
      badgeText = `
        <span style="color: #059669; font-weight: bold;">🟢 已就绪</span>
        <span style="margin: 0 3px; opacity: 0.5;">|</span>
        ${pageTag}
        <span style="margin: 0 3px; opacity: 0.5;">|</span>
        <span>${statsStr}</span>
        ${pluginBadgesReady ? `<span style="margin: 0 3px; opacity: 0.5;">|</span>${pluginBadgesReady}` : ''}
      `;
    } else {
      badgeClass = 'pending';
      badgeText = `
        <span style="color: #d97706; font-weight: bold;">⏳ 插件加载中</span>
        <span style="margin: 0 3px; opacity: 0.5;">|</span>
        ${pageTag}
        ${pluginBadgesLoading ? `<span style="margin: 0 3px; opacity: 0.5;">|</span>${pluginBadgesLoading}` : ''}
      `;
    }

    if (kwCount > 0) {
      badgeText += `<span style="margin: 0 3px; opacity: 0.5;">|</span><span title="关键词库总数">词:${kwCount}</span>`;
    }
    if (prodCount > 0) {
      badgeText += `<span style="margin: 0 3px; opacity: 0.5;">|</span><span title="竞品产品数">品:${prodCount}</span>`;
    }

    const accBtnText = isAccumulateMode
      ? `➕ 累积中 (${itemCount}条${isMultiPage ? ' 跨' + collectedPages.length + '页' : ''})`
      : '➕ 追加模式';

    rootEl.innerHTML = `
      <div class="gse-toast" id="gse-toast"></div>
      <div class="gse-capsule ${isMinimized ? 'minimized' : ''}" id="gse-capsule">
        <div class="gse-brand" id="gse-btn-brand" title="点击切换展开/折叠">
          <div class="gse-brand-icon">G</div>
          <span class="gse-brand-title">SERP SEO</span>
        </div>

        ${!isMinimized ? `
          <div class="gse-badge ${badgeClass}" title="${escapeHtml(readiness.statusText || currentSerpData.resultStats?.raw || '搜索项与就绪统计')}">
            ${badgeText}
          </div>

          <div class="gse-divider"></div>

          <button class="gse-btn gse-btn-primary" id="gse-btn-extract" title="立即重新扫描页面提取最新数据">
            <span>🔄 提取</span>
          </button>

          <button class="gse-btn gse-btn-success" id="gse-btn-copy" title="复制当前自然搜索结果表格 (TSV格式)">
            <span>📋 复制表格</span>
          </button>

          <button class="gse-btn" id="gse-btn-csv" title="下载CSV表格文件 (UTF-8 BOM)">
            <span>📥 导出CSV</span>
          </button>

          <button class="gse-btn" id="gse-btn-preview" title="打开全景多Tab数据表格与长尾词/产品预览">
            <span>👁️ 全景预览</span>
          </button>

          <button class="gse-btn ${isAccumulateMode ? 'gse-btn-primary' : ''}" id="gse-btn-accumulate" title="跨翻页追加模式: ${isAccumulateMode ? '已开启' : '已关闭'}">
            <span>${accBtnText}</span>
          </button>
        ` : `
          <div class="gse-badge ${badgeClass}">${statsStr}</div>
        `}

        <button class="gse-btn gse-btn-icon" id="gse-btn-toggle-min" title="${isMinimized ? '展开' : '折叠'}">
          <span>${isMinimized ? '◀' : '✕'}</span>
        </button>
      </div>
    `;

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
