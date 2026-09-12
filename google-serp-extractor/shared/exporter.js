/**
 * Exporter utility for Google SERP & SEO Extractor
 * Supports CSV (with UTF-8 BOM for Excel), TSV (for clipboard pasting into Sheets/Excel), and JSON.
 * Covers: SERP Organic, Related Keywords (PASF), Products & Services, PAA, and Sponsored Ads.
 */

const GSE_SERP_COLUMNS = [
  { key: 'rank', label: '全局排名 (Rank)' },
  { key: 'page', label: '所属页码 (Page)' },
  { key: 'pageRank', label: '页内名次 (Page Rank)' },
  { key: 'query', label: '搜索词 (Query)' },
  { key: 'title', label: '标题 (Title)' },
  { key: 'url', label: 'URL' },
  { key: 'domain', label: '域名 (Domain)' },
  { key: 'snippet', label: '摘要 (Snippet)' },
  { key: 'mozDa', label: 'MOZ DA' },
  { key: 'mozDaTrend', label: 'DA走势 (DA Trend)' },
  { key: 'refDom', label: '引荐主域 (Ref Dom)' },
  { key: 'refLinks', label: '外链数 (Ref Links)' },
  { key: 'spamScore', label: '垃圾得分 (Spam Score)' },
  { key: 'pageTraffic', label: '页面流量 (Page Traffic)' },
  { key: 'siteTraffic', label: '整站流量 (Site Traffic)' },
  { key: 'pageKeywords', label: '页面关键词数 (Page Keywords)' },
  { key: 'siteKeywords', label: '整站关键词数 (Site Keywords)' },
  { key: 'monthlyVisits', label: '月访问量 (Monthly Visits)' },
  { key: 'avgDuration', label: '平均时长 (Avg Duration)' },
  { key: 'domainCreated', label: '域名建立时间 (Domain Created)' },
  { key: 'resultStatsRaw', label: '搜索统计 (Result Stats)' },
  { key: 'pageVolumeInfo', label: '全局搜索量/CPC (Keywords Volume)' },
  { key: 'scrapedAt', label: '采集时间 (Scraped At)' }
];

const GSE_KEYWORDS_COLUMNS = [
  { key: 'keyword', label: '推荐关键词 (Keyword)' },
  { key: 'source', label: '来源模块 (Source)' },
  { key: 'volume', label: '预估月搜索量 (Volume)' },
  { key: 'cpc', label: 'CPC 竞价成本' },
  { key: 'url', label: '搜索链接 (URL)' }
];

const GSE_PRODUCTS_COLUMNS = [
  { key: 'title', label: '产品/服务名称 (Product Title)' },
  { key: 'merchant', label: '商家/品牌 (Merchant)' },
  { key: 'price', label: '价格 (Price)' },
  { key: 'rating', label: '评分 (Rating)' },
  { key: 'url', label: '产品链接 (URL)' }
];

const GSE_PAA_COLUMNS = [
  { key: 'question', label: '搜索意图问题 (Question)' },
  { key: 'answer', label: '回答摘要 (Answer Snippet)' },
  { key: 'sourceDomain', label: '来源网站 (Source Domain)' },
  { key: 'sourceUrl', label: '来源链接 (Source URL)' }
];

const GSE_ADS_COLUMNS = [
  { key: 'rank', label: '广告位 (Rank)' },
  { key: 'title', label: '广告标题 (Ad Title)' },
  { key: 'domain', label: '投放商家 (Domain)' },
  { key: 'url', label: '着陆页链接 (URL)' },
  { key: 'snippet', label: '广告文案 (Snippet)' }
];

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeTsvCell(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ');
}

function generateTableCsv(items, columns) {
  const header = columns.map(col => escapeCsvCell(col.label)).join(',');
  const rows = items.map(item => {
    return columns.map(col => escapeCsvCell(item[col.key] ?? '')).join(',');
  });
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

function generateTableTsv(items, columns) {
  const header = columns.map(col => escapeTsvCell(col.label)).join('\t');
  const rows = items.map(item => {
    return columns.map(col => escapeTsvCell(item[col.key] ?? '')).join('\t');
  });
  return [header, ...rows].join('\n');
}

function itemsToCsv(items) {
  return generateTableCsv(items, GSE_SERP_COLUMNS);
}

function itemsToTsv(items) {
  return generateTableTsv(items, GSE_SERP_COLUMNS);
}

function keywordsToCsv(keywords) {
  return generateTableCsv(keywords, GSE_KEYWORDS_COLUMNS);
}

function keywordsToTsv(keywords) {
  return generateTableTsv(keywords, GSE_KEYWORDS_COLUMNS);
}

function productsToCsv(products) {
  return generateTableCsv(products, GSE_PRODUCTS_COLUMNS);
}

function productsToTsv(products) {
  return generateTableTsv(products, GSE_PRODUCTS_COLUMNS);
}

function paaToCsv(paaList) {
  return generateTableCsv(paaList, GSE_PAA_COLUMNS);
}

function paaToTsv(paaList) {
  return generateTableTsv(paaList, GSE_PAA_COLUMNS);
}

function adsToCsv(ads) {
  return generateTableCsv(ads, GSE_ADS_COLUMNS);
}

function adsToTsv(ads) {
  return generateTableTsv(ads, GSE_ADS_COLUMNS);
}

function itemsToJson(data) {
  return JSON.stringify(data, null, 2);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) resolve();
      else reject(new Error('execCommand copy failed'));
    } catch (e) {
      document.body.removeChild(textarea);
      reject(e);
    }
  });
}

// Global export for content script & popup
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
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
    escapeCsvCell,
    escapeTsvCell
  };
} else {
  globalThis.GseExporter = {
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
    downloadFile,
    copyTextToClipboard
  };
}
