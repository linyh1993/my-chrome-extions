/**
 * Floating Widget & Preview Modal for Google SERP & SEO Extractor
 */

(function() {
  let rootEl = null;
  let capsuleEl = null;
  let modalEl = null;
  let toastTimeout = null;

  // Stored state
  let currentSerpData = {
    query: '',
    items: [],
    totalFound: 0,
    aitdkReadyCount: 0,
    keReadyCount: 0
  };

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

    const itemCount = isAccumulateMode ? accumulatedItems.length : currentSerpData.items.length;
    const totalFound = currentSerpData.totalFound || 0;
    const aitdkCount = currentSerpData.aitdkReadyCount || 0;
    const keCount = currentSerpData.keReadyCount || 0;

    const isReady = totalFound > 0 && (aitdkCount >= totalFound || keCount >= totalFound);

    rootEl.innerHTML = `
      <div class="gse-toast" id="gse-toast"></div>
      <div class="gse-capsule ${isMinimized ? 'minimized' : ''}" id="gse-capsule">
        <div class="gse-brand" id="gse-btn-brand" title="点击切换展开/折叠">
          <div class="gse-brand-icon">G</div>
          <span class="gse-brand-title">SERP SEO</span>
        </div>

        ${!isMinimized ? `
          <div class="gse-badge ${isReady ? 'ready' : 'pending'}" title="已识别搜索结果 / AITDK就绪 / KE就绪">
            <span>${totalFound} 条</span>
            <span style="opacity: 0.6; margin: 0 3px;">|</span>
            <span title="AITDK 数据加载数">A:${aitdkCount}</span>
            <span style="opacity: 0.6; margin: 0 3px;">|</span>
            <span title="Keywords Everywhere 数据加载数">K:${keCount}</span>
          </div>

          <div class="gse-divider"></div>

          <button class="gse-btn gse-btn-primary" id="gse-btn-extract" title="立即重新扫描页面提取数据">
            <span>🔄 提取</span>
          </button>

          <button class="gse-btn gse-btn-success" id="gse-btn-copy" title="复制表格 (TSV格式，可直接Ctrl+V粘贴至Excel/Google表格)">
            <span>📋 复制表格</span>
          </button>

          <button class="gse-btn" id="gse-btn-csv" title="下载CSV表格文件 (UTF-8 BOM)">
            <span>📥 导出CSV</span>
          </button>

          <button class="gse-btn" id="gse-btn-preview" title="打开数据表格预览与筛选">
            <span>👁️ 预览</span>
          </button>

          <button class="gse-btn ${isAccumulateMode ? 'gse-btn-primary' : ''}" id="gse-btn-accumulate" title="跨翻页追加模式: ${isAccumulateMode ? '已开启' : '已关闭'}">
            <span>${isAccumulateMode ? '➕ 追加中 (' + accumulatedItems.length + ')' : '➕ 追加模式'}</span>
          </button>
        ` : `
          <div class="gse-badge ${isReady ? 'ready' : 'pending'}">${totalFound}条</div>
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
        const tsv = globalThis.GseExporter.itemsToTsv(items);
        try {
          await globalThis.GseExporter.copyTextToClipboard(tsv);
          showToast(`✅ 已复制 ${items.length} 条数据至剪贴板，可直接粘贴进 Excel / Google Sheets！`);
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
        const csv = globalThis.GseExporter.itemsToCsv(items);
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
        isAccumulateMode = !isAccumulateMode;
        if (isAccumulateMode && accumulatedItems.length === 0 && currentSerpData.items.length > 0) {
          accumulateCurrentItems();
        }
        showToast(isAccumulateMode ? '已开启跨页追加模式！翻页将持续累加数据' : '已关闭追加模式');
        renderCapsule(callbacks);
      });
    }
  }

  function getActiveItems() {
    return isAccumulateMode && accumulatedItems.length > 0 ? accumulatedItems : currentSerpData.items;
  }

  function accumulateCurrentItems() {
    const existingUrls = new Set(accumulatedItems.map(x => x.url));
    let added = 0;
    for (const item of currentSerpData.items) {
      if (!existingUrls.has(item.url)) {
        accumulatedItems.push({
          ...item,
          rank: accumulatedItems.length + 1
        });
        existingUrls.add(item.url);
        added++;
      }
    }
    return added;
  }

  function updateStatus(serpData, callbacks) {
    currentSerpData = serpData;
    if (isAccumulateMode) {
      accumulateCurrentItems();
    }
    renderCapsule(callbacks);
    if (modalEl && !modalEl.classList.contains('gse-hidden')) {
      renderModalTable();
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

  /**
   * Preview Drawer / Modal
   */
  function openPreviewModal(callbacks) {
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.className = 'gse-modal-backdrop';
      modalEl.id = 'gse-modal-backdrop';
      rootEl.appendChild(modalEl);
    }
    modalEl.classList.remove('gse-hidden');

    const items = getActiveItems();
    modalEl.innerHTML = `
      <div class="gse-modal">
        <div class="gse-modal-header">
          <div class="gse-modal-title">
            <div class="gse-brand-icon">G</div>
            <span>SERP & SEO 数据预览 (共 ${items.length} 条) - 关键词: "${escapeHtml(currentSerpData.query || '未检测到')}"</span>
          </div>
          <div class="gse-modal-controls">
            <button class="gse-btn gse-btn-success" id="gse-modal-copy">📋 复制表格 (TSV)</button>
            <button class="gse-btn gse-btn-primary" id="gse-modal-csv">📥 导出 CSV</button>
            <button class="gse-btn" id="gse-modal-json">📄 导出 JSON</button>
            ${isAccumulateMode ? '<button class="gse-btn" id="gse-modal-clear-acc">🗑️ 清空累积</button>' : ''}
            <button class="gse-btn" id="gse-modal-close" style="font-size: 14px; font-weight: bold;">✕</button>
          </div>
        </div>

        <div class="gse-modal-body" id="gse-modal-table-container">
          <!-- table rendered below -->
        </div>

        <div class="gse-modal-footer">
          <div>💡 提示：点击「复制表格」后，可直接在 Excel、Google Sheets 或飞书/Notion 表格按 Ctrl+V 完整贴入。</div>
          <div>Keywords Everywhere + AITDK 联合提取</div>
        </div>
      </div>
    `;

    renderModalTable();
    bindModalEvents(callbacks);
  }

  function renderModalTable() {
    const container = document.getElementById('gse-modal-table-container');
    if (!container) return;

    const items = getActiveItems();
    if (items.length === 0) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748b;">暂无提取数据，请点击「提取」按钮扫描页面结果</div>`;
      return;
    }

    let rowsHtml = items.map(item => `
      <tr>
        <td style="font-weight: 700; text-align: center;">${item.rank}</td>
        <td style="font-weight: 600;" title="${escapeHtml(item.title)}">
          <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a>
        </td>
        <td><code>${escapeHtml(item.domain)}</code></td>
        <td class="badge-moz">${escapeHtml(item.mozDa || '-')}${item.mozDaTrend ? ' (' + escapeHtml(item.mozDaTrend) + ')' : ''}</td>
        <td>${escapeHtml(item.refDom || '-')}</td>
        <td>${escapeHtml(item.refLinks || '-')}</td>
        <td>${escapeHtml(item.spamScore || '-')}</td>
        <td>${escapeHtml(item.pageTraffic || '-')}</td>
        <td>${escapeHtml(item.siteTraffic || '-')}</td>
        <td>${escapeHtml(item.pageKeywords || '-')}</td>
        <td>${escapeHtml(item.siteKeywords || '-')}</td>
        <td class="badge-aitdk">${escapeHtml(item.monthlyVisits || '-')}</td>
        <td>${escapeHtml(item.avgDuration || '-')}</td>
        <td>${escapeHtml(item.domainCreated || '-')}</td>
        <td style="max-width: 200px;" title="${escapeHtml(item.snippet)}">${escapeHtml(item.snippet)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="gse-table">
        <thead>
          <tr>
            <th>#</th>
            <th>页面标题 (Title)</th>
            <th>域名 (Domain)</th>
            <th>MOZ DA</th>
            <th>Ref Dom</th>
            <th>Ref Links</th>
            <th>Spam</th>
            <th>单页流量</th>
            <th>整站流量</th>
            <th>单页词数</th>
            <th>整站词数</th>
            <th>月访问量 (AITDK)</th>
            <th>平均时长</th>
            <th>建立时间</th>
            <th>摘要 (Snippet)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  function bindModalEvents(callbacks) {
    const modalBackdrop = document.getElementById('gse-modal-backdrop');
    const btnClose = document.getElementById('gse-modal-close');
    const btnCopy = document.getElementById('gse-modal-copy');
    const btnCsv = document.getElementById('gse-modal-csv');
    const btnJson = document.getElementById('gse-modal-json');
    const btnClearAcc = document.getElementById('gse-modal-clear-acc');

    const closeModal = () => {
      if (modalEl) modalEl.classList.add('gse-hidden');
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener('click', async () => {
        const items = getActiveItems();
        const tsv = globalThis.GseExporter.itemsToTsv(items);
        await globalThis.GseExporter.copyTextToClipboard(tsv);
        showToast(`✅ 已复制 ${items.length} 条数据至剪贴板！`);
      });
    }

    if (btnCsv) {
      btnCsv.addEventListener('click', () => {
        const items = getActiveItems();
        const csv = globalThis.GseExporter.itemsToCsv(items);
        const query = (currentSerpData.query || 'serp').replace(/[^\w\u4e00-\u9fa5\-]/g, '_');
        globalThis.GseExporter.downloadFile(csv, `SERP_${query}_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8;');
        showToast('✅ 已导出 CSV 文件！');
      });
    }

    if (btnJson) {
      btnJson.addEventListener('click', () => {
        const items = getActiveItems();
        const json = globalThis.GseExporter.itemsToJson(items);
        const query = (currentSerpData.query || 'serp').replace(/[^\w\u4e00-\u9fa5\-]/g, '_');
        globalThis.GseExporter.downloadFile(json, `SERP_${query}_${new Date().toISOString().slice(0,10)}.json`, 'application/json;charset=utf-8;');
        showToast('✅ 已导出 JSON 文件！');
      });
    }

    if (btnClearAcc) {
      btnClearAcc.addEventListener('click', () => {
        accumulatedItems = [];
        renderModalTable();
        renderCapsule(callbacks);
        showToast('已清空累积数据');
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
