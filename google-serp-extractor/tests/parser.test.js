/**
 * Google SERP & SEO Extractor - Automated Regression & Verification Suite
 * Run with: node google-serp-extractor/tests/parser.test.js
 */

const assert = require('assert');
const {
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
  extractSeoDifficulty,
  assessPluginReadiness,
  extractPageInfo,
  mergeMultiPageData,
  parseCurrentPage
} = require('../content/parser.js');

const {
  GSE_SERP_COLUMNS,
  GSE_KEYWORDS_COLUMNS,
  GSE_PRODUCTS_COLUMNS,
  GSE_PAA_COLUMNS,
  GSE_ADS_COLUMNS,
  itemsToCsv,
  itemsToTsv,
  keywordsToCsv,
  keywordsToTsv,
  productsToCsv,
  productsToTsv,
  paaToCsv,
  paaToTsv,
  adsToCsv,
  adsToTsv,
  itemsToJson,
  escapeCsvCell
} = require('../shared/exporter.js');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } catch (err) {
    console.error(`  \x1b[31m✖\x1b[0m ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function describe(suiteName, fn) {
  console.log(`\n\x1b[1m\x1b[34m[Suite]\x1b[0m ${suiteName}`);
  fn();
}

/**
 * Lightweight Mock DOM Element for testing
 */
class MockElement {
  constructor(tag, attrs = {}, text = '', children = []) {
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attrs };
    this.textContent = text;
    this.children = children;
    this.parentElement = null;
    this.children.forEach(c => c.parentElement = this);
  }

  getAttribute(attr) {
    return this.attributes[attr] || null;
  }

  get classList() {
    const classes = (this.attributes['class'] || '').split(/\s+/).filter(Boolean);
    return {
      contains: (c) => classes.includes(c)
    };
  }

  get href() {
    return this.attributes['href'] || '';
  }

  matches(sel) {
    sel = sel.trim();
    if (sel.includes('[')) {
      const bracketIdx = sel.indexOf('[');
      const tagPart = sel.slice(0, bracketIdx);
      const attrPart = sel.slice(bracketIdx);
      if (tagPart && tagPart !== '*' && this.tagName.toLowerCase() !== tagPart.toLowerCase()) {
        return false;
      }
      const raw = attrPart.replace(/[\[\]"]/g, '');
      if (raw.includes('*=')) {
        const [k, v] = raw.split('*=');
        return Boolean(this.attributes[k] && this.attributes[k].includes(v));
      }
      if (raw.includes('^=')) {
        const [k, v] = raw.split('^=');
        return Boolean(this.attributes[k] && this.attributes[k].startsWith(v));
      }
      if (raw.includes('$=')) {
        const [k, v] = raw.split('$=');
        return Boolean(this.attributes[k] && this.attributes[k].endsWith(v));
      }
      if (raw.includes('=')) {
        const [k, v] = raw.split('=');
        return this.attributes[k] === v;
      }
      return Boolean(this.attributes[raw]);
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return (this.attributes['class'] || '').split(/\s+/).includes(cls);
    }
    if (sel.startsWith('#')) {
      return this.attributes['id'] === sel.slice(1);
    }
    return this.tagName.toLowerCase() === sel.toLowerCase();
  }

  closest(sel) {
    let cur = this;
    while (cur) {
      if (cur.matches && cur.matches(sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector(sel) {
    const results = this.querySelectorAll(sel);
    return results.length > 0 ? results[0] : null;
  }

  querySelectorAll(sel) {
    const matched = [];
    const selectors = sel.split(',').map(s => s.trim());

    function traverse(node) {
      if (node !== this) {
        for (const s of selectors) {
          if (node.matches && node.matches(s)) {
            matched.push(node);
            break;
          }
        }
      }
      for (const child of node.children) {
        traverse(child);
      }
    }
    traverse(this);
    return matched;
  }
}

class MockDocument {
  constructor(body) {
    this.body = body;
    this.location = { href: 'https://www.google.com/search?q=ai+photo+detector' };
    this.title = 'ai photo detector - Google Search';
  }

  querySelector(sel) {
    if (this.body.matches && this.body.matches(sel)) return this.body;
    return this.body.querySelector(sel);
  }

  querySelectorAll(sel) {
    const res = [];
    if (this.body.matches && this.body.matches(sel)) res.push(this.body);
    res.push(...this.body.querySelectorAll(sel));
    return res;
  }
}

console.log('====================================================');
console.log('🧪 Running Expanded Google SERP & SEO Extractor Tests');
console.log('====================================================');

describe('1. Google Result Stats Extraction', () => {
  it('should parse "About 18,300 results (0.17 seconds)" into count and seconds', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { id: 'result-stats' }, 'About 18,300 results (0.17 seconds)')
      ])
    );
    const stats = extractResultStats(doc);
    assert.strictEqual(stats.totalResults, 18300);
    assert.strictEqual(stats.searchTimeSeconds, 0.17);
    assert.strictEqual(stats.raw, 'About 18,300 results (0.17 seconds)');
  });

  it('should parse Chinese format "找到约 1,250,000 条结果 （用时 0.42 秒）"', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { id: 'result-stats' }, '找到约 1,250,000 条结果 （用时 0.42 秒）')
      ])
    );
    const stats = extractResultStats(doc);
    assert.strictEqual(stats.totalResults, 1250000);
    assert.strictEqual(stats.searchTimeSeconds, 0.42);
  });
});

describe('2. Keywords Everywhere & AITDK Metrics Extraction', () => {
  it('should extract Moz DA, Ref Dom, Ref Links, Spam Score, Traffic, and Keywords (ZeroGPT sample)', () => {
    const container = new MockElement('div', { class: 'g' }, '', [
      new MockElement('div', { class: 'xt-google-domain-link-metrics-root' },
        'MOZ DA: 56/100 (+87%) Ref Dom: 9K Ref Links: 119.1K Spam Score: - Show backlinks'
      ),
      new MockElement('div', { class: 'xt-google-url-metrics' },
        'Search traffic (us): 0/mo (website: 151.80K/mo) - Keywords (us): 0 (website: 8605)'
      ),
      new MockElement('div', { class: 'xt-google-top-keywords-root' },
        'See the top keywords this webpage ranks for - purchase a plan'
      )
    ]);

    const metrics = extractKeywordsEverywhereMetrics(container);
    assert.strictEqual(metrics.mozDa, '56/100');
    assert.strictEqual(metrics.mozDaTrend, '+87%');
    assert.strictEqual(metrics.refDom, '9K');
    assert.strictEqual(metrics.refLinks, '119.1K');
    assert.strictEqual(metrics.spamScore, '-');
    assert.strictEqual(metrics.pageTraffic, '0/mo');
    assert.strictEqual(metrics.siteTraffic, '151.80K/mo');
    assert.strictEqual(metrics.pageKeywords, '0');
    assert.strictEqual(metrics.siteKeywords, '8605');
    assert.strictEqual(metrics.keReady, true);
  });

  it('should extract AITDK Monthly Visits, Avg Duration, and Domain Created', () => {
    const container = new MockElement('div', { class: 'g' }, '', [
      new MockElement('div', { class: 'aitdk-site-metrics' },
        'AITDK | Monthly Visits: 20.51M | Avg. Visit Duration: 00:03:10 | Domain Created: 2023-01-05'
      )
    ]);

    const metrics = extractAitdkMetrics(container);
    assert.strictEqual(metrics.monthlyVisits, '20.51M');
    assert.strictEqual(metrics.avgDuration, '00:03:10');
    assert.strictEqual(metrics.domainCreated, '2023-01-05');
    assert.strictEqual(metrics.aitdkReady, true);
  });

  it('should extract AITDK with emojis matching user screenshot exactly', () => {
    // Exact text from user screenshot: media_1789223815539.png
    const card = new MockElement('div', { class: 'MjjYud' }, '', [
      new MockElement('div', { class: 'g' }, '', [
        new MockElement('a', { href: 'https://example.com' }, '', [
          new MockElement('h3', {}, 'Example Title')
        ])
      ]),
      new MockElement('div', { class: 'aitdk-card-wrapper' },
        'AITDK | 🌐 Monthly Visits: 7.27M 🕒 Avg. Visit Duration: 00:04:03 📅 Domain Created: 2023-04-06'
      )
    ]);

    const metrics = extractAitdkMetrics(card);
    assert.strictEqual(metrics.monthlyVisits, '7.27M');
    assert.strictEqual(metrics.avgDuration, '00:04:03');
    assert.strictEqual(metrics.domainCreated, '2023-04-06');
    assert.strictEqual(metrics.aitdkReady, true);
  });
});

describe('3. Related Keywords (People also search for & KE)', () => {
  it('should extract KE People Also Search For table items', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { id: 'xt-google-people-search' }, '', [
          new MockElement('tr', {}, 'ai image detector github 1.2K/mo $0.45', [
            new MockElement('a', { href: 'https://www.google.com/search?q=ai+image+detector+github' }, 'ai image detector github')
          ]),
          new MockElement('tr', {}, 'best free ai photo detector 3.4K/mo $1.20', [
            new MockElement('a', { href: 'https://www.google.com/search?q=best+free+ai+photo+detector' }, 'best free ai photo detector')
          ])
        ])
      ])
    );

    const keywords = extractRelatedKeywords(doc);
    assert.strictEqual(keywords.length, 2);
    assert.strictEqual(keywords[0].keyword, 'ai image detector github');
    assert.strictEqual(keywords[0].volume, '1.2K/mo');
    assert.strictEqual(keywords[0].cpc, '$0.45');
    assert.strictEqual(keywords[1].keyword, 'best free ai photo detector');
  });
});

describe('4. Find Related Products & Services', () => {
  it('should extract product cards with title, merchant, price, and rating', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { class: 'MjjYud' }, '', [
          new MockElement('h2', {}, 'Find related products & services'),
          new MockElement('div', { class: 'pla-unit' }, 'ZeroGPT Pro By ZeroGPT $9.99/mo 4.8 (120)', [
            new MockElement('span', { title: 'ZeroGPT AI Detector Pro' }, 'ZeroGPT AI Detector Pro'),
            new MockElement('a', { href: 'https://www.zerogpt.com/pricing' }, 'ZeroGPT')
          ]),
          new MockElement('div', { class: 'pla-unit' }, 'DeepMedia Forensics By DeepMedia Free trial 4.5 ★', [
            new MockElement('span', { title: 'DeepMedia AI Forensics' }, 'DeepMedia AI Forensics'),
            new MockElement('a', { href: 'https://deepmedia.ai' }, 'DeepMedia')
          ])
        ])
      ])
    );

    const products = extractRelatedProducts(doc);
    assert.strictEqual(products.length, 2);
    assert.strictEqual(products[0].title, 'ZeroGPT AI Detector Pro');
    assert.strictEqual(products[0].merchant, 'ZeroGPT');
    assert.strictEqual(products[0].price, '$9.99/mo');
    assert.strictEqual(products[0].rating, '4.8 (120)');
    assert.strictEqual(products[1].title, 'DeepMedia AI Forensics');
    assert.strictEqual(products[1].price, 'Free trial');
  });
});

describe('5. People Also Ask (PAA)', () => {
  it('should extract questions and answers from PAA section', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { class: 'MjjYud' }, '', [
          new MockElement('h2', {}, 'People also ask'),
          new MockElement('div', { role: 'button', 'data-q': 'What is the most accurate AI image detector?' }, 'What is the most accurate AI image detector?', [
            new MockElement('div', { class: 'hgKElc' }, 'Hive Moderation and ZeroGPT are widely considered accurate.'),
            new MockElement('a', { href: 'https://www.forbes.com/advisor/ai-tools' }, 'Forbes')
          ])
        ])
      ])
    );

    const paa = extractPeopleAlsoAsk(doc);
    assert.strictEqual(paa.length, 1);
    assert.strictEqual(paa[0].question, 'What is the most accurate AI image detector?');
    assert.strictEqual(paa[0].answer, 'Hive Moderation and ZeroGPT are widely considered accurate.');
    assert.strictEqual(paa[0].sourceDomain, 'forbes.com');
  });
});

describe('6. Sponsored Ads', () => {
  it('should extract sponsored text ads with title, domain, and snippet', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { id: 'tads' }, '', [
          new MockElement('div', { 'data-text-ad': '1' }, '', [
            new MockElement('h3', {}, 'Copyleaks AI Image Detector'),
            new MockElement('a', { href: 'https://copyleaks.com/ai-image-detector' }, 'https://copyleaks.com'),
            new MockElement('div', { class: 'Va3FIb' }, 'Detect AI generated images instantly with 99% accuracy.')
          ])
        ])
      ])
    );

    const ads = extractSponsoredAds(doc);
    assert.strictEqual(ads.length, 1);
    assert.strictEqual(ads[0].rank, 1);
    assert.strictEqual(ads[0].title, 'Copyleaks AI Image Detector');
    assert.strictEqual(ads[0].domain, 'copyleaks.com');
    assert.strictEqual(ads[0].snippet, 'Detect AI generated images instantly with 99% accuracy.');
  });
});

describe('7. Multi-Module Exporter (CSV & TSV)', () => {
  it('should export products to CSV with UTF-8 BOM', () => {
    const products = [
      { title: 'Test Product', merchant: 'MerchantA', price: '$19.99', rating: '4.8', url: 'https://test.com' }
    ];
    const csv = productsToCsv(products);
    assert.strictEqual(csv.startsWith('\uFEFF'), true);
    assert.strictEqual(csv.includes('产品/服务名称 (Product Title)'), true);
    assert.strictEqual(csv.includes('MerchantA'), true);
    assert.strictEqual(csv.includes('$19.99'), true);
  });

  it('should export keywords to TSV', () => {
    const kws = [
      { keyword: 'ai detector free', source: 'Google: PASF', volume: '10K', cpc: '$1.00', url: 'https://google.com' }
    ];
    const tsv = keywordsToTsv(kws);
    assert.strictEqual(tsv.includes('ai detector free\t'), true);
    assert.strictEqual(tsv.includes('推荐关键词 (Keyword)'), true);
  });
});

describe('8. Keywords Everywhere Widgets & SEO Difficulty (User Uploaded Images)', () => {
  it('should extract SEO Difficulty card matching screenshot metrics', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { id: 'xt-difficulty-root' },
          'SEO Difficulty 56/100 Brand Query No Off-Page Difficulty 56/100 On-Page Difficulty 55/100'
        ),
        new MockElement('div', { id: 'xt-trend-chart-root' },
          'Trend Data For ai photo detector (Global)'
        )
      ])
    );

    const diff = extractSeoDifficulty(doc);
    assert.strictEqual(diff.hasDifficulty, true);
    assert.strictEqual(diff.seoDifficulty, '56/100');
    assert.strictEqual(diff.brandQuery, 'No');
    assert.strictEqual(diff.offPageDifficulty, '56/100');
    assert.strictEqual(diff.onPageDifficulty, '55/100');
    assert.strictEqual(diff.trendTitle, 'Trend Data For ai photo detector (Global)');
  });

  it('should extract Long-Tail & Trending keywords from KE widgets', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { id: 'xt-google-ltkwid' }, '', [
          new MockElement('a', { href: 'https://www.google.com/search?q=ai+photo+detector+free' }, 'ai photo detector free'),
          new MockElement('a', { href: 'https://www.google.com/search?q=ai+photo+detector+remover' }, 'ai photo detector remover'),
          new MockElement('a', { href: 'https://www.google.com/search?q=ai+photo+detector+bypass' }, 'ai photo detector bypass')
        ]),
        new MockElement('div', { id: 'xt-google-trenkw' }, '', [
          new MockElement('a', { href: 'https://www.google.com/search?q=ai+image+humanizer' }, 'ai image humanizer'),
          new MockElement('a', { href: 'https://www.google.com/search?q=humanizer' }, 'humanizer')
        ])
      ])
    );

    const kws = extractRelatedKeywords(doc);
    const lt = kws.filter(k => k.source.includes('Long-Tail'));
    const tren = kws.filter(k => k.source.includes('Trending'));

    assert.strictEqual(lt.length, 3);
    assert.strictEqual(lt[0].keyword, 'ai photo detector free');
    assert.strictEqual(tren.length, 2);
    assert.strictEqual(tren[0].keyword, 'ai image humanizer');
  });
});

describe('9. Plugin Readiness and Decoupled Safety', () => {
  it('should identify NO_PLUGINS state when neither AITDK nor KE is installed', () => {
    const doc = new MockDocument(new MockElement('div', {}, ''));
    const items = [{ rank: 1, aitdkReady: false, keReady: false }];
    const readiness = assessPluginReadiness(doc, items);

    assert.strictEqual(readiness.state, 'NO_PLUGINS');
    assert.strictEqual(readiness.isSettled, true);
    assert.strictEqual(readiness.aitdk.detected, false);
    assert.strictEqual(readiness.ke.detected, false);
  });

  it('should identify LOADING state when AITDK shows loading spinners', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { class: 'aitdk-site-metrics-container' }, '', [
          new MockElement('span', { class: 'aitdk-dots-loading' }, '...')
        ])
      ])
    );
    const items = [{ rank: 1, aitdkReady: false, keReady: false }];
    const readiness = assessPluginReadiness(doc, items);

    assert.strictEqual(readiness.state, 'LOADING');
    assert.strictEqual(readiness.isSettled, false);
    assert.strictEqual(readiness.aitdk.detected, true);
  });

  it('should identify READY state when metrics have loaded', () => {
    const doc = new MockDocument(
      new MockElement('div', {}, '', [
        new MockElement('div', { class: 'aitdk-site-metrics' }, 'Monthly Visits: 20M'),
        new MockElement('div', { class: 'xt-google-domain-link-metrics' }, 'MOZ DA: 50')
      ])
    );
    const items = [{ rank: 1, aitdkReady: true, keReady: true }];
    const readiness = assessPluginReadiness(doc, items);

    assert.strictEqual(readiness.state, 'READY');
    assert.strictEqual(readiness.isSettled, true);
    assert.strictEqual(readiness.aitdk.loadedCount, 1);
    assert.strictEqual(readiness.ke.loadedCount, 1);
  });
});

describe('10. Pagination Recognition, Global Ranking & Multi-Page Session Accumulation', () => {
  it('should correctly parse pagination from URL parameters', () => {
    const p1 = extractPageInfo(null, 'https://www.google.com/search?q=ai+detector');
    assert.strictEqual(p1.pageNumber, 1);
    assert.strictEqual(p1.startOffset, 0);
    assert.strictEqual(p1.isFirstPage, true);

    const p2 = extractPageInfo(null, 'https://www.google.com/search?q=ai+detector&start=10');
    assert.strictEqual(p2.pageNumber, 2);
    assert.strictEqual(p2.startOffset, 10);
    assert.strictEqual(p2.isFirstPage, false);

    const p5 = extractPageInfo(null, 'https://www.google.com/search?q=ai+detector&start=40');
    assert.strictEqual(p5.pageNumber, 5);
    assert.strictEqual(p5.startOffset, 40);
    assert.strictEqual(p5.isFirstPage, false);
  });

  it('should assign global ranks on Page 2 starting from 11', () => {
    const doc = new MockDocument(
      new MockElement('div', { id: 'search' }, '', [
        new MockElement('div', { class: 'g' }, '', [
          new MockElement('a', { href: 'https://example.com/p2-item1' }, '', [
            new MockElement('h3', {}, 'Example P2 Item 1')
          ])
        ]),
        new MockElement('div', { class: 'g' }, '', [
          new MockElement('a', { href: 'https://example.com/p2-item2' }, '', [
            new MockElement('h3', {}, 'Example P2 Item 2')
          ])
        ])
      ])
    );

    const data = parseCurrentPage(doc, { currentUrl: 'https://www.google.com/search?q=test&start=10' });
    assert.strictEqual(data.pageInfo.pageNumber, 2);
    assert.strictEqual(data.items.length, 2);

    assert.strictEqual(data.items[0].rank, 11);
    assert.strictEqual(data.items[0].page, 2);
    assert.strictEqual(data.items[0].pageRank, 1);

    assert.strictEqual(data.items[1].rank, 12);
    assert.strictEqual(data.items[1].page, 2);
    assert.strictEqual(data.items[1].pageRank, 2);
  });

  it('should merge multi-page data and sort by global rank', () => {
    const page1Data = {
      query: 'ai detector',
      items: [
        { rank: 1, page: 1, url: 'https://a.com', title: 'A' },
        { rank: 2, page: 1, url: 'https://b.com', title: 'B' }
      ],
      relatedKeywords: [{ keyword: 'ai check', source: 'Google' }]
    };

    const page2Data = {
      query: 'ai detector',
      items: [
        { rank: 11, page: 2, url: 'https://c.com', title: 'C' },
        { rank: 12, page: 2, url: 'https://d.com', title: 'D' }
      ],
      relatedKeywords: [{ keyword: 'ai detect free', source: 'Google' }]
    };

    const merged = mergeMultiPageData(page1Data, page2Data);
    assert.strictEqual(merged.items.length, 4);
    assert.strictEqual(merged.items[0].rank, 1);
    assert.strictEqual(merged.items[2].rank, 11);
    assert.deepStrictEqual(merged.collectedPages, [1, 2]);
    assert.strictEqual(merged.relatedKeywords.length, 2);
  });

  it('should include Page and PageRank in CSV/TSV export', () => {
    const sampleItems = [
      { rank: 11, page: 2, pageRank: 1, query: 'test', title: 'P2 Title', url: 'https://test.com', domain: 'test.com' }
    ];
    const csv = itemsToCsv(sampleItems);
    assert(csv.includes('全局排名 (Rank)'));
    assert(csv.includes('所属页码 (Page)'));
    assert(csv.includes('页内名次 (Page Rank)'));
    assert(csv.includes('11,2,1'));

    const tsv = itemsToTsv(sampleItems);
    assert(tsv.includes('全局排名 (Rank)\t所属页码 (Page)\t页内名次 (Page Rank)'));
    assert(tsv.includes('11\t2\t1\ttest\tP2 Title'));
  });

  it('should preserve AITDK metrics on re-scan and merge incoming metrics without data loss', () => {
    // Existing data had AITDK
    const existing = {
      query: 'ai detector',
      items: [
        { rank: 1, url: 'https://example.com', title: 'Ex', monthlyVisits: '7.27M', avgDuration: '00:04:03', domainCreated: '2023-04-06', aitdkReady: true }
      ]
    };

    // New scan occurs before AITDK finishes loading (AITDK is empty)
    const newScanLoading = {
      query: 'ai detector',
      items: [
        { rank: 1, url: 'https://example.com', title: 'Ex', monthlyVisits: '', avgDuration: '', domainCreated: '', aitdkReady: false }
      ]
    };

    const mergedWhileLoading = mergeMultiPageData(existing, newScanLoading);
    assert.strictEqual(mergedWhileLoading.items[0].monthlyVisits, '7.27M');
    assert.strictEqual(mergedWhileLoading.items[0].avgDuration, '00:04:03');
    assert.strictEqual(mergedWhileLoading.items[0].domainCreated, '2023-04-06');

    // New scan arrives with updated metrics
    const newScanLoaded = {
      query: 'ai detector',
      items: [
        { rank: 1, url: 'https://example.com', title: 'Ex', monthlyVisits: '8.10M', avgDuration: '00:04:15', domainCreated: '2023-04-06', aitdkReady: true }
      ]
    };

    const mergedAfterLoad = mergeMultiPageData(existing, newScanLoaded);
    assert.strictEqual(mergedAfterLoad.items[0].monthlyVisits, '8.10M');
    assert.strictEqual(mergedAfterLoad.items[0].avgDuration, '00:04:15');
  });
});

console.log('\n====================================================');
console.log(`✅ Results: ${passedTests}/${totalTests} tests passed`);
console.log('====================================================');
