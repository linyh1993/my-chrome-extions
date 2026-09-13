/**
 * Google SERP & SEO Extractor - Fullscreen Multi-Tab Modal UI Controller
 * Manages modal lifecycle, tab switching, and export user actions.
 * Delegates HTML templates to templates.js and view rendering to view-renderers.js.
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const templates = require('./templates.js');
    const viewRenderers = require('./view-renderers.js');
    module.exports = factory(templates, viewRenderers);
  } else {
    root.GseModalUI = factory(root.GseTemplates || {}, root.GseViewRenderers || {});
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(templates, viewRenderers) {

  let modalEl = null;
  let currentSerpData = {};
  let currentCallbacks = {};
  let currentTab = 'serp'; // 'serp' | 'keywords' | 'products' | 'ads' | 'paa' | 'ai' | 'difficulty'
  let isAccumulateMode = false;

  function isOpen() {
    return Boolean(modalEl && !modalEl.classList.contains('gse-hidden'));
  }

  function openPreviewModal(rootEl, serpData, callbacks = {}) {
    currentSerpData = serpData || {};
    currentCallbacks = callbacks;
    isAccumulateMode = Boolean(callbacks.isAccumulateMode);

    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.className = 'gse-modal-backdrop';
      modalEl.id = 'gse-modal-backdrop';
      (rootEl || document.body).appendChild(modalEl);
    }
    modalEl.classList.remove('gse-hidden');

    renderModalFramework();
  }

  function updateStatus(serpData, callbacks) {
    currentSerpData = serpData;
    if (callbacks && typeof callbacks.isAccumulateMode === 'boolean') {
      isAccumulateMode = callbacks.isAccumulateMode;
    }
    if (isOpen()) {
      renderModalFramework();
      renderModalTable();
    }
  }

  function getActiveItems() {
    return currentSerpData.items || [];
  }

  function renderModalFramework() {
    if (!modalEl || !templates?.modalFrameworkTemplate) return;

    const pageNum = currentSerpData.pageInfo?.pageNumber || 1;
    const collectedPages = currentSerpData.collectedPages || [pageNum];

    modalEl.innerHTML = templates.modalFrameworkTemplate({
      query: currentSerpData.query,
      pageNum,
      isMultiPage: collectedPages.length > 1,
      collectedPages,
      resultStatsRaw: currentSerpData.resultStats?.raw,
      isAccumulateMode,
      currentTab,
      counts: {
        serp: getActiveItems().length,
        keywords: (currentSerpData.relatedKeywords || []).length,
        products: (currentSerpData.relatedProducts || []).length,
        ads: (currentSerpData.sponsoredAds || []).length,
        paa: (currentSerpData.peopleAlsoAsk || []).length
      },
      hasDifficulty: Boolean(currentSerpData.seoDifficulty?.hasDifficulty),
      hasAi: Boolean(currentSerpData.aiOverview?.hasAiOverview)
    });

    renderModalTable();
    bindModalEvents();
  }

  function renderModalTable() {
    const container = document.getElementById('gse-modal-table-container');
    if (!container || !viewRenderers) return;

    switch (currentTab) {
      case 'serp':
        viewRenderers.renderSerpTable(container, getActiveItems(), currentSerpData.activePluginIds);
        break;
      case 'keywords':
        viewRenderers.renderKeywordsTable(container, currentSerpData.relatedKeywords);
        break;
      case 'products':
        viewRenderers.renderProductsTable(container, currentSerpData.relatedProducts);
        break;
      case 'ads':
        viewRenderers.renderAdsTable(container, currentSerpData.sponsoredAds);
        break;
      case 'paa':
        viewRenderers.renderPaaTable(container, currentSerpData.peopleAlsoAsk);
        break;
      case 'difficulty':
        viewRenderers.renderDifficultyTab(container, currentSerpData.seoDifficulty);
        break;
      case 'ai':
        viewRenderers.renderAiOverviewTab(container, currentSerpData.aiOverview);
        break;
    }
  }

  function bindModalEvents() {
    const modalBackdrop = document.getElementById('gse-modal-backdrop');
    const btnClose = document.getElementById('gse-modal-close');
    const btnCopyActive = document.getElementById('gse-modal-copy-active');
    const btnCsvActive = document.getElementById('gse-modal-csv-active');
    const btnExportAllJson = document.getElementById('gse-modal-export-all-json');
    const btnToggleAcc = document.getElementById('gse-modal-toggle-acc');
    const btnClearAcc = document.getElementById('gse-modal-clear-acc');

    // Tab buttons
    const tabBtns = modalEl.querySelectorAll('.gse-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        currentTab = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderModalTable();
      });
    });

    const closeModal = () => {
      if (modalEl) modalEl.classList.add('gse-hidden');
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
      });
    }

    if (btnToggleAcc) {
      btnToggleAcc.addEventListener('click', () => {
        const nextMode = !isAccumulateMode;
        isAccumulateMode = nextMode;
        if (currentCallbacks.onToggleAccumulate) {
          currentCallbacks.onToggleAccumulate(nextMode);
        }
      });
    }

    if (btnClearAcc) {
      btnClearAcc.addEventListener('click', () => {
        if (currentCallbacks.onClearAccumulate) {
          currentCallbacks.onClearAccumulate();
        }
      });
    }

    if (btnCopyActive) {
      btnCopyActive.addEventListener('click', async () => {
        let tsv = '';
        let count = 0;

        if (currentTab === 'serp') {
          const items = getActiveItems();
          const activeCols = globalThis.GseExporter?.getActiveSerpColumns?.(currentSerpData.activePluginIds);
          tsv = globalThis.GseExporter.itemsToTsv(items, activeCols);
          count = items.length;
        } else if (currentTab === 'keywords') {
          const list = currentSerpData.relatedKeywords || [];
          tsv = globalThis.GseExporter.keywordsToTsv(list);
          count = list.length;
        } else if (currentTab === 'products') {
          const list = currentSerpData.relatedProducts || [];
          tsv = globalThis.GseExporter.productsToTsv(list);
          count = list.length;
        } else if (currentTab === 'ads') {
          const list = currentSerpData.sponsoredAds || [];
          tsv = globalThis.GseExporter.adsToTsv(list);
          count = list.length;
        } else if (currentTab === 'paa') {
          const list = currentSerpData.peopleAlsoAsk || [];
          tsv = globalThis.GseExporter.paaToTsv(list);
          count = list.length;
        }

        if (!tsv) {
          globalThis.GseFloatingUI?.showToast?.('当前 Tab 没有可复制的数据');
          return;
        }
        await globalThis.GseExporter.copyTextToClipboard(tsv);
        globalThis.GseFloatingUI?.showToast?.(`✅ 已复制当前 Tab (${count} 条) 至剪贴板！可以直接粘贴进 Excel / Google 表格`);
      });
    }

    if (btnCsvActive) {
      btnCsvActive.addEventListener('click', () => {
        const query = (currentSerpData.query || 'serp').replace(/[^\w\u4e00-\u9fa5\-]/g, '_');
        const dateStr = new Date().toISOString().slice(0,10);
        let csv = '';
        let filename = '';

        if (currentTab === 'serp') {
          const items = getActiveItems();
          const activeCols = globalThis.GseExporter?.getActiveSerpColumns?.(currentSerpData.activePluginIds);
          csv = globalThis.GseExporter.itemsToCsv(items, activeCols);
          filename = `SERP_${query}_${dateStr}.csv`;
        } else if (currentTab === 'keywords') {
          const list = currentSerpData.relatedKeywords || [];
          csv = globalThis.GseExporter.keywordsToCsv(list);
          filename = `Keywords_PASF_${query}_${dateStr}.csv`;
        } else if (currentTab === 'products') {
          const list = currentSerpData.relatedProducts || [];
          csv = globalThis.GseExporter.productsToCsv(list);
          filename = `Products_${query}_${dateStr}.csv`;
        } else if (currentTab === 'ads') {
          const list = currentSerpData.sponsoredAds || [];
          csv = globalThis.GseExporter.adsToCsv(list);
          filename = `Ads_${query}_${dateStr}.csv`;
        } else if (currentTab === 'paa') {
          const list = currentSerpData.peopleAlsoAsk || [];
          csv = globalThis.GseExporter.paaToCsv(list);
          filename = `PAA_${query}_${dateStr}.csv`;
        }

        if (!csv) {
          globalThis.GseFloatingUI?.showToast?.('当前 Tab 没有可导出的数据');
          return;
        }
        globalThis.GseExporter.downloadFile(csv, filename, 'text/csv;charset=utf-8;');
        globalThis.GseFloatingUI?.showToast?.(`✅ 已导出 ${filename}`);
      });
    }

    if (btnExportAllJson) {
      btnExportAllJson.addEventListener('click', () => {
        const fullData = {
          ...currentSerpData,
          items: getActiveItems()
        };
        const json = globalThis.GseExporter.itemsToJson(fullData);
        const query = (currentSerpData.query || 'serp').replace(/[^\w\u4e00-\u9fa5\-]/g, '_');
        const filename = `SERP_Landscape_${query}_${new Date().toISOString().slice(0,10)}.json`;
        globalThis.GseExporter.downloadFile(json, filename, 'application/json;charset=utf-8;');
        globalThis.GseFloatingUI?.showToast?.(`✅ 已导出全景 JSON: ${filename}`);
      });
    }

    const btnSyncDb = document.getElementById('gse-modal-sync-db');
    if (btnSyncDb) {
      btnSyncDb.addEventListener('click', async () => {
        const items = getActiveItems();
        if (!items || items.length === 0) {
          globalThis.GseFloatingUI?.showToast?.('当前无有效搜索数据可入库');
          return;
        }
        btnSyncDb.disabled = true;
        globalThis.GseFloatingUI?.showToast?.('正在向本地数据库中继同步...');
        if (currentCallbacks.onSyncRelay) {
          const res = await currentCallbacks.onSyncRelay(currentSerpData);
          if (res && res.ok) {
            globalThis.GseFloatingUI?.showToast?.(`✅ ${res.message || '已成功落库至本地数据库'}`);
          } else {
            globalThis.GseFloatingUI?.showToast?.(`❌ 同步失败: ${res?.error || '无法连接 proxy-server (9090)'}`);
          }
        }
        btnSyncDb.disabled = false;
      });
    }
  }

  return {
    openPreviewModal,
    updateStatus,
    isOpen
  };
});
