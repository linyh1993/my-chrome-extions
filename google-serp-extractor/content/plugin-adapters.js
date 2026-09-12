/**
 * Google SERP & SEO Extractor - Plugin Adapter Architecture & Registry
 * Decouples core SERP engine from third-party SEO extensions (AITDK, Keywords Everywhere, etc.).
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const domUtils = require('./dom-utils.js');
    module.exports = factory(domUtils);
  } else {
    root.GsePluginAdapters = factory(root.GseDomUtils || {});
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(domUtils) {

  const { cleanInjectedText, normalizeGoogleUrl, extractDomain } = domUtils || {};

  /**
   * Plugin Adapter Registry
   */
  const PluginRegistry = {
    _adapters: new Map(),

    register(adapter) {
      if (!adapter || !adapter.id) {
        throw new Error('Invalid plugin adapter: missing id');
      }
      this._adapters.set(adapter.id, adapter);
      if (typeof globalThis !== 'undefined' && globalThis.GseExporter && adapter.columns) {
        globalThis.GseExporter.registerPluginColumns?.(adapter.id, adapter.columns);
      }
      return this;
    },

    unregister(adapterId) {
      this._adapters.delete(adapterId);
    },

    get(id) {
      return this._adapters.get(id);
    },

    getAll() {
      return Array.from(this._adapters.values());
    },

    getDetected(doc = document, items = []) {
      const detected = [];
      for (const adapter of this._adapters.values()) {
        try {
          if (typeof adapter.detect === 'function' && adapter.detect(doc, items)) {
            detected.push(adapter);
          }
        } catch (e) {
          console.warn(`[GSE] Error detecting plugin ${adapter.id}:`, e);
        }
      }
      return detected;
    }
  };

  /**
   * Keywords Everywhere text parser
   */
  function parseKeText(text, res) {
    const mozMatch = text.match(/MOZ\s*DA:\s*([0-9\.\-]+(?:\/\d+)?)\s*(?:\(([^)]+)\))?/i);
    if (mozMatch) {
      res.mozDa = mozMatch[1].trim();
      if (mozMatch[2]) res.mozDaTrend = mozMatch[2].trim();
      res.keReady = true;
    }

    const refDomMatch = text.match(/Ref\s*Dom:\s*([0-9\.\w\-]+)/i);
    if (refDomMatch) {
      res.refDom = refDomMatch[1].trim();
      res.keReady = true;
    }

    const refLinksMatch = text.match(/Ref\s*Links:\s*([0-9\.\w\-]+)/i);
    if (refLinksMatch) {
      res.refLinks = refLinksMatch[1].trim();
      res.keReady = true;
    }

    const spamMatch = text.match(/Spam\s*Score:\s*([0-9\.\%\-]+)/i);
    if (spamMatch) {
      res.spamScore = spamMatch[1].trim();
      res.keReady = true;
    }

    const trafMatch = text.match(/Search\s*traffic\s*(?:\([^)]+\))?:\s*([^\–\-\n\r]+?)(?=\s*-\s*Keywords|\s*$|\n|\r)/i);
    if (trafMatch) {
      const rawTraf = trafMatch[1].trim();
      const webTrafMatch = rawTraf.match(/(.*?)\s*\(website:\s*([^)]+)\)/i);
      if (webTrafMatch) {
        res.pageTraffic = webTrafMatch[1].trim();
        res.siteTraffic = webTrafMatch[2].trim();
      } else {
        res.pageTraffic = rawTraf;
        res.siteTraffic = rawTraf;
      }
      res.keReady = true;
    }

    const kwMatch = text.match(/Keywords\s*(?:\([^)]+\))?:\s*([^\n\r]+?)(?=\s*(?:There\s*are|Use\s*our|ZeroGPT|See\s*the|$|\n|\r))/i);
    if (kwMatch) {
      const rawKw = kwMatch[1].trim();
      const webKwMatch = rawKw.match(/(.*?)\s*\(website:\s*([^)]+)\)/i);
      if (webKwMatch) {
        res.pageKeywords = webKwMatch[1].trim();
        res.siteKeywords = webKwMatch[2].trim();
      } else {
        res.pageKeywords = rawKw;
        res.siteKeywords = rawKw;
      }
      res.keReady = true;
    }
  }

  /**
   * Extract Keywords Everywhere metrics from container
   */
  function extractKeywordsEverywhereMetrics(container) {
    const res = {
      mozDa: '',
      mozDaTrend: '',
      refDom: '',
      refLinks: '',
      spamScore: '',
      pageTraffic: '',
      siteTraffic: '',
      pageKeywords: '',
      siteKeywords: '',
      topKeywordsNote: '',
      keReady: false
    };

    const domainMetricsEl = container.querySelector('.xt-google-domain-link-metrics, .xt-google-domain-link-metrics-root') ||
                            container.parentElement?.querySelector('.xt-google-domain-link-metrics');
    const urlMetricsEl = container.querySelector('.xt-google-url-metrics') ||
                         container.parentElement?.querySelector('.xt-google-url-metrics');
    const topKeywordsEl = container.querySelector('.xt-google-top-keywords-root, .xt-google-top-keywords-line') ||
                          container.parentElement?.querySelector('.xt-google-top-keywords-root');

    const keText = [
      domainMetricsEl?.textContent || '',
      urlMetricsEl?.textContent || '',
      topKeywordsEl?.textContent || ''
    ].join(' ');

    if (!keText.trim()) {
      const allText = container.textContent || '';
      if (/MOZ DA:|Search traffic/i.test(allText)) {
        parseKeText(allText, res);
      }
    } else {
      res.keReady = true;
      parseKeText(keText, res);
    }

    if (topKeywordsEl) {
      res.topKeywordsNote = topKeywordsEl.textContent.replace(/\s+/g, ' ').trim();
    }

    return res;
  }

  /**
   * Extract Keywords Everywhere SEO Difficulty & Trend Cards
   */
  function extractSeoDifficulty(doc = document) {
    const res = {
      hasDifficulty: false,
      seoDifficulty: '',
      brandQuery: '',
      offPageDifficulty: '',
      onPageDifficulty: '',
      trendTitle: ''
    };

    const diffEl = doc.querySelector('#xt-difficulty-root') ||
                   Array.from(doc.querySelectorAll('div, [role="region"]')).find(el => /SEO\s*Difficulty/i.test(el.textContent));

    if (diffEl) {
      const text = diffEl.textContent || '';
      res.hasDifficulty = true;

      const diffMatch = text.match(/SEO\s*Difficulty\s*([0-9\.\/]+)/i);
      if (diffMatch) res.seoDifficulty = diffMatch[1].trim();

      const brandMatch = text.match(/Brand\s*Query\s*(Yes|No)/i);
      if (brandMatch) res.brandQuery = brandMatch[1].trim();

      const offMatch = text.match(/Off-Page\s*Difficulty\s*([0-9\.\/]+)/i);
      if (offMatch) res.offPageDifficulty = offMatch[1].trim();

      const onMatch = text.match(/On-Page\s*Difficulty\s*([0-9\.\/]+)/i);
      if (onMatch) res.onPageDifficulty = onMatch[1].trim();
    }

    const trendEl = doc.querySelector('#xt-trend-chart-root') ||
                    Array.from(doc.querySelectorAll('div, [role="region"]')).find(el => /Trend Data For/i.test(el.textContent));
    if (trendEl) {
      const t = trendEl.textContent.match(/Trend Data For [^\n\r]+/i);
      if (t) res.trendTitle = t[0].replace(/\s+/g, ' ').trim();
    }

    return res;
  }

  /**
   * Extract AITDK SEO metrics from container, card scope (.MjjYud) or adjacent siblings
   */
  function extractAitdkMetrics(container) {
    const res = {
      monthlyVisits: '',
      avgDuration: '',
      domainCreated: '',
      aitdkReady: false,
      aitdkLoading: false
    };

    if (!container) return res;

    const cardScope = (typeof container.closest === 'function' ? container.closest('.MjjYud') : null) ||
                      (typeof container.closest === 'function' ? container.closest('#rso > div') : null) ||
                      container.parentElement ||
                      container;

    // 1. Selector-based lookup for AITDK elements
    let aitdkEl = container.querySelector?.('.aitdk-site-metrics, .aitdk-site-metrics-container, [class*="aitdk"], [id*="aitdk"]') ||
                  cardScope.querySelector?.('.aitdk-site-metrics, .aitdk-site-metrics-container, [class*="aitdk"], [id*="aitdk"]');

    // 2. Sibling inspection (in case AITDK was inserted right after container)
    if (!aitdkEl && container.nextElementSibling) {
      let sib = container.nextElementSibling;
      for (let i = 0; i < 3 && sib; i++) {
        const sibText = sib.textContent || '';
        if (sib.matches?.('[class*="aitdk"], [id*="aitdk"]') || sibText.includes('AITDK') || sibText.includes('Monthly Visits:')) {
          aitdkEl = sib;
          break;
        }
        sib = sib.nextElementSibling;
      }
    }

    // 3. Fallback: inspect any elements inside cardScope containing "AITDK" or "Monthly Visits"
    if (!aitdkEl && cardScope.querySelectorAll) {
      const candidates = cardScope.querySelectorAll('div, span, p, section');
      for (const el of candidates) {
        const t = el.textContent || '';
        if (t.includes('AITDK') || (t.includes('Monthly Visits:') && t.includes('Domain Created:'))) {
          aitdkEl = el;
          break;
        }
      }
    }

    // 4. Gather text
    let text = aitdkEl ? aitdkEl.textContent : '';
    if (!text && cardScope) {
      const full = cardScope.textContent || '';
      if (full.includes('AITDK') || full.includes('Monthly Visits:')) {
        text = full;
      }
    }
    if (!text && container.textContent) {
      text = container.textContent;
    }

    // Check loading indicator
    if (aitdkEl && (aitdkEl.querySelector?.('.aitdk-dots-loading, .loading, [class*="loading"]') ||
        aitdkEl.classList?.contains?.('loading') ||
        aitdkEl.classList?.contains?.('aitdk-dots-loading'))) {
      res.aitdkLoading = true;
    }

    const cleanText = text.replace(/[\u00a0\t\r\n]+/g, ' ').trim();

    const visitsMatch = cleanText.match(/Monthly\s*Visits\s*:\s*([0-9\.\,\w\-\<\>\/]+)/i);
    if (visitsMatch) {
      res.monthlyVisits = visitsMatch[1].trim();
      res.aitdkReady = true;
    }

    const durationMatch = cleanText.match(/Avg\.?\s*(?:Visit\s*)?Duration\s*:\s*([0-9\:\w\-]+)/i);
    if (durationMatch) {
      res.avgDuration = durationMatch[1].trim();
      res.aitdkReady = true;
    }

    const createdMatch = cleanText.match(/Domain\s*Created\s*:\s*([0-9\-\w\/]+)/i);
    if (createdMatch) {
      res.domainCreated = createdMatch[1].trim();
      res.aitdkReady = true;
    }

    return res;
  }

  /**
   * Keywords Everywhere Plugin Adapter
   */
  const KeywordsEverywhereAdapter = {
    id: 'keywords_everywhere',
    name: 'Keywords Everywhere',
    badgeKey: 'K',
    columns: [
      { key: 'mozDa', label: 'MOZ DA' },
      { key: 'mozDaTrend', label: 'DA走势 (DA Trend)' },
      { key: 'refDom', label: '引荐主域 (Ref Dom)' },
      { key: 'refLinks', label: '外链数 (Ref Links)' },
      { key: 'spamScore', label: '垃圾得分 (Spam Score)' },
      { key: 'pageTraffic', label: '页面流量 (Page Traffic)' },
      { key: 'siteTraffic', label: '整站流量 (Site Traffic)' },
      { key: 'pageKeywords', label: '页面关键词数 (Page Keywords)' },
      { key: 'siteKeywords', label: '整站关键词数 (Site Keywords)' }
    ],
    detect(doc = document, items = []) {
      const markers = doc.querySelectorAll?.('.xt-google-domain-link-metrics, .xt-google-url-metrics, #xt-google-query, #xt-google-ltkwid, #xt-google-trenkw, #xt-difficulty-root, [id*="xt-"]') || [];
      const hasKeInItems = items.some(i => i.keReady);
      return markers.length > 0 || hasKeInItems;
    },
    extractItemMetrics(container, cardScope) {
      const res = extractKeywordsEverywhereMetrics(container);
      return {
        metrics: {
          mozDa: res.mozDa,
          mozDaTrend: res.mozDaTrend,
          refDom: res.refDom,
          refLinks: res.refLinks,
          spamScore: res.spamScore,
          pageTraffic: res.pageTraffic,
          siteTraffic: res.siteTraffic,
          pageKeywords: res.pageKeywords,
          siteKeywords: res.siteKeywords,
          topKeywordsNote: res.topKeywordsNote,
          keReady: res.keReady
        },
        isReady: res.keReady,
        isLoading: false
      };
    },
    extractPageWidgets(doc = document) {
      return {
        seoDifficulty: extractSeoDifficulty(doc)
      };
    }
  };

  /**
   * AITDK Plugin Adapter
   */
  const AitdkAdapter = {
    id: 'aitdk',
    name: 'AITDK',
    badgeKey: 'A',
    columns: [
      { key: 'monthlyVisits', label: '月访问量 (AITDK)' },
      { key: 'avgDuration', label: '平均时长 (Avg Duration)' },
      { key: 'domainCreated', label: '域名建立时间 (Domain Created)' }
    ],
    detect(doc = document, items = []) {
      const markers = doc.querySelectorAll?.('.aitdk-site-metrics-container, .aitdk-site-metrics, .aitdk-metric-brand, [class*="aitdk"], [id*="aitdk"]') || [];
      const hasAitdkInItems = items.some(i => i.aitdkReady);
      return markers.length > 0 || hasAitdkInItems;
    },
    extractItemMetrics(container, cardScope) {
      const res = extractAitdkMetrics(container);
      return {
        metrics: {
          monthlyVisits: res.monthlyVisits,
          avgDuration: res.avgDuration,
          domainCreated: res.domainCreated,
          aitdkReady: res.aitdkReady
        },
        isReady: res.aitdkReady,
        isLoading: res.aitdkLoading
      };
    }
  };

  // Register built-in adapters
  PluginRegistry.register(KeywordsEverywhereAdapter);
  PluginRegistry.register(AitdkAdapter);

  /**
   * Assess readiness of detected third-party plugins dynamically.
   */
  function assessPluginReadiness(doc = document, items = [], detectedAdapters = null) {
    const totalItems = items.length;
    const adapters = detectedAdapters || PluginRegistry.getDetected(doc, items);

    if (adapters.length === 0) {
      return {
        state: 'NO_PLUGINS',
        isSettled: true,
        statusText: '已就绪 (原生 Google 纯净模式)',
        activePlugins: [],
        plugins: {},
        aitdk: { detected: false, loadedCount: 0, loadingCount: 0, isReady: true },
        ke: { detected: false, loadedCount: 0, widgetsCount: 0, isReady: true }
      };
    }

    const plugins = {};
    let anyStillLoading = false;
    const statusParts = [];

    for (const adapter of adapters) {
      let loadedCount = 0;
      for (const item of items) {
        let isLoaded = false;
        if (item.pluginMetrics?.[adapter.id]) {
          const m = item.pluginMetrics[adapter.id];
          if (m.isReady || Object.values(m).some(v => v && v !== '-')) {
            isLoaded = true;
          }
        }
        if (!isLoaded) {
          if (item[`${adapter.id}Ready`]) {
            isLoaded = true;
          } else if (adapter.id === 'keywords_everywhere' && item.keReady) {
            isLoaded = true;
          } else if (adapter.id === 'aitdk' && item.aitdkReady) {
            isLoaded = true;
          } else if (adapter.columns && Array.isArray(adapter.columns)) {
            isLoaded = adapter.columns.some(col => item[col.key] && item[col.key] !== '-');
          }
        }
        if (isLoaded) {
          loadedCount++;
        }
      }

      let isLoading = false;
      if (typeof adapter.isPluginLoading === 'function') {
        try {
          isLoading = adapter.isPluginLoading(doc, items, loadedCount, totalItems);
        } catch (e) {
          isLoading = false;
        }
      } else if (adapter.id === 'aitdk') {
        const spinners = doc.querySelectorAll?.('.aitdk-dots-loading, .loading.aitdk-metric-item') || [];
        isLoading = spinners.length > 0 || (totalItems > 0 && loadedCount === 0);
      } else if (adapter.id === 'keywords_everywhere') {
        isLoading = totalItems > 0 && loadedCount === 0;
      }

      if (isLoading) anyStillLoading = true;

      plugins[adapter.id] = {
        id: adapter.id,
        name: adapter.name || adapter.id,
        badgeKey: adapter.badgeKey || adapter.id.slice(0, 1).toUpperCase(),
        loadedCount,
        isLoading,
        isReady: !isLoading
      };

      statusParts.push(`${adapter.name || adapter.id}: ${loadedCount}/${totalItems}`);
    }

    const state = anyStillLoading ? 'LOADING' : 'READY';
    const statusText = state === 'LOADING'
      ? `插件指标异步加载中 (${statusParts.join(', ')})...`
      : `插件指标已全部就绪 (${statusParts.join(', ')})`;

    return {
      state,
      isSettled: !anyStillLoading,
      statusText,
      activePlugins: adapters.map(a => a.id),
      plugins,
      aitdk: {
        detected: Boolean(plugins.aitdk),
        loadedCount: plugins.aitdk?.loadedCount || 0,
        loadingCount: plugins.aitdk?.isLoading ? 1 : 0,
        isReady: plugins.aitdk?.isReady ?? true
      },
      ke: {
        detected: Boolean(plugins.keywords_everywhere),
        loadedCount: plugins.keywords_everywhere?.loadedCount || 0,
        widgetsCount: doc.querySelectorAll?.('#xt-google-ltkwid, #xt-google-trenkw, #xt-related-search, #xt-difficulty-root')?.length || 0,
        isReady: plugins.keywords_everywhere?.isReady ?? true
      }
    };
  }

  return {
    PluginRegistry,
    KeywordsEverywhereAdapter,
    AitdkAdapter,
    extractKeywordsEverywhereMetrics,
    extractAitdkMetrics,
    extractSeoDifficulty,
    assessPluginReadiness
  };
});
