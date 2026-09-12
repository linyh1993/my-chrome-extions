/**
 * Parser for Google SERP results and third-party injected metrics (Keywords Everywhere & AITDK)
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

  function findContainerForHeading(h3, doc) {
    // 1. Classic .g
    const g = h3.closest('.g');
    if (g) return g;

    // 2. MjjYud (newer Google layout)
    const mjj = h3.closest('.MjjYud');
    if (mjj) return mjj;

    // 3. Look for data-hveid ancestor with lang or main result markers
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
      // If it's a google redirect: /url?q=https://...
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

  /**
   * Extract Snippet text, carefully ignoring text injected by AITDK / Keywords Everywhere
   */
  function extractSnippet(container) {
    // Clone container or select specific snippet element
    const snippetEl = container.querySelector('.VwiC3b, [data-sncf], [data-content-feature="1"], .yXK7lf');
    if (snippetEl) {
      return cleanInjectedText(snippetEl.textContent);
    }

    // Fallback: look for description elements
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

    // Find KE elements either inside container or nearby
    const domainMetricsEl = container.querySelector('.xt-google-domain-link-metrics, .xt-google-domain-link-metrics-root') ||
                            container.parentElement?.querySelector('.xt-google-domain-link-metrics');
    const urlMetricsEl = container.querySelector('.xt-google-url-metrics') ||
                         container.parentElement?.querySelector('.xt-google-url-metrics');
    const topKeywordsEl = container.querySelector('.xt-google-top-keywords-root, .xt-google-top-keywords-line') ||
                          container.parentElement?.querySelector('.xt-google-top-keywords-root');

    // Combine text for robust regex parsing if specific elements aren't isolated
    const keText = [
      domainMetricsEl?.textContent || '',
      urlMetricsEl?.textContent || '',
      topKeywordsEl?.textContent || ''
    ].join(' ');

    if (!keText.trim()) {
      // Also scan container text in case classes change
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
    // 1. MOZ DA: e.g. "MOZ DA: 56/100 (+87%)" or "MOZ DA: 60/100"
    const mozMatch = text.match(/MOZ\s*DA:\s*([0-9\.\-]+(?:\/\d+)?)\s*(?:\(([^)]+)\))?/i);
    if (mozMatch) {
      res.mozDa = mozMatch[1].trim();
      if (mozMatch[2]) res.mozDaTrend = mozMatch[2].trim();
      res.keReady = true;
    }

    // 2. Ref Dom: e.g. "Ref Dom: 9K" or "Ref Dom: 2.06M"
    const refDomMatch = text.match(/Ref\s*Dom:\s*([0-9\.\w\-]+)/i);
    if (refDomMatch) {
      res.refDom = refDomMatch[1].trim();
      res.keReady = true;
    }

    // 3. Ref Links: e.g. "Ref Links: 119.1K" or "Ref Links: 2.9B"
    const refLinksMatch = text.match(/Ref\s*Links:\s*([0-9\.\w\-]+)/i);
    if (refLinksMatch) {
      res.refLinks = refLinksMatch[1].trim();
      res.keReady = true;
    }

    // 4. Spam Score: e.g. "Spam Score: 1%" or "Spam Score: -"
    const spamMatch = text.match(/Spam\s*Score:\s*([0-9\.\%\-]+)/i);
    if (spamMatch) {
      res.spamScore = spamMatch[1].trim();
      res.keReady = true;
    }

    // 5. Search traffic: e.g. "Search traffic (us): 0/mo (website: 151.80K/mo)"
    // or "Search traffic (us): 831.56M/mo"
    const trafMatch = text.match(/Search\s*traffic\s*(?:\([^)]+\))?:\s*([^\–\-\n\r]+?)(?=\s*-\s*Keywords|\s*$|\n|\r)/i);
    if (trafMatch) {
      const rawTraf = trafMatch[1].trim();
      // check for "(website: ...)"
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

    // 6. Keywords: e.g. "Keywords (us): 0 (website: 8605)" or "Keywords (us): 133.05M"
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

    // Check loading indicator
    if (aitdkEl && (aitdkEl.querySelector('.aitdk-dots-loading, .loading') || aitdkEl.classList.contains('loading'))) {
      res.aitdkLoading = true;
    }

    // 1. Monthly Visits: e.g. "Monthly Visits: 8.59M" or "Monthly Visits: 20.51M"
    const visitsMatch = text.match(/Monthly\s*Visits:\s*([0-9\.\w\-]+)/i);
    if (visitsMatch) {
      res.monthlyVisits = visitsMatch[1].trim();
      res.aitdkReady = true;
    }

    // 2. Avg. Visit Duration: e.g. "Avg. Visit Duration: 00:01:47"
    const durationMatch = text.match(/Avg\.?\s*Visit\s*Duration:\s*([0-9\:\w\-]+)/i);
    if (durationMatch) {
      res.avgDuration = durationMatch[1].trim();
      res.aitdkReady = true;
    }

    // 3. Domain Created: e.g. "Domain Created: 2016-11-30" or "Domain Created: 2023-01-05"
    const createdMatch = text.match(/Domain\s*Created:\s*([0-9\-\w\/]+)/i);
    if (createdMatch) {
      res.domainCreated = createdMatch[1].trim();
      res.aitdkReady = true;
    }

    return res;
  }

  /**
   * Main parsing function: extract all SERP items + metrics on current page
   */
  function parseCurrentPage(doc = document) {
    const query = extractSearchQuery(doc);
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
        aitdkReady: aitdk.aitdkReady,
        keReady: ke.keReady,
        scrapedAt: new Date().toLocaleString()
      });
    }

    return {
      query,
      pageVolumeInfo,
      totalFound: items.length,
      aitdkReadyCount,
      keReadyCount,
      isFullyReady: items.length > 0 && (aitdkReadyCount >= items.length || keReadyCount >= items.length),
      items
    };
  }

  return {
    extractSearchQuery,
    extractPageVolumeInfo,
    findResultContainers,
    normalizeGoogleUrl,
    extractDomain,
    extractSnippet,
    extractKeywordsEverywhereMetrics,
    extractAitdkMetrics,
    parseCurrentPage
  };
});
