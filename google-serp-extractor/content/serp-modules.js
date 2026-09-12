/**
 * Google SERP & SEO Extractor - SERP Landscape Modules
 * Extracts non-organic SERP features: Related Keywords (PASF), Products & Services,
 * People Also Ask, Sponsored Ads, Google AI Overview, and Discussions/Forums.
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const domUtils = require('./dom-utils.js');
    module.exports = factory(domUtils);
  } else {
    root.GseSerpModules = factory(root.GseDomUtils || {});
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(domUtils) {

  const {
    cleanInjectedText,
    isSpecialModuleHeading,
    normalizeGoogleUrl,
    isInternalGoogleUrl,
    extractDomain
  } = domUtils || {};

  /**
   * 1. Extract Related Keywords & Search Explore modules (PASF & Keywords Everywhere tables)
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
   * 2. Extract "Find related products & services" / "Popular products"
   */
  function extractRelatedProducts(doc = document) {
    const products = [];
    const headings = doc.querySelectorAll('h2, h3, [role="heading"], div');

    let productContainer = null;

    for (const heading of headings) {
      const t = (heading.textContent || '').trim();
      if (/Find\s*related\s*products|Popular\s*products|Explore\s*products|相关产品与服务|热门产品/i.test(t)) {
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

  return {
    extractRelatedKeywords,
    extractRelatedProducts,
    extractPeopleAlsoAsk,
    extractSponsoredAds,
    extractAiOverview,
    extractDiscussions
  };
});
