/**
 * Google SERP & SEO Extractor - View Renderers
 * Pure rendering functions for modal tab tables and detail cards.
 * Decoupled from modal dialog lifecycle and state management.
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const domUtils = require('./dom-utils.js');
    const templates = require('./templates.js');
    module.exports = factory(domUtils, templates);
  } else {
    root.GseViewRenderers = factory(root.GseDomUtils || {}, root.GseTemplates || {});
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(domUtils, templates) {

  const escapeHtml = domUtils?.escapeHtml || function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  const emptyStateTemplate = templates?.emptyStateTemplate || (msg => `<div class="gse-empty-view">${escapeHtml(msg)}</div>`);
  const difficultyTemplate = templates?.difficultyTemplate || (() => '');
  const aiOverviewTemplate = templates?.aiOverviewTemplate || (() => '');

  /**
   * Render Natural Organic SERP Table
   */
  function renderSerpTable(container, items = [], activePluginIds = null) {
    if (!items || items.length === 0) {
      container.innerHTML = emptyStateTemplate('暂无自然搜索数据');
      return;
    }

    const activeCols = globalThis.GseExporter?.getActiveSerpColumns
      ? globalThis.GseExporter.getActiveSerpColumns(activePluginIds)
      : (globalThis.GseExporter?.GSE_SERP_COLUMNS || []);

    const thsHtml = activeCols.map(col => `<th>${escapeHtml(col.label)}</th>`).join('');

    const rowsHtml = items.map(item => {
      const cellsHtml = activeCols.map(col => {
        const val = item[col.key];
        if (col.key === 'rank') {
          return `<td class="gse-cell-rank">#${item.rank}</td>`;
        }
        if (col.key === 'page') {
          return `<td style="text-align: center;"><span class="gse-page-pill">第${item.page || 1}页</span></td>`;
        }
        if (col.key === 'pageRank') {
          return `<td class="gse-cell-pagerank">#${item.pageRank || item.rank}</td>`;
        }
        if (col.key === 'title') {
          return `<td style="font-weight: 600;" title="${escapeHtml(item.title)}"><a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a></td>`;
        }
        if (col.key === 'domain') {
          return `<td><code>${escapeHtml(item.domain)}</code></td>`;
        }
        if (col.key === 'snippet') {
          return `<td class="gse-cell-snippet" title="${escapeHtml(item.snippet)}">${escapeHtml(item.snippet)}</td>`;
        }
        if (col.key === 'mozDa') {
          return `<td class="badge-moz">${escapeHtml(val || '-')}${item.mozDaTrend ? ' (' + escapeHtml(item.mozDaTrend) + ')' : ''}</td>`;
        }
        if (col.key === 'monthlyVisits') {
          return `<td class="badge-aitdk">${escapeHtml(val || '-')}</td>`;
        }
        return `<td>${escapeHtml(val !== undefined && val !== null && val !== '' ? String(val) : '-')}</td>`;
      }).join('');
      return `<tr>${cellsHtml}</tr>`;
    }).join('');

    container.innerHTML = `
      <table class="gse-table">
        <thead>
          <tr>${thsHtml}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  /**
   * Render Related Keywords / PASF Table
   */
  function renderKeywordsTable(container, list = []) {
    if (!list || list.length === 0) {
      container.innerHTML = emptyStateTemplate('本页未发现 People also search for 或相关推荐词');
      return;
    }

    const rowsHtml = list.map((item, i) => `
      <tr>
        <td style="font-weight: 700; text-align: center;">${i + 1}</td>
        <td style="font-weight: 600;">
          <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.keyword)}</a>
        </td>
        <td><span class="gse-badge">${escapeHtml(item.source)}</span></td>
        <td class="gse-cell-volume">${escapeHtml(item.volume || '-')}</td>
        <td class="gse-cell-cpc">${escapeHtml(item.cpc || '-')}</td>
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

  /**
   * Render Related Products & Services Table
   */
  function renderProductsTable(container, list = []) {
    if (!list || list.length === 0) {
      container.innerHTML = emptyStateTemplate('本页未发现 Find related products & services 模块');
      return;
    }

    const rowsHtml = list.map((item, i) => `
      <tr>
        <td style="font-weight: 700; text-align: center;">${i + 1}</td>
        <td style="font-weight: 600;">
          <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a>
        </td>
        <td><code>${escapeHtml(item.merchant || '-')}</code></td>
        <td class="gse-cell-price">${escapeHtml(item.price || '-')}</td>
        <td class="gse-cell-rating">${escapeHtml(item.rating || '-')}</td>
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

  /**
   * Render Sponsored Ads Table
   */
  function renderAdsTable(container, list = []) {
    if (!list || list.length === 0) {
      container.innerHTML = emptyStateTemplate('当前搜索词暂无商业广告投放');
      return;
    }

    const rowsHtml = list.map(ad => `
      <tr>
        <td style="font-weight: 700; text-align: center;">广告 ${ad.rank}</td>
        <td style="font-weight: 600;">
          <a href="${escapeHtml(ad.url)}" target="_blank">${escapeHtml(ad.title)}</a>
        </td>
        <td><code>${escapeHtml(ad.domain)}</code></td>
        <td class="gse-cell-wide" title="${escapeHtml(ad.snippet)}">${escapeHtml(ad.snippet)}</td>
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

  /**
   * Render People Also Ask (PAA) Table
   */
  function renderPaaTable(container, list = []) {
    if (!list || list.length === 0) {
      container.innerHTML = emptyStateTemplate('未发现 People also ask 问题');
      return;
    }

    const rowsHtml = list.map((item, i) => `
      <tr>
        <td style="font-weight: 700; text-align: center;">${i + 1}</td>
        <td style="font-weight: 600; color: #0f172a;">${escapeHtml(item.question)}</td>
        <td class="gse-cell-wide" title="${escapeHtml(item.answer)}">${escapeHtml(item.answer)}</td>
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

  /**
   * Render SEO Difficulty Tab
   */
  function renderDifficultyTab(container, diff = {}) {
    container.innerHTML = difficultyTemplate(diff);
  }

  /**
   * Render AI Overview Tab
   */
  function renderAiOverviewTab(container, ai = {}) {
    if (!ai || !ai.hasAiOverview) {
      container.innerHTML = emptyStateTemplate('本页未展示 Google AI Overview');
      return;
    }
    container.innerHTML = aiOverviewTemplate(ai);
  }

  return {
    renderSerpTable,
    renderKeywordsTable,
    renderProductsTable,
    renderAdsTable,
    renderPaaTable,
    renderDifficultyTab,
    renderAiOverviewTab
  };
});
