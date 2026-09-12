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

    const itemCount = isAccumulateMode ? accumulatedItems.length : currentSerpData.items.length;
    const totalFound = currentSerpData.totalFound || 0;
    const aitdkCount = currentSerpData.aitdkReadyCount || 0;
    const keCount = currentSerpData.keReadyCount || 0;
    const kwCount = (currentSerpData.relatedKeywords || []).length;
    const prodCount = (currentSerpData.relatedProducts || []).length;
    const paaCount = (currentSerpData.peopleAlsoAsk || []).length;
    const adCount = (currentSerpData.sponsoredAds || []).length;

    const isReady = totalFound > 0 && (aitdkCount >= totalFound || keCount >= totalFound);
    const statsStr = currentSerpData.resultStats?.totalResults
      ? `${Number(currentSerpData.resultStats.totalResults).toLocaleString()} 结果`
      : `${totalFound} 项`;

    rootEl.innerHTML = `
      <div class="gse-toast" id="gse-toast"></div>
      <div class="gse-capsule ${isMinimized ? 'minimized' : ''}" id="gse-capsule">
        <div class="gse-brand" id="gse-btn-brand" title="点击切换展开/折叠">
          <div class="gse-brand-icon">G</div>
          <span class="gse-brand-title">SERP SEO</span>
        </div>

        ${!isMinimized ? `
          <div class="gse-badge ${isReady ? 'ready' : 'pending'}" title="${currentSerpData.resultStats?.raw || '搜索项与就绪统计'}">
            <span>${statsStr}</span>
            <span style="opacity: 0.6; margin: 0 3px;">|</span>
            <span title="AITDK 数据加载数">A:${aitdkCount}</span>
            <span style="opacity: 0.6; margin: 0 3px;">|</span>
            <span title="Keywords Everywhere 数据加载数">K:${keCount}</span>
            ${kwCount > 0 ? `<span style="opacity: 0.6; margin: 0 3px;">|</span><span title="相关搜索词数">词:${kwCount}</span>` : ''}
            ${prodCount > 0 ? `<span style="opacity: 0.6; margin: 0 3px;">|</span><span title="相关产品数">品:${prodCount}</span>` : ''}
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
            <span>${isAccumulateMode ? '➕ 追加中 (' + accumulatedItems.length + ')' : '➕ 追加模式'}</span>
          </button>
        ` : `
          <div class="gse-badge ${isReady ? 'ready' : 'pending'}">${statsStr}</div>
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
   * Preview Drawer / Modal with Multi-Tab Navigation
   */
  function openPreviewModal(callbacks) {
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.className = 'gse-modal-backdrop';
      modalEl.id = 'gse-modal-backdrop';
      rootEl.appendChild(modalEl);
    }
    modalEl.classList.remove('gse-hidden');

    renderModalFramework(callbacks);
  }

  function renderModalFramework(callbacks) {
    const serpCount = getActiveItems().length;
    const kwCount = (currentSerpData.relatedKeywords || []).length;
    const prodCount = (currentSerpData.relatedProducts || []).length;
    const adCount = (currentSerpData.sponsoredAds || []).length;
    const paaCount = (currentSerpData.peopleAlsoAsk || []).length;
    const hasAi = Boolean(currentSerpData.aiOverview?.hasAiOverview);

    modalEl.innerHTML = `
      <div class="gse-modal">
        <div class="gse-modal-header">
          <div class="gse-modal-title">
            <div class="gse-brand-icon">G</div>
            <span>全景 SERP & SEO 数据 - 关键词: "${escapeHtml(currentSerpData.query || '未命名')}"</span>
            ${currentSerpData.resultStats?.raw ? `<span style="font-size: 11px; font-weight: normal; color: #64748b;">(${escapeHtml(currentSerpData.resultStats.raw)})</span>` : ''}
          </div>
          <div class="gse-modal-controls">
            <button class="gse-btn gse-btn-success" id="gse-modal-copy-active">📋 复制当前 Tab</button>
            <button class="gse-btn gse-btn-primary" id="gse-modal-csv-active">📥 导出当前 CSV</button>
            <button class="gse-btn" id="gse-modal-export-all-json">📦 导出全景 JSON</button>
            ${isAccumulateMode ? '<button class="gse-btn" id="gse-modal-clear-acc">🗑️ 清空累积</button>' : ''}
            <button class="gse-btn" id="gse-modal-close" style="font-size: 14px; font-weight: bold;">✕</button>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="gse-tabs-bar">
          <button class="gse-tab-btn ${currentTab === 'serp' ? 'active' : ''}" data-tab="serp">
            🏆 自然搜索结果 <span class="gse-tab-count">${serpCount}</span>
          </button>
          <button class="gse-tab-btn ${currentTab === 'keywords' ? 'active' : ''}" data-tab="keywords">
            💡 搜索词库 (PASF / 相关词) <span class="gse-tab-count">${kwCount}</span>
          </button>
          <button class="gse-tab-btn ${currentTab === 'products' ? 'active' : ''}" data-tab="products">
            🛍️ 竞品产品与服务 <span class="gse-tab-count">${prodCount}</span>
          </button>
          <button class="gse-tab-btn ${currentTab === 'ads' ? 'active' : ''}" data-tab="ads">
            📢 商业竞价广告 <span class="gse-tab-count">${adCount}</span>
          </button>
          <button class="gse-tab-btn ${currentTab === 'paa' ? 'active' : ''}" data-tab="paa">
            ❓ 意图问答 (PAA) <span class="gse-tab-count">${paaCount}</span>
          </button>
          ${hasAi ? `
            <button class="gse-tab-btn ${currentTab === 'ai' ? 'active' : ''}" data-tab="ai">
              🤖 AI 概览 (SGE)
            </button>
          ` : ''}
        </div>

        <div class="gse-modal-body" id="gse-modal-table-container">
          <!-- dynamic content rendered based on currentTab -->
        </div>

        <div class="gse-modal-footer">
          <div>💡 提示：点击「复制当前 Tab」后可直接在 Excel、Google Sheets 按 Ctrl+V 完整粘贴；支持切换 Tab 查看词库与竞品产品。</div>
          <div>Keywords Everywhere + AITDK 全景提取</div>
        </div>
      </div>
    `;

    renderModalTable();
    bindModalEvents(callbacks);
  }

  function renderModalTable() {
    const container = document.getElementById('gse-modal-table-container');
    if (!container) return;

    if (currentTab === 'serp') {
      renderSerpTable(container);
    } else if (currentTab === 'keywords') {
      renderKeywordsTable(container);
    } else if (currentTab === 'products') {
      renderProductsTable(container);
    } else if (currentTab === 'ads') {
      renderAdsTable(container);
    } else if (currentTab === 'paa') {
      renderPaaTable(container);
    } else if (currentTab === 'ai') {
      renderAiOverviewTab(container);
    }
  }

  function renderSerpTable(container) {
    const items = getActiveItems();
    if (items.length === 0) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748b;">暂无自然搜索数据</div>`;
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

  function renderKeywordsTable(container) {
    const list = currentSerpData.relatedKeywords || [];
    if (list.length === 0) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748b;">本页未发现 People also search for 或相关推荐词</div>`;
      return;
    }

    let rowsHtml = list.map((item, i) => `
      <tr>
        <td style="font-weight: 700; text-align: center;">${i + 1}</td>
        <td style="font-weight: 600;">
          <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.keyword)}</a>
        </td>
        <td><span class="gse-badge">${escapeHtml(item.source)}</span></td>
        <td style="font-weight: 600; color: #0284c7;">${escapeHtml(item.volume || '-')}</td>
        <td style="color: #059669;">${escapeHtml(item.cpc || '-')}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="gse-table">
        <thead>
          <tr>
            <th>#</th>
            <th>推荐关键词 (Keyword)</th>
            <th>来源模块 (Source)</th>
            <th>预估月搜索量 (Volume)</th>
            <th>CPC 竞价成本</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  function renderProductsTable(container) {
    const list = currentSerpData.relatedProducts || [];
    if (list.length === 0) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748b;">本页未发现 Find related products & services 模块</div>`;
      return;
    }

    let rowsHtml = list.map((item, i) => `
      <tr>
        <td style="font-weight: 700; text-align: center;">${i + 1}</td>
        <td style="font-weight: 600;">
          <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a>
        </td>
        <td><code>${escapeHtml(item.merchant || '-')}</code></td>
        <td style="color: #059669; font-weight: 600;">${escapeHtml(item.price || '-')}</td>
        <td style="color: #eab308; font-weight: 600;">${escapeHtml(item.rating || '-')}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="gse-table">
        <thead>
          <tr>
            <th>#</th>
            <th>产品/服务名称 (Title)</th>
            <th>商家/品牌 (Merchant)</th>
            <th>价格 (Price)</th>
            <th>评分 (Rating)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  function renderAdsTable(container) {
    const list = currentSerpData.sponsoredAds || [];
    if (list.length === 0) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748b;">当前搜索词暂无商业广告投放</div>`;
      return;
    }

    let rowsHtml = list.map(ad => `
      <tr>
        <td style="font-weight: 700; text-align: center;">广告 ${ad.rank}</td>
        <td style="font-weight: 600;">
          <a href="${escapeHtml(ad.url)}" target="_blank">${escapeHtml(ad.title)}</a>
        </td>
        <td><code>${escapeHtml(ad.domain)}</code></td>
        <td style="max-width: 380px;" title="${escapeHtml(ad.snippet)}">${escapeHtml(ad.snippet)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="gse-table">
        <thead>
          <tr>
            <th>广告位</th>
            <th>广告标题 (Ad Title)</th>
            <th>投放商家 (Domain)</th>
            <th>广告文案摘要 (Snippet)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  function renderPaaTable(container) {
    const list = currentSerpData.peopleAlsoAsk || [];
    if (list.length === 0) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748b;">未发现 People also ask 问题</div>`;
      return;
    }

    let rowsHtml = list.map((item, i) => `
      <tr>
        <td style="font-weight: 700; text-align: center;">${i + 1}</td>
        <td style="font-weight: 600; color: #0f172a;">${escapeHtml(item.question)}</td>
        <td style="max-width: 380px;" title="${escapeHtml(item.answer)}">${escapeHtml(item.answer)}</td>
        <td>
          <a href="${escapeHtml(item.sourceUrl)}" target="_blank"><code>${escapeHtml(item.sourceDomain)}</code></a>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="gse-table">
        <thead>
          <tr>
            <th>#</th>
            <th>搜索意图提问 (Question)</th>
            <th>回答摘要 (Answer Snippet)</th>
            <th>引用网站 (Source)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  function renderAiOverviewTab(container) {
    const ai = currentSerpData.aiOverview;
    if (!ai || !ai.hasAiOverview) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748b;">本页未展示 Google AI Overview</div>`;
      return;
    }

    let sourcesHtml = (ai.citedSources || []).map(s => `
      <li style="margin-bottom: 6px;">
        <a href="${escapeHtml(s.url)}" target="_blank" style="font-weight: 600;">${escapeHtml(s.title)}</a>
        <span style="color: #64748b; font-size: 11px;">(${escapeHtml(s.domain)})</span>
      </li>
    `).join('');

    container.innerHTML = `
      <div style="padding: 20px; line-height: 1.6;">
        <h3 style="font-size: 14px; font-weight: 700; margin-bottom: 10px; color: #1e3a8a;">🤖 Google AI Overview 生成摘要</h3>
        <div style="background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 16px;">
          ${escapeHtml(ai.textSnippet)}
        </div>
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">📚 AI 引用的竞品及内容来源：</h4>
        <ul style="padding-left: 20px;">
          ${sourcesHtml || '<li>无单独卡片引用</li>'}
        </ul>
      </div>
    `;
  }

  function bindModalEvents(callbacks) {
    const modalBackdrop = document.getElementById('gse-modal-backdrop');
    const btnClose = document.getElementById('gse-modal-close');
    const btnCopyActive = document.getElementById('gse-modal-copy-active');
    const btnCsvActive = document.getElementById('gse-modal-csv-active');
    const btnExportAllJson = document.getElementById('gse-modal-export-all-json');
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

    if (btnCopyActive) {
      btnCopyActive.addEventListener('click', async () => {
        const query = (currentSerpData.query || 'serp');
        let tsv = '';
        let count = 0;

        if (currentTab === 'serp') {
          const items = getActiveItems();
          tsv = globalThis.GseExporter.itemsToTsv(items);
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
          showToast('当前 Tab 没有可复制的数据');
          return;
        }
        await globalThis.GseExporter.copyTextToClipboard(tsv);
        showToast(`✅ 已复制当前 Tab (${count} 条) 至剪贴板！可以直接粘贴进 Excel / Google 表格`);
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
          csv = globalThis.GseExporter.itemsToCsv(items);
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
          showToast('当前 Tab 没有可导出的数据');
          return;
        }
        globalThis.GseExporter.downloadFile(csv, filename, 'text/csv;charset=utf-8;');
        showToast(`✅ 已导出 ${filename}`);
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
        const filename = `SERP_Full_${query}_${new Date().toISOString().slice(0,10)}.json`;
        globalThis.GseExporter.downloadFile(json, filename, 'application/json;charset=utf-8;');
        showToast(`✅ 已导出全景 JSON 数据！`);
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
