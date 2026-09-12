/**
 * Comprehensive Parser for Google SERP results, SEO metrics (Keywords Everywhere & AITDK),
 * and SERP search landscape modules (Result Stats, People also search for, Related products,
 * People also ask, Sponsored Ads, AI Overview, Discussions).
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GseParser = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

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
      // 1. Total results count
      // e.g. "About 18,300 results" or "找到约 18,300 条结果" or "1,200,000 results"
      const countMatch = raw.match(/(?:About|约|Approximately|Over)?\s*([0-9\s,\.]+)\s*(?:results|条结果|条)/i);
      if (countMatch) {
        const cleaned = countMatch[1].replace(/[,.\s]/g, '');
        const num = parseInt(cleaned, 10);
        if (!isNaN(num)) totalResults = num;
      }

      // 2. Search time in seconds
      // e.g. "(0.17 seconds)" or "（用时 0.17 秒）" or "(0.25 s)"
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

    // Fallback: search for top text containing "Volume:" and "CPC:"
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
      // Exclude headings from special modules (PAA, People Also Search, Ads, Products)
      if (isSpecialModuleHeading(h3)) continue;

      const anchor = h3.closest('a');
      if (!anchor || !anchor.href) continue;

      let rawUrl = anchor.href;
      let targetUrl = normalizeGoogleUrl(rawUrl);

      // Skip Google internal links, anchor jumps, images/maps sub-features
      if (!targetUrl || targetUrl.startsWith('#') || isInternalGoogleUrl(targetUrl)) {
        continue;
      }

      if (seenUrls.has(targetUrl)) continue;

      // Find best enclosing container for this item
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
        if (h3 && isSpecialModuleHeading(h3)) continue;

        const anchor = h3 ? h3.closest('a') : g.querySelector('a[href]');
        if (!anchor || !anchor.href) continue;

        const targetUrl = normalizeGoogleUrl(anchor.href);
        if (!targetUrl || isInternalGoogleUrl(targetUrl) || seenUrls.has(targetUrl)) continue;

        seenUrls.add(targetUrl);
        items.push({ heading: h3, anchor, targetUrl, container: g });
      }
    }

    return items;
  }

  function isSpecialModuleHeading(el) {
    const text = (el.textContent || '').trim().toLowerCase();
    return (
      text.includes('people also ask') ||
      text.includes('people also search') ||
      text.includes('related searches') ||
      text.includes('find related products') ||
      text.includes('popular products') ||
      text.includes('discussions and forums') ||
      text.includes('大家都在问') ||
      text.includes('相关搜索') ||
      text.includes('相关产品')
    );
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

  function normalizeGoogleUrl(href) {
    try {
      const parsed = new URL(href, 'https://www.google.com');
      if (parsed.pathname === '/url' && parsed.searchParams.has('q')) {
        return parsed.searchParams.get('q');
      }
      return parsed.href;
    } catch (e) {
      return href;
    }
  }

  function isInternalGoogleUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('google.') && (
        u.pathname.startsWith('/search') ||
        u.pathname.startsWith('/preferences') ||
        u.pathname.startsWith('/intl') ||
        u.pathname.startsWith('/imgres') ||
        u.pathname === '/'
      )) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function extractSnippet(container) {
    const snippetEl = container.querySelector('.VwiC3b, [data-sncf], [data-content-feature="1"], .yXK7lf');
    if (snippetEl) {
      return cleanInjectedText(snippetEl.textContent);
    }

    const em = container.querySelector('em');
    if (em && em.parentElement) {
      return cleanInjectedText(em.parentElement.textContent);
    }

    return '';
  }

  function cleanInjectedText(text) {
    if (!text) return '';
    return text
      .replace(/AITDK\s*\|[\s\S]*?(Domain Created:[^\n\r]+|$)/gi, '')
      .replace(/MOZ DA:[\s\S]*?(Show backlinks|$)/gi, '')
      .replace(/Search traffic[\s\S]*?(Keywords[^\n\r]+|$)/gi, '')
      .replace(/See the top keywords this webpage ranks for[^\n\r]*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract Keywords Everywhere metrics from container or adjacent siblings
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
   * Extract AITDK metrics from container, card scope (.MjjYud) or adjacent siblings
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

    // Card scope: check container, .MjjYud, .g, or parentElement
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

    // Clean text (convert non-breaking spaces & tabs to normal spaces)
    const cleanText = text.replace(/[\u00a0\t\r\n]+/g, ' ').trim();

    // 1. Monthly Visits (matches "Monthly Visits: 7.27M", "Monthly Visits: <5K", "Monthly Visits: 1,200", etc.)
    const visitsMatch = cleanText.match(/Monthly\s*Visits\s*:\s*([0-9\.\,\w\-\<\>\/]+)/i);
    if (visitsMatch) {
      res.monthlyVisits = visitsMatch[1].trim();
      res.aitdkReady = true;
    }

    // 2. Avg Visit Duration (matches "Avg. Visit Duration: 00:04:03", "Avg Visit Duration: ...", "Avg. Duration: ...")
    const durationMatch = cleanText.match(/Avg\.?\s*(?:Visit\s*)?Duration\s*:\s*([0-9\:\w\-]+)/i);
    if (durationMatch) {
      res.avgDuration = durationMatch[1].trim();
      res.aitdkReady = true;
    }

    // 3. Domain Created (matches "Domain Created: 2023-04-06")
    const createdMatch = cleanText.match(/Domain\s*Created\s*:\s*([0-9\-\w\/]+)/i);
    if (createdMatch) {
      res.domainCreated = createdMatch[1].trim();
      res.aitdkReady = true;
    }

    return res;
  }

  /**
   * 1. Extract "People also search for" & "Related searches" & Keywords Everywhere widgets
   */
  function extractRelatedKeywords(doc = document) {
    const list = [];
    const seen = new Set();

    // A. Keywords Everywhere Injected Tables
    const keSelectors = [
      { sel: '#xt-google-people-search', source: 'KE: People Also Search For' },
      { sel: '#xt-related-search', source: 'KE: Related Keywords' },
      { sel: '#xt-google-ltkwid', source: 'KE: Long-Tail Keywords' },
      { sel: '#xt-google-trenkw', source: 'KE: Trending Keywords' }
    ];

    for (const { sel, source } of keSelectors) {
      const widget = doc.querySelector(sel);
      if (!widget) continue;
      const rows = widget.querySelectorAll('tr, .xt-ke-table-row, li');
      for (const row of rows) {
        const text = row.textContent.replace(/\s+/g, ' ').trim();
        const a = row.querySelector('a');
        const kw = a ? a.textContent.trim() : (text.split('$')[0].split(/\s+\d/)[0].trim());
        if (!kw || seen.has(kw.toLowerCase())) continue;

        // Try extracting Vol and CPC from table row cells
        let vol = '';
        let cpc = '';
        const volMatch = text.match(/([\d\.\,]+[KMBkmb]?\/mo|[\d\.\,]+[KMBkmb]?)\s*(?:\$|CPC|$)/);
        if (volMatch) vol = volMatch[1];
        const cpcMatch = text.match(/\$[\d\.]+/);
        if (cpcMatch) cpc = cpcMatch[0];

        seen.add(kw.toLowerCase());
        list.push({
          keyword: kw,
          source,
          volume: vol || '-',
          cpc: cpc || '-',
          url: a ? normalizeGoogleUrl(a.href) : `https://www.google.com/search?q=${encodeURIComponent(kw)}`
        });
      }

      // Fallback: If widget doesn't use standard tr/li, extract from anchor tags or text lines
      if (rows.length === 0) {
        const anchors = widget.querySelectorAll('a[href*="search?q="], a[href*="google."]');
        for (const a of anchors) {
          const kw = a.textContent.replace(/\s+/g, ' ').trim();
          if (!kw || kw.length < 2 || seen.has(kw.toLowerCase())) continue;
          seen.add(kw.toLowerCase());
          list.push({
            keyword: kw,
            source,
            volume: '-',
            cpc: '-',
            url: normalizeGoogleUrl(a.href)
          });
        }

        // Also check plain lines if no anchors found
        if (anchors.length === 0) {
          const rawLines = (widget.textContent || '').split(/[\r\n]+/);
          for (let line of rawLines) {
            line = line.trim();
            if (!line || line.length < 3 || seen.has(line.toLowerCase())) continue;
            // Ignore widget UI buttons / labels
            if (/^(Keywords?|Copy|Export|Load Metrics|Per page|All|Free Keyword|Track rankings|Uses \d+)/i.test(line)) continue;
            if (/^\d+-\d+ of \d+$/i.test(line)) continue;

            seen.add(line.toLowerCase());
            list.push({
              keyword: line,
              source,
              volume: '-',
              cpc: '-',
              url: `https://www.google.com/search?q=${encodeURIComponent(line)}`
            });
          }
        }
      }
    }

    // B. Google Native "People also search for" & "Related searches"
    const headingElements = doc.querySelectorAll('h2, h3, [role="heading"], div');
    for (const heading of headingElements) {
      const title = (heading.textContent || '').trim();
      let sourceName = '';
      if (/People\s*also\s*search\s*for|用户还搜了|大家也搜/i.test(title)) {
        sourceName = 'Google: People also search for';
      } else if (/Related\s*searches|相关搜索|Searches\s*related\s*to/i.test(title)) {
        sourceName = 'Google: Related searches';
      }

      if (sourceName) {
        const section = heading.closest('.MjjYud, .g, div[data-hveid]') || heading.parentElement?.parentElement;
        if (!section) continue;

        const anchors = section.querySelectorAll('a[href*="search?q="], a[href*="/search?"]');
        for (const a of anchors) {
          const kw = a.textContent.replace(/\s+/g, ' ').trim();
          if (!kw || kw.length < 2 || seen.has(kw.toLowerCase()) || isSpecialModuleHeading(a)) continue;

          seen.add(kw.toLowerCase());
          list.push({
            keyword: kw,
            source: sourceName,
            volume: '-',
            cpc: '-',
            url: normalizeGoogleUrl(a.href)
          });
        }
      }
    }

    // C. Fallback: Bottom related searches `#botstuff`
    const botstuff = doc.querySelector('#botstuff, div[data-initq]');
    if (botstuff) {
      const anchors = botstuff.querySelectorAll('a[href*="search?q="]');
      for (const a of anchors) {
        const kw = a.textContent.replace(/\s+/g, ' ').trim();
        if (!kw || kw.length < 2 || seen.has(kw.toLowerCase())) continue;
        seen.add(kw.toLowerCase());
        list.push({
          keyword: kw,
          source: 'Google: Related searches (Bottom)',
          volume: '-',
          cpc: '-',
          url: normalizeGoogleUrl(a.href)
        });
      }
    }

    return list;
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
   * Plugin Adapter Architecture & Registry for Third-Party SEO Extensions
   * Decouples the core SERP engine from specific extensions (AITDK, KE, Semrush, etc.).
   * New plugins can be plugged in or existing ones removed without touching core SERP logic.
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
        seoDifficulty: extractSeoDifficulty(doc),
        relatedKeywords: extractRelatedKeywords(doc)
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
   * Decoupled: evaluates whatever adapters are currently registered & detected.
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
        // Backward compatibility
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
      // Backward compatibility accessors
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

  /**
   * 2. Extract "Find related products & services" / "Popular products"
   */
  function extractRelatedProducts(doc = document) {
    const products = [];
    const headings = doc.querySelectorAll('h2, h3, [role="heading"], div');

    let productContainer = null;
    let sectionTitle = '';

    for (const heading of headings) {
      const t = (heading.textContent || '').trim();
      if (/Find\s*related\s*products|Popular\s*products|Explore\s*products|相关产品与服务|热门产品/i.test(t)) {
        sectionTitle = t;
        productContainer = heading.closest('.MjjYud, .g, div[data-hveid]') || heading.parentElement?.parentElement;
        break;
      }
    }

    if (!productContainer) return products;

    // Each product card inside the carousel/grid
    const cards = productContainer.querySelectorAll('[role="listitem"], div[data-docid], div[data-cid], .pla-unit, a:has(span[title])');
    const seen = new Set();

    for (const card of cards) {
      // Title
      const titleEl = card.querySelector('[title], [role="heading"], h3, h4, .rhsg4') || card.querySelector('a');
      const title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent).trim() : '';
      if (!title || seen.has(title.toLowerCase())) continue;

      // URL
      const anchor = card.closest('a') || card.querySelector('a[href]');
      const rawUrl = anchor ? anchor.href : '';
      const url = normalizeGoogleUrl(rawUrl);

      // Price (e.g. $19.99, From $29.00, ¥99)
      const text = card.textContent || '';
      const priceMatch = text.match(/(?:\$|£|€|¥)\s*[0-9\.\,]+(?:\/mo|\/yr)?|Free\s*(?:trial|shipping)?/i);
      const price = priceMatch ? priceMatch[0].trim() : '-';

      // Rating (e.g. 4.8 (120) or 4.5 ★)
      const ratingMatch = text.match(/([0-5]\.[0-9])\s*(?:★|stars|\([0-9\.\,kK]+\))/i);
      const rating = ratingMatch ? ratingMatch[0].trim() : '-';

      // Merchant / Store
      let merchant = '';
      const merchantMatch = text.match(/(?:From|By|at)\s+([A-Za-z0-9\.\s]+?)(?=\s*[\$·\n]|\s*$)/i);
      if (merchantMatch) {
        merchant = merchantMatch[1].trim();
      } else if (url) {
        merchant = extractDomain(url);
      }

      seen.add(title.toLowerCase());
      products.push({
        title,
        merchant: merchant || '-',
        price,
        rating,
        url: url || '#'
      });
    }

    return products;
  }

  /**
   * 3. Extract "People also ask" (PAA)
   */
  function extractPeopleAlsoAsk(doc = document) {
    const list = [];
    const headings = doc.querySelectorAll('h2, h3, [role="heading"], div');

    let paaContainer = null;
    for (const h of headings) {
      const t = (h.textContent || '').trim();
      if (/People\s*also\s*ask|大家都在问|相关问题/i.test(t)) {
        paaContainer = h.closest('.MjjYud, .g, div[data-hveid]') || h.parentElement?.parentElement;
        break;
      }
    }

    if (!paaContainer) return list;

    const questionNodes = paaContainer.querySelectorAll('[jsname="yEVEwb"], div[role="button"], [data-q], div[aria-expanded]');
    const seen = new Set();

    for (const node of questionNodes) {
      const questionText = (node.getAttribute('data-q') || node.textContent).trim();
      if (!questionText || questionText.length < 5 || isSpecialModuleHeading(node)) continue;
      // Filter out clean questions
      const cleaned = questionText.replace(/\s+/g, ' ').replace(/(Search for:|People also ask)[\s\S]*/i, '').trim();
      if (!cleaned || seen.has(cleaned.toLowerCase())) continue;

      // Check if source answer is present
      let answerSnippet = '';
      let sourceUrl = '';
      let sourceDomain = '';

      const answerEl = node.querySelector('.hgKElc, [data-content-feature="1"], .LGOjhe') ||
                       node.parentElement?.querySelector('.hgKElc, [data-content-feature="1"], .LGOjhe');
      if (answerEl) {
        answerSnippet = answerEl.textContent.replace(/\s+/g, ' ').trim();
      }
      const sourceAnchor = node.querySelector('a[href]') || node.parentElement?.querySelector('a[href]');
      if (sourceAnchor) {
        sourceUrl = normalizeGoogleUrl(sourceAnchor.href);
        sourceDomain = extractDomain(sourceUrl);
      }

      seen.add(cleaned.toLowerCase());
      list.push({
        question: cleaned,
        answer: answerSnippet || '-',
        sourceDomain: sourceDomain || '-',
        sourceUrl: sourceUrl || '-'
      });
    }

    return list;
  }

  /**
   * 4. Extract Sponsored Ads (商业竞品投放广告)
   */
  function extractSponsoredAds(doc = document) {
    const ads = [];
    const adContainers = doc.querySelectorAll('#tads [data-text-ad], #tadsb [data-text-ad], [data-text-ad], .uEierd, [data-pla-ad]');
    const seen = new Set();

    let rank = 1;
    for (const ad of adContainers) {
      const heading = ad.querySelector('[role="heading"], h3, .CCgQ5');
      const title = heading ? heading.textContent.trim() : '';
      const anchor = ad.querySelector('a[href]');
      const rawUrl = anchor ? (anchor.href || anchor.getAttribute?.('href') || '') : '';
      const url = normalizeGoogleUrl(rawUrl);

      if (!title || seen.has(title.toLowerCase())) continue;

      const snippetEl = ad.querySelector('.Va3FIb, .MUxGbd, .yXK7lf');
      const snippet = snippetEl ? snippetEl.textContent.replace(/\s+/g, ' ').trim() : '';
      const domain = extractDomain(url);

      seen.add(title.toLowerCase());
      ads.push({
        rank: rank++,
        title,
        domain: domain || '-',
        url: url || '#',
        snippet: snippet || '-'
      });
    }

    return ads;
  }

  /**
   * 5. Extract Google AI Overview (生成式摘要)
   */
  function extractAiOverview(doc = document) {
    const res = {
      hasAiOverview: false,
      textSnippet: '',
      citedSources: []
    };

    // Google AI Overview container
    const aiHeading = Array.from(doc.querySelectorAll('h2, h3, [role="heading"], div')).find(el => {
      const t = el.textContent.trim().toLowerCase();
      return t === 'ai overview' || t === 'ai 概览' || t.startsWith('ai overview');
    });

    if (!aiHeading) return res;

    const container = aiHeading.closest('.MjjYud, div[data-attrid*="ai"], div[jscontroller]') || aiHeading.parentElement?.parentElement;
    if (!container) return res;

    res.hasAiOverview = true;
    const textEl = container.querySelector('[data-sncf], .LGOjhe, [data-content-feature="1"]') || container;
    res.textSnippet = cleanInjectedText(textEl.textContent.slice(0, 1000));

    // Cited sources / link cards
    const citedAnchors = container.querySelectorAll('a[href]');
    const seen = new Set();
    for (const a of citedAnchors) {
      const url = normalizeGoogleUrl(a.href);
      if (!url || isInternalGoogleUrl(url) || seen.has(url)) continue;
      seen.add(url);
      res.citedSources.push({
        title: a.textContent.trim() || extractDomain(url),
        url,
        domain: extractDomain(url)
      });
    }

    return res;
  }

  /**
   * 6. Extract Discussions & Forums (Reddit, Quora, 社区讨论)
   */
  function extractDiscussions(doc = document) {
    const list = [];
    const headings = doc.querySelectorAll('h2, h3, [role="heading"], div');

    let container = null;
    for (const h of headings) {
      const t = (h.textContent || '').trim();
      if (/Discussions\s*and\s*forums|论坛与讨论|社区讨论/i.test(t)) {
        container = h.closest('.MjjYud, .g, div[data-hveid]') || h.parentElement?.parentElement;
        break;
      }
    }

    if (!container) return list;

    const items = container.querySelectorAll('.MjjYud, a:has(h3), [role="listitem"]');
    const seen = new Set();

    for (const item of items) {
      const heading = item.querySelector('h3, [role="heading"]') || item;
      const title = heading ? heading.textContent.trim() : '';
      const anchor = item.closest('a') || item.querySelector('a[href]');
      const url = anchor ? normalizeGoogleUrl(anchor.href) : '';
      if (!title || !url || seen.has(url)) continue;

      const domain = extractDomain(url);
      seen.add(url);
      list.push({
        title,
        platform: domain.includes('reddit') ? 'Reddit' : (domain.includes('quora') ? 'Quora' : domain),
        domain,
        url
      });
    }

    return list;
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

    // Fallback: check DOM pagination indicator if URL start wasn't found or was 0
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

        // Merge pluginMetrics dictionaries cleanly
        const mergedPluginMetrics = {
          ...(existing.pluginMetrics || {}),
          ...(item.pluginMetrics || {})
        };
        for (const [pId, pMetrics] of Object.entries(mergedPluginMetrics)) {
          const exMetrics = existing.pluginMetrics?.[pId] || {};
          const newMetrics = item.pluginMetrics?.[pId] || {};
          mergedPluginMetrics[pId] = { ...exMetrics, ...newMetrics };
        }

        itemMap.set(item.url, {
          ...existing,
          ...item,
          pluginMetrics: mergedPluginMetrics,
          // Retain rank/page if existing has valid values
          rank: item.rank || existing.rank,
          page: item.page || existing.page,
          pageRank: item.pageRank || existing.pageRank,
          // AITDK metrics: use whichever has values
          monthlyVisits: item.monthlyVisits || existing.monthlyVisits || '',
          avgDuration: item.avgDuration || existing.avgDuration || '',
          domainCreated: item.domainCreated || existing.domainCreated || '',
          aitdkReady: item.aitdkReady || existing.aitdkReady || false,
          // Keywords Everywhere metrics: use whichever has values
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

    // Calculate distinct pages collected
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
    const activeAdapters = PluginRegistry.getDetected(doc, []);
    const activePluginIds = activeAdapters.map(a => a.id);

    const items = [];
    let pageRank = 1;
    let aitdkReadyCount = 0;
    let keReadyCount = 0;

    for (const item of containers) {
      const title = item.heading?.textContent?.trim() || '';
      const url = item.targetUrl;
      const domain = extractDomain(url);
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
              // Flatten onto itemData for convenient direct access and backwards compatibility
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
    const allKeywords = extractRelatedKeywords(doc);
    const seoDifficulty = extractSeoDifficulty(doc);
    const relatedProducts = extractRelatedProducts(doc);
    const peopleAlsoAsk = extractPeopleAlsoAsk(doc);
    const sponsoredAds = extractSponsoredAds(doc);
    const aiOverview = extractAiOverview(doc);
    const discussions = extractDiscussions(doc);

    // Assess plugin readiness dynamically across detected adapters
    const readiness = assessPluginReadiness(doc, items, activeAdapters);

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
      // Extended modules
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
    PluginRegistry,
    KeywordsEverywhereAdapter,
    AitdkAdapter,
    extractSearchQuery,
    extractResultStats,
    extractPageVolumeInfo,
    findResultContainers,
    normalizeGoogleUrl,
    extractDomain,
    extractSnippet,
    extractKeywordsEverywhereMetrics,
    extractAitdkMetrics,
    extractRelatedKeywords,
    extractSeoDifficulty,
    assessPluginReadiness,
    extractRelatedProducts,
    extractPeopleAlsoAsk,
    extractSponsoredAds,
    extractAiOverview,
    extractDiscussions,
    extractPageInfo,
    mergeMultiPageData,
    parseCurrentPage
  };
});
