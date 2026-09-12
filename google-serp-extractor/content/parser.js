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
    const g = h3.closest('.g');
    if (g) return g;

    const mjj = h3.closest('.MjjYud');
    if (mjj) return mjj;

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
   * Extract AITDK metrics from container or adjacent siblings
   */
  function extractAitdkMetrics(container) {
    const res = {
      monthlyVisits: '',
      avgDuration: '',
      domainCreated: '',
      aitdkReady: false,
      aitdkLoading: false
    };

    const aitdkEl = container.querySelector('.aitdk-site-metrics, .aitdk-site-metrics-container') ||
                    container.parentElement?.querySelector('.aitdk-site-metrics, .aitdk-site-metrics-container');

    const text = aitdkEl ? aitdkEl.textContent : (container.textContent || '');

    if (aitdkEl && (aitdkEl.querySelector('.aitdk-dots-loading, .loading') || aitdkEl.classList.contains('loading'))) {
      res.aitdkLoading = true;
    }

    const visitsMatch = text.match(/Monthly\s*Visits:\s*([0-9\.\w\-]+)/i);
    if (visitsMatch) {
      res.monthlyVisits = visitsMatch[1].trim();
      res.aitdkReady = true;
    }

    const durationMatch = text.match(/Avg\.?\s*Visit\s*Duration:\s*([0-9\:\w\-]+)/i);
    if (durationMatch) {
      res.avgDuration = durationMatch[1].trim();
      res.aitdkReady = true;
    }

    const createdMatch = text.match(/Domain\s*Created:\s*([0-9\-\w\/]+)/i);
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
   * Main parsing function: extract all SERP items + SEO metrics + landscape modules
   */
  function parseCurrentPage(doc = document) {
    const query = extractSearchQuery(doc);
    const resultStats = extractResultStats(doc);
    const pageVolumeInfo = extractPageVolumeInfo(doc);
    const containers = findResultContainers(doc);

    const items = [];
    let rank = 1;
    let aitdkReadyCount = 0;
    let keReadyCount = 0;

    for (const item of containers) {
      const title = item.heading?.textContent?.trim() || '';
      const url = item.targetUrl;
      const domain = extractDomain(url);
      const snippet = extractSnippet(item.container);

      const ke = extractKeywordsEverywhereMetrics(item.container);
      const aitdk = extractAitdkMetrics(item.container);

      if (aitdk.aitdkReady) aitdkReadyCount++;
      if (ke.keReady) keReadyCount++;

      items.push({
        id: `serp_${rank}_${domain}`,
        rank: rank++,
        query,
        title,
        url,
        domain,
        snippet,
        // Keywords Everywhere
        mozDa: ke.mozDa,
        mozDaTrend: ke.mozDaTrend,
        refDom: ke.refDom,
        refLinks: ke.refLinks,
        spamScore: ke.spamScore,
        pageTraffic: ke.pageTraffic,
        siteTraffic: ke.siteTraffic,
        pageKeywords: ke.pageKeywords,
        siteKeywords: ke.siteKeywords,
        topKeywordsNote: ke.topKeywordsNote,
        // AITDK
        monthlyVisits: aitdk.monthlyVisits,
        avgDuration: aitdk.avgDuration,
        domainCreated: aitdk.domainCreated,
        // Metadata & Status
        pageVolumeInfo,
        resultStatsRaw: resultStats.raw,
        aitdkReady: aitdk.aitdkReady,
        keReady: ke.keReady,
        scrapedAt: new Date().toLocaleString()
      });
    }

    // Extended modules
    const relatedKeywords = extractRelatedKeywords(doc);
    const relatedProducts = extractRelatedProducts(doc);
    const peopleAlsoAsk = extractPeopleAlsoAsk(doc);
    const sponsoredAds = extractSponsoredAds(doc);
    const aiOverview = extractAiOverview(doc);
    const discussions = extractDiscussions(doc);

    return {
      query,
      resultStats,
      pageVolumeInfo,
      totalFound: items.length,
      aitdkReadyCount,
      keReadyCount,
      isFullyReady: items.length > 0 && (aitdkReadyCount >= items.length || keReadyCount >= items.length),
      items,
      // Extended modules
      relatedKeywords,
      relatedProducts,
      peopleAlsoAsk,
      sponsoredAds,
      aiOverview,
      discussions
    };
  }

  return {
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
    extractRelatedProducts,
    extractPeopleAlsoAsk,
    extractSponsoredAds,
    extractAiOverview,
    extractDiscussions,
    parseCurrentPage
  };
});
