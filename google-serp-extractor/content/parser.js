/**
 * Google SERP & SEO Extractor - Core SERP Parser & Orchestrator
 * Coordinates Google organic results parsing, pagination, multi-page data accumulation,
 * third-party plugin metrics extraction, and SERP landscape features.
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const domUtils = require('./dom-utils.js');
    const pluginAdapters = require('./plugin-adapters.js');
    const serpModules = require('./serp-modules.js');
    module.exports = factory(domUtils, pluginAdapters, serpModules);
  } else {
    root.GseParser = factory(
      root.GseDomUtils || {},
      root.GsePluginAdapters || {},
      root.GseSerpModules || {}
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(domUtils, pluginAdapters, serpModules) {

  const {
    cleanInjectedText,
    isSpecialModuleHeading,
    normalizeGoogleUrl,
    isInternalGoogleUrl,
    extractDomain,
    escapeHtml
  } = domUtils || {};

  const {
    PluginRegistry,
    KeywordsEverywhereAdapter,
    AitdkAdapter,
    extractKeywordsEverywhereMetrics,
    extractAitdkMetrics,
    extractSeoDifficulty,
    assessPluginReadiness
  } = pluginAdapters || {};

  const {
    extractRelatedKeywords,
    extractRelatedProducts,
    extractPeopleAlsoAsk,
    extractSponsoredAds,
    extractAiOverview,
    extractDiscussions
  } = serpModules || {};

  /**
   * Extract current search query from Google page
   */
  function extractSearchQuery(doc = document) {
    try {
      const url = new URL(doc.location?.href || 'https://www.google.com/search');
      const q = url.searchParams.get('q');
      if (q) return q.trim();
    } catch (e) {}

    const input = doc.querySelector('textarea[name="q"], input[name="q"], input[type="text"][aria-label*="Search"]');
    if (input && input.value) return input.value.trim();

    const titleMatch = doc.title ? doc.title.replace(/\s*-\s*Google\s*(Search)?$/i, '').trim() : '';
    return titleMatch || '';
  }

  /**
   * Extract Google Search Result Stats: e.g. "About 18,300 results (0.17 seconds)"
   */
  function extractResultStats(doc = document) {
    const statsEl = doc.querySelector('#result-stats, div[id="result-stats"], .result-stats');
    const raw = statsEl ? statsEl.textContent.trim() : '';

    let totalResults = null;
    let searchTimeSeconds = null;

    if (raw) {
      const countMatch = raw.match(/(?:About|约|Approximately|Over)?\s*([0-9\s,\.]+)\s*(?:results|条结果|条)/i);
      if (countMatch) {
        const cleaned = countMatch[1].replace(/[,.\s]/g, '');
        const num = parseInt(cleaned, 10);
        if (!isNaN(num)) totalResults = num;
      }

      const timeMatch = raw.match(/[\(（](?:用时\s*)?([0-9\.]+)\s*(?:seconds|second|s|秒)[\)）]/i);
      if (timeMatch) {
        const sec = parseFloat(timeMatch[1]);
        if (!isNaN(sec)) searchTimeSeconds = sec;
      }
    }

    return {
      raw: raw || '',
      totalResults,
      searchTimeSeconds
    };
  }

  /**
   * Extract overall search volume / CPC widget injected by Keywords Everywhere
   */
  function extractPageVolumeInfo(doc = document) {
    const candidates = [
      '#xt-google-query',
      '.xt-google-query',
      '#xt-ke-volume',
      '.xt-ke-volume',
      'div[id*="xt-ke"]',
      'div[class*="xt-ke"]'
    ];
    for (const sel of candidates) {
      const el = doc.querySelector(sel);
      if (el && /Volume:|CPC:|Competition:/i.test(el.textContent)) {
        return el.textContent.replace(/\s+/g, ' ').trim();
      }
    }

    const allDivs = doc.querySelectorAll('#searchform, #top_nav, #appbar, #extabar, header, [role="search"]');
    for (const container of allDivs) {
      const match = container.innerText?.match(/(Volume:\s*[^\|]+?\|\s*CPC:\s*[^\|]+?\|\s*Competition:\s*[^\n\r]+)/i);
      if (match) return match[1].replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  /**
   * Find candidate organic result containers on Google Search
   */
  function findResultContainers(doc = document) {
    const items = [];
    const seenUrls = new Set();

    // Strategy 1: Find valid organic search headings (h3) and trace up to item root
    const headings = doc.querySelectorAll('#search h3, #rso h3, #center_col h3, .g h3');
    for (const h3 of headings) {
      if (isSpecialModuleHeading && isSpecialModuleHeading(h3)) continue;

      const anchor = h3.closest('a');
      if (!anchor || !anchor.href) continue;

      let rawUrl = anchor.href;
      let targetUrl = normalizeGoogleUrl ? normalizeGoogleUrl(rawUrl) : rawUrl;

      if (!targetUrl || targetUrl.startsWith('#') || (isInternalGoogleUrl && isInternalGoogleUrl(targetUrl))) {
        continue;
      }

      if (seenUrls.has(targetUrl)) continue;

      const container = findContainerForHeading(h3, doc);
      if (container) {
        seenUrls.add(targetUrl);
        items.push({ heading: h3, anchor, targetUrl, container });
      }
    }

    // Fallback Strategy 2: If h3 approach missed anything, check standard .g blocks
    if (items.length === 0) {
      const gBlocks = doc.querySelectorAll('.g, .Gx5Zad, div[data-hveid]');
      for (const g of gBlocks) {
        const h3 = g.querySelector('h3');
        if (h3 && isSpecialModuleHeading && isSpecialModuleHeading(h3)) continue;

        const anchor = h3 ? h3.closest('a') : g.querySelector('a[href]');
        if (!anchor || !anchor.href) continue;

        const targetUrl = normalizeGoogleUrl ? normalizeGoogleUrl(anchor.href) : anchor.href;
        if (!targetUrl || (isInternalGoogleUrl && isInternalGoogleUrl(targetUrl)) || seenUrls.has(targetUrl)) continue;

        seenUrls.add(targetUrl);
        items.push({ heading: h3, anchor, targetUrl, container: g });
      }
    }

    return items;
  }

  function findContainerForHeading(h3, doc) {
    const mjj = typeof h3.closest === 'function' ? h3.closest('.MjjYud') : null;
    if (mjj) return mjj;

    const g = typeof h3.closest === 'function' ? h3.closest('.g') : null;
    if (g) return g;

    let cur = h3.parentElement;
    let depth = 0;
    let best = null;
    while (cur && cur !== doc.body && depth < 8) {
      if (cur.matches && (cur.matches('.g-blk') || cur.getAttribute('data-hveid') || cur.getAttribute('jscontroller'))) {
        best = cur;
      }
      cur = cur.parentElement;
      depth++;
    }
    return best || h3.parentElement?.parentElement || h3;
  }

  function extractSnippet(container) {
    const snippetEl = container.querySelector('.VwiC3b, [data-sncf], [data-content-feature="1"], .yXK7lf');
    if (snippetEl) {
      return cleanInjectedText ? cleanInjectedText(snippetEl.textContent) : snippetEl.textContent.trim();
    }

    const em = container.querySelector('em');
    if (em && em.parentElement) {
      return cleanInjectedText ? cleanInjectedText(em.parentElement.textContent) : em.parentElement.textContent.trim();
    }

    return '';
  }

  /**
   * Extract pagination information from URL and DOM
   */
  function extractPageInfo(doc = document, currentUrl = '') {
    let urlStr = currentUrl;
    if (!urlStr && typeof window !== 'undefined' && window.location) {
      urlStr = window.location.href;
    }

    let startOffset = 0;
    let pageNumber = 1;

    if (urlStr) {
      try {
        const u = new URL(urlStr);
        const startParam = u.searchParams.get('start');
        if (startParam !== null) {
          const parsedStart = parseInt(startParam, 10);
          if (!isNaN(parsedStart) && parsedStart >= 0) {
            startOffset = parsedStart;
            pageNumber = Math.floor(parsedStart / 10) + 1;
          }
        }
      } catch (e) {}
    }

    if (pageNumber === 1 && doc && typeof doc.querySelector === 'function') {
      const curEl = doc.querySelector('td.cur, [aria-current="page"], .YyVfkd');
      if (curEl) {
        const n = parseInt(curEl.textContent.trim(), 10);
        if (!isNaN(n) && n > 0) {
          pageNumber = n;
          startOffset = (n - 1) * 10;
        }
      }
    }

    return {
      pageNumber,
      startOffset,
      isFirstPage: pageNumber === 1
    };
  }

  /**
   * Merge multi-page SERP data items, deduplicating by URL and sorting by rank
   */
  function mergeMultiPageData(existingData, newData) {
    if (!existingData || !existingData.items || existingData.items.length === 0) {
      return newData;
    }
    if (!newData || !newData.items || newData.items.length === 0) {
      return existingData;
    }

    // Merge items
    const itemMap = new Map();
    for (const item of existingData.items) {
      itemMap.set(item.url, item);
    }
    for (const item of newData.items) {
      if (itemMap.has(item.url)) {
        const existing = itemMap.get(item.url);

        const mergedPluginMetrics = {
          ...(existing.pluginMetrics || {}),
          ...(item.pluginMetrics || {})
        };
        for (const [pId] of Object.entries(mergedPluginMetrics)) {
          const exMetrics = existing.pluginMetrics?.[pId] || {};
          const newMetrics = item.pluginMetrics?.[pId] || {};
          mergedPluginMetrics[pId] = { ...exMetrics, ...newMetrics };
        }

        itemMap.set(item.url, {
          ...existing,
          ...item,
          pluginMetrics: mergedPluginMetrics,
          rank: item.rank || existing.rank,
          page: item.page || existing.page,
          pageRank: item.pageRank || existing.pageRank,
          monthlyVisits: item.monthlyVisits || existing.monthlyVisits || '',
          avgDuration: item.avgDuration || existing.avgDuration || '',
          domainCreated: item.domainCreated || existing.domainCreated || '',
          aitdkReady: item.aitdkReady || existing.aitdkReady || false,
          mozDa: item.mozDa || existing.mozDa || '',
          mozDaTrend: item.mozDaTrend || existing.mozDaTrend || '',
          refDom: item.refDom || existing.refDom || '',
          refLinks: item.refLinks || existing.refLinks || '',
          spamScore: item.spamScore || existing.spamScore || '',
          pageTraffic: item.pageTraffic || existing.pageTraffic || '',
          siteTraffic: item.siteTraffic || existing.siteTraffic || '',
          pageKeywords: item.pageKeywords || existing.pageKeywords || '',
          siteKeywords: item.siteKeywords || existing.siteKeywords || '',
          keReady: item.keReady || existing.keReady || false
        });
      } else {
        itemMap.set(item.url, item);
      }
    }

    const mergedItems = Array.from(itemMap.values()).sort((a, b) => (a.rank || 0) - (b.rank || 0));

    // Merge related keywords
    const kwMap = new Map();
    for (const k of (existingData.relatedKeywords || [])) {
      kwMap.set(k.keyword.toLowerCase(), k);
    }
    for (const k of (newData.relatedKeywords || [])) {
      kwMap.set(k.keyword.toLowerCase(), k);
    }
    const mergedKeywords = Array.from(kwMap.values());

    // Merge products
    const prodMap = new Map();
    for (const p of (existingData.relatedProducts || [])) {
      prodMap.set((p.title || '') + (p.merchant || ''), p);
    }
    for (const p of (newData.relatedProducts || [])) {
      prodMap.set((p.title || '') + (p.merchant || ''), p);
    }
    const mergedProducts = Array.from(prodMap.values());

    // Merge PAA
    const paaMap = new Map();
    for (const q of (existingData.peopleAlsoAsk || [])) {
      paaMap.set(q.question, q);
    }
    for (const q of (newData.peopleAlsoAsk || [])) {
      paaMap.set(q.question, q);
    }
    const mergedPaa = Array.from(paaMap.values());

    // Merge Ads
    const adsMap = new Map();
    for (const ad of (existingData.sponsoredAds || [])) {
      adsMap.set(ad.url || ad.title, ad);
    }
    for (const ad of (newData.sponsoredAds || [])) {
      adsMap.set(ad.url || ad.title, ad);
    }
    const mergedAds = Array.from(adsMap.values());

    const collectedPages = Array.from(new Set(mergedItems.map(i => i.page || 1))).sort((a, b) => a - b);

    return {
      ...newData,
      query: newData.query || existingData.query,
      isAccumulated: true,
      collectedPages,
      totalFound: mergedItems.length,
      items: mergedItems,
      relatedKeywords: mergedKeywords,
      longTailKeywords: mergedKeywords.filter(k => k.source.includes('Long-Tail')),
      trendingKeywords: mergedKeywords.filter(k => k.source.includes('Trending')),
      seoDifficulty: (newData.seoDifficulty && newData.seoDifficulty.hasDifficulty) ? newData.seoDifficulty : (existingData.seoDifficulty || newData.seoDifficulty || {}),
      relatedProducts: mergedProducts,
      peopleAlsoAsk: mergedPaa,
      sponsoredAds: mergedAds
    };
  }

  /**
   * Main parsing function: extract all SERP items + SEO metrics + landscape modules
   */
  function parseCurrentPage(doc = document, options = {}) {
    const currentUrl = options.currentUrl || '';
    const pageInfo = extractPageInfo(doc, currentUrl);
    const query = extractSearchQuery(doc);
    const resultStats = extractResultStats(doc);
    const pageVolumeInfo = extractPageVolumeInfo(doc);
    const containers = findResultContainers(doc);

    // Detect active third-party plugin adapters
    const activeAdapters = PluginRegistry?.getDetected ? PluginRegistry.getDetected(doc, []) : [];
    const activePluginIds = activeAdapters.map(a => a.id);

    const items = [];
    let pageRank = 1;
    let aitdkReadyCount = 0;
    let keReadyCount = 0;

    for (const item of containers) {
      const title = item.heading?.textContent?.trim() || '';
      const url = item.targetUrl;
      const domain = extractDomain ? extractDomain(url) : '';
      const snippet = extractSnippet(item.container);
      const globalRank = pageInfo.startOffset + pageRank;

      const itemData = {
        id: `serp_${globalRank}_${domain}`,
        rank: globalRank,
        page: pageInfo.pageNumber,
        pageRank: pageRank++,
        query,
        title,
        url,
        domain,
        snippet,
        pageVolumeInfo,
        resultStatsRaw: resultStats.raw,
        pluginMetrics: {},
        scrapedAt: new Date().toLocaleString()
      };

      // Safely extract metrics via each detected adapter
      for (const adapter of activeAdapters) {
        try {
          if (typeof adapter.extractItemMetrics === 'function') {
            const res = adapter.extractItemMetrics(item.container, item.cardScope);
            if (res && res.metrics) {
              itemData.pluginMetrics[adapter.id] = res.metrics;
              Object.assign(itemData, res.metrics);
            }
          }
        } catch (err) {
          console.warn(`[GSE] Error running extractItemMetrics for ${adapter.id}:`, err);
        }
      }

      if (itemData.aitdkReady) aitdkReadyCount++;
      if (itemData.keReady) keReadyCount++;

      items.push(itemData);
    }

    // Extended modules
    const allKeywords = extractRelatedKeywords ? extractRelatedKeywords(doc) : [];
    const seoDifficulty = extractSeoDifficulty ? extractSeoDifficulty(doc) : {};
    const relatedProducts = extractRelatedProducts ? extractRelatedProducts(doc) : [];
    const peopleAlsoAsk = extractPeopleAlsoAsk ? extractPeopleAlsoAsk(doc) : [];
    const sponsoredAds = extractSponsoredAds ? extractSponsoredAds(doc) : [];
    const aiOverview = extractAiOverview ? extractAiOverview(doc) : {};
    const discussions = extractDiscussions ? extractDiscussions(doc) : [];

    // Assess plugin readiness dynamically across detected adapters
    const readiness = assessPluginReadiness
      ? assessPluginReadiness(doc, items, activeAdapters)
      : { isSettled: true, state: 'NO_PLUGINS', plugins: {}, activePlugins: [] };

    return {
      query,
      pageInfo,
      resultStats,
      pageVolumeInfo,
      totalFound: items.length,
      activePluginIds,
      aitdkReadyCount,
      keReadyCount,
      isFullyReady: readiness.isSettled,
      readiness,
      items,
      relatedKeywords: allKeywords,
      longTailKeywords: allKeywords.filter(k => k.source.includes('Long-Tail')),
      trendingKeywords: allKeywords.filter(k => k.source.includes('Trending')),
      seoDifficulty,
      relatedProducts,
      peopleAlsoAsk,
      sponsoredAds,
      aiOverview,
      discussions
    };
  }

  return {
    // Re-exports from domUtils
    escapeHtml,
    cleanInjectedText,
    isSpecialModuleHeading,
    normalizeGoogleUrl,
    isInternalGoogleUrl,
    extractDomain,

    // Re-exports from pluginAdapters
    PluginRegistry,
    KeywordsEverywhereAdapter,
    AitdkAdapter,
    extractKeywordsEverywhereMetrics,
    extractAitdkMetrics,
    extractSeoDifficulty,
    assessPluginReadiness,

    // Re-exports from serpModules
    extractRelatedKeywords,
    extractRelatedProducts,
    extractPeopleAlsoAsk,
    extractSponsoredAds,
    extractAiOverview,
    extractDiscussions,

    // Core SERP parser
    extractSearchQuery,
    extractResultStats,
    extractPageVolumeInfo,
    findResultContainers,
    findContainerForHeading,
    extractSnippet,
    extractPageInfo,
    mergeMultiPageData,
    parseCurrentPage
  };
});
