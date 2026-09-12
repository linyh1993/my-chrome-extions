/**
 * Google SERP & SEO Extractor - Automated Regression & Verification Suite
 * Run with: node google-serp-extractor/tests/parser.test.js
 */

const assert = require('assert');
const {
  extractSearchQuery,
  extractPageVolumeInfo,
  findResultContainers,
  normalizeGoogleUrl,
  extractDomain,
  extractSnippet,
  extractKeywordsEverywhereMetrics,
  extractAitdkMetrics,
  parseCurrentPage
} = require('../content/parser.js');

const {
  GSE_COLUMNS,
  itemsToCsv,
  itemsToTsv,
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

  matches(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return (this.attributes['class'] || '').split(/\s+/).includes(cls);
    }
    if (sel.startsWith('#')) {
      return this.attributes['id'] === sel.slice(1);
    }
    if (sel.startsWith('[')) {
      const attrName = sel.replace(/[\[\]]/g, '').split('=')[0];
      return Boolean(this.attributes[attrName]);
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
          // simple tag / class / id match
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

console.log('====================================================');
console.log('🧪 Running Google SERP & SEO Extractor Verification');
console.log('====================================================');

describe('1. URL Normalization and Domain Extraction', () => {
  it('should normalize google redirect URL', () => {
    const raw = 'https://www.google.com/url?q=https://deepai.org/ai-image-detector&sa=U';
    const norm = normalizeGoogleUrl(raw);
    assert.strictEqual(norm, 'https://deepai.org/ai-image-detector');
  });

  it('should extract clean hostname without www', () => {
    assert.strictEqual(extractDomain('https://www.zerogpt.com/ai-image-detector'), 'zerogpt.com');
    assert.strictEqual(extractDomain('https://deepai.org/tools'), 'deepai.org');
    assert.strictEqual(extractDomain('https://reddit.com/r/isitAI'), 'reddit.com');
  });
});

describe('2. Keywords Everywhere Metrics Extraction', () => {
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

  it('should extract Moz DA and single-value traffic for Reddit sample', () => {
    const container = new MockElement('div', { class: 'g' }, '', [
      new MockElement('div', { class: 'xt-google-domain-link-metrics' },
        'MOZ DA: 92/100 (+0%) Ref Dom: 2.06M Ref Links: 2.9B Spam Score: 3% Show backlinks'
      ),
      new MockElement('div', { class: 'xt-google-url-metrics' },
        'Search traffic (us): 831.56M/mo - Keywords (us): 133.05M'
      )
    ]);

    const metrics = extractKeywordsEverywhereMetrics(container);
    assert.strictEqual(metrics.mozDa, '92/100');
    assert.strictEqual(metrics.mozDaTrend, '+0%');
    assert.strictEqual(metrics.refDom, '2.06M');
    assert.strictEqual(metrics.refLinks, '2.9B');
    assert.strictEqual(metrics.spamScore, '3%');
    assert.strictEqual(metrics.pageTraffic, '831.56M/mo');
    assert.strictEqual(metrics.siteTraffic, '831.56M/mo');
    assert.strictEqual(metrics.pageKeywords, '133.05M');
    assert.strictEqual(metrics.siteKeywords, '133.05M');
    assert.strictEqual(metrics.keReady, true);
  });
});

describe('3. AITDK Metrics Extraction', () => {
  it('should extract Monthly Visits, Avg Duration, and Domain Created (ZeroGPT sample)', () => {
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

  it('should extract Monthly Visits, Avg Duration, and Domain Created (DeepAI sample)', () => {
    const container = new MockElement('div', { class: 'g' }, '', [
      new MockElement('div', { class: 'aitdk-site-metrics-container' },
        'AITDK | Monthly Visits: 8.59M | Avg. Visit Duration: 00:01:47 | Domain Created: 2016-11-30'
      )
    ]);

    const metrics = extractAitdkMetrics(container);
    assert.strictEqual(metrics.monthlyVisits, '8.59M');
    assert.strictEqual(metrics.avgDuration, '00:01:47');
    assert.strictEqual(metrics.domainCreated, '2016-11-30');
    assert.strictEqual(metrics.aitdkReady, true);
  });
});

describe('4. Exporter Functionality (CSV, TSV, JSON)', () => {
  const sampleItems = [
    {
      rank: 1,
      query: 'ai photo detector',
      title: 'AI Image Detector | Detect AI-Generated Images for Free',
      url: 'https://deepai.org/ai-image-detector',
      domain: 'deepai.org',
      snippet: 'Use our free AI Image Detector to check if an image was generated by AI.',
      mozDa: '60/100',
      mozDaTrend: '+5%',
      refDom: '23.24K',
      refLinks: '5.12M',
      spamScore: '1%',
      pageTraffic: '0/mo',
      siteTraffic: '1.76M/mo',
      pageKeywords: '0',
      siteKeywords: '45.70K',
      monthlyVisits: '8.59M',
      avgDuration: '00:01:47',
      domainCreated: '2016-11-30',
      pageVolumeInfo: 'Volume: *****/mo | CPC: $*.** | Competition: *.**',
      scrapedAt: '2026-09-12 10:00:00'
    },
    {
      rank: 2,
      query: 'ai photo detector',
      title: 'AI Image Detector - Detect AI Generated Images',
      url: 'https://www.zerogpt.com/ai-image-detector',
      domain: 'zerogpt.com',
      snippet: 'ZeroGPT\'s AI image detector can analyze images created by popular AI image generators.',
      mozDa: '56/100',
      mozDaTrend: '+87%',
      refDom: '9K',
      refLinks: '119.1K',
      spamScore: '-',
      pageTraffic: '0/mo',
      siteTraffic: '151.80K/mo',
      pageKeywords: '0',
      siteKeywords: '8605',
      monthlyVisits: '20.51M',
      avgDuration: '00:03:10',
      domainCreated: '2023-01-05',
      pageVolumeInfo: 'Volume: *****/mo | CPC: $*.** | Competition: *.**',
      scrapedAt: '2026-09-12 10:00:00'
    }
  ];

  it('should generate CSV with UTF-8 BOM and correct column headers', () => {
    const csv = itemsToCsv(sampleItems);
    assert.strictEqual(csv.startsWith('\uFEFF'), true, 'Must start with UTF-8 BOM');
    assert.strictEqual(csv.includes('排名 (Rank)'), true);
    assert.strictEqual(csv.includes('MOZ DA'), true);
    assert.strictEqual(csv.includes('月访问量 (Monthly Visits)'), true);
    assert.strictEqual(csv.includes('zerogpt.com'), true);
    assert.strictEqual(csv.includes('20.51M'), true);
  });

  it('should escape CSV values containing commas and quotes', () => {
    const escaped = escapeCsvCell('Hello, "World"');
    assert.strictEqual(escaped, '"Hello, ""World"""');
  });

  it('should generate TSV separated by tabs for seamless Excel/Sheets pasting', () => {
    const tsv = itemsToTsv(sampleItems);
    const lines = tsv.split('\n');
    assert.strictEqual(lines.length, 3); // 1 header + 2 items
    assert.strictEqual(lines[1].includes('\tdeepai.org\t'), true);
    assert.strictEqual(lines[2].includes('\tzerogpt.com\t'), true);
  });

  it('should generate valid JSON string', () => {
    const jsonStr = itemsToJson(sampleItems);
    const parsed = JSON.parse(jsonStr);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].domain, 'deepai.org');
    assert.strictEqual(parsed[1].domain, 'zerogpt.com');
  });
});

console.log('\n====================================================');
console.log(`✅ Results: ${passedTests}/${totalTests} tests passed`);
console.log('====================================================');
