/**
 * Google SERP & SEO Extractor - HTML Templates
 * Declarative HTML markup templates separated from JavaScript logic and styling.
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const domUtils = require('./dom-utils.js');
    module.exports = factory(domUtils);
  } else {
    root.GseTemplates = factory(root.GseDomUtils || {});
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(domUtils) {

  const escapeHtml = domUtils?.escapeHtml || function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /**
   * Floating Capsule markup template
   */
  function capsuleTemplate({ isMinimized, statsStr, badgeClass, badgeText, badgeTitle, accBtnText, isAccumulateMode }) {
    return `
      <div class="gse-toast" id="gse-toast"></div>
      <div class="gse-capsule ${isMinimized ? 'minimized' : ''}" id="gse-capsule">
        <div class="gse-brand" id="gse-btn-brand" title="点击切换展开/折叠">
          <div class="gse-brand-icon">G</div>
          <span class="gse-brand-title">SERP SEO</span>
        </div>

        ${!isMinimized ? `
          <div class="gse-badge ${badgeClass}" title="${escapeHtml(badgeTitle)}">
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

          <button class="gse-btn gse-btn-relay" id="gse-btn-sync-db" title="推送当前搜索数据至本地数据库 (127.0.0.1:9090)">
            <span>🚀 存入数据库</span>
          </button>
        ` : `
          <div class="gse-badge ${badgeClass}">${statsStr}</div>
        `}

        <button class="gse-btn gse-btn-icon" id="gse-btn-toggle-min" title="${isMinimized ? '展开' : '折叠'}">
          <span>${isMinimized ? '◀' : '✕'}</span>
        </button>
      </div>
    `;
  }

  /**
   * Fullscreen Modal Framework markup template
   */
  function modalFrameworkTemplate({
    query,
    pageNum,
    isMultiPage,
    collectedPages,
    resultStatsRaw,
    isAccumulateMode,
    currentTab,
    counts,
    hasDifficulty,
    hasAi
  }) {
    return `
      <div class="gse-modal">
        <div class="gse-modal-header">
          <div class="gse-modal-title">
            <div class="gse-brand-icon">G</div>
            <span>全景 SERP & SEO 数据 - 关键词: "${escapeHtml(query || '未命名')}"</span>
            <span class="gse-page-pill">第 ${pageNum} 页</span>
            ${isMultiPage ? `<span class="gse-badge ready">(跨页累积 ${collectedPages.length} 页: P${collectedPages.join(', P')})</span>` : ''}
            ${resultStatsRaw ? `<span style="font-size: 11px; font-weight: normal; color: #64748b; margin-left: 6px;">(${escapeHtml(resultStatsRaw)})</span>` : ''}
          </div>
          <div class="gse-modal-controls">
            <button class="gse-btn gse-btn-success" id="gse-modal-copy-active">📋 复制当前 Tab</button>
            <button class="gse-btn gse-btn-primary" id="gse-modal-csv-active">📥 导出当前 CSV</button>
            <button class="gse-btn" id="gse-modal-export-all-json">📦 导出全景 JSON</button>
            <button class="gse-btn gse-btn-relay" id="gse-modal-sync-db" title="推送数据至本地数据库 (127.0.0.1:9090)">🚀 存入数据库</button>
            <button class="gse-btn ${isAccumulateMode ? 'gse-btn-primary' : ''}" id="gse-modal-toggle-acc" title="切换多页累积模式">${isAccumulateMode ? '🟢 累积模式: 开' : '⚪ 累积模式: 关'}</button>
            ${(isAccumulateMode || isMultiPage) ? '<button class="gse-btn" id="gse-modal-clear-acc" title="清空跨页累积数据">🗑️ 清空累积</button>' : ''}
            <button class="gse-btn" id="gse-modal-close" style="font-size: 14px; font-weight: bold;">✕</button>
          </div>
        </div>

        <!-- Navigation Tabs Bar -->
        <div class="gse-tabs-bar">
          <button class="gse-tab-btn ${currentTab === 'serp' ? 'active' : ''}" data-tab="serp">
            🏆 自然搜索结果 <span class="gse-tab-count">${counts.serp}</span>
          </button>
          <button class="gse-tab-btn ${currentTab === 'keywords' ? 'active' : ''}" data-tab="keywords">
            💡 搜索词库 (PASF / 相关词) <span class="gse-tab-count">${counts.keywords}</span>
          </button>
          <button class="gse-tab-btn ${currentTab === 'products' ? 'active' : ''}" data-tab="products">
            🛍️ 竞品产品与服务 <span class="gse-tab-count">${counts.products}</span>
          </button>
          <button class="gse-tab-btn ${currentTab === 'ads' ? 'active' : ''}" data-tab="ads">
            📢 商业竞价广告 <span class="gse-tab-count">${counts.ads}</span>
          </button>
          <button class="gse-tab-btn ${currentTab === 'paa' ? 'active' : ''}" data-tab="paa">
            ❓ 意图问答 (PAA) <span class="gse-tab-count">${counts.paa}</span>
          </button>
          ${hasDifficulty ? `
            <button class="gse-tab-btn ${currentTab === 'difficulty' ? 'active' : ''}" data-tab="difficulty">
              📊 SEO 难度与趋势
            </button>
          ` : ''}
          ${hasAi ? `
            <button class="gse-tab-btn ${currentTab === 'ai' ? 'active' : ''}" data-tab="ai">
              🤖 AI 概览 (SGE)
            </button>
          ` : ''}
        </div>

        <div class="gse-modal-body" id="gse-modal-table-container"></div>

        <div class="gse-modal-footer">
          <div>💡 提示：点击「复制当前 Tab」后可直接在 Excel、Google Sheets 按 Ctrl+V 完整粘贴；支持切换 Tab 查看词库、竞品与 SEO 指标。</div>
          <div>Keywords Everywhere + AITDK 全景提取</div>
        </div>
      </div>
    `;
  }

  /**
   * SEO Difficulty Tab markup template
   */
  function difficultyTemplate(diff = {}) {
    return `
      <div class="gse-difficulty-container">
        <h3 class="gse-difficulty-heading">📊 Keywords Everywhere SEO 难度评估指标</h3>
        <div class="gse-difficulty-grid">
          <div class="gse-diff-card">
            <div class="gse-diff-val blue">${escapeHtml(diff.seoDifficulty || '-')}</div>
            <div class="gse-diff-label">SEO 整体难度 (SEO Difficulty)</div>
          </div>
          <div class="gse-diff-card">
            <div class="gse-diff-val green">${escapeHtml(diff.brandQuery || '-')}</div>
            <div class="gse-diff-label">是否品牌词 (Brand Query)</div>
          </div>
          <div class="gse-diff-card">
            <div class="gse-diff-val amber">${escapeHtml(diff.offPageDifficulty || '-')}</div>
            <div class="gse-diff-label">站外难度 (Off-Page Difficulty)</div>
          </div>
          <div class="gse-diff-card">
            <div class="gse-diff-val purple">${escapeHtml(diff.onPageDifficulty || '-')}</div>
            <div class="gse-diff-label">站内难度 (On-Page Difficulty)</div>
          </div>
        </div>
        ${diff.longTailPrompt ? `
          <div class="gse-trend-box" style="margin-top:12px;border-left:3px solid #2563eb;">
            <h4 class="gse-trend-heading" style="color:#2563eb;">💡 长尾词探索提示 (Long-tail Keywords Prompt)</h4>
            <div class="gse-trend-desc" style="font-weight:600;color:#1e293b;">${escapeHtml(diff.longTailPrompt)}</div>
          </div>
        ` : ''}
        ${diff.trendTitle ? `
          <div class="gse-trend-box">
            <h4 class="gse-trend-heading">📈 全球搜索趋势 (Trend Data)</h4>
            <div class="gse-trend-desc">${escapeHtml(diff.trendTitle)}</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Google AI Overview Tab markup template
   */
  function aiOverviewTemplate(ai = {}) {
    const sourcesHtml = (ai.citedSources || []).map(s => `
      <li class="gse-ai-source-item">
        <a href="${escapeHtml(s.url)}" target="_blank" style="font-weight: 600;">${escapeHtml(s.title)}</a>
        <span class="gse-ai-source-domain">(${escapeHtml(s.domain)})</span>
      </li>
    `).join('');

    return `
      <div class="gse-ai-container">
        <h3 class="gse-ai-heading">🤖 Google AI Overview 生成摘要</h3>
        <div class="gse-ai-summary-box">
          ${escapeHtml(ai.textSnippet || '')}
        </div>
        <h4 class="gse-ai-sources-title">📚 AI 引用的竞品及内容来源：</h4>
        <ul class="gse-ai-sources-list">
          ${sourcesHtml || '<li>无单独卡片引用</li>'}
        </ul>
      </div>
    `;
  }

  /**
   * Empty state template
   */
  function emptyStateTemplate(message) {
    return `<div class="gse-empty-view">${escapeHtml(message)}</div>`;
  }

  return {
    capsuleTemplate,
    modalFrameworkTemplate,
    difficultyTemplate,
    aiOverviewTemplate,
    emptyStateTemplate
  };
});
