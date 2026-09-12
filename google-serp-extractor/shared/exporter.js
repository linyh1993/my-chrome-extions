/**
 * Exporter utility for Google SERP & SEO Extractor
 * Supports CSV (with UTF-8 BOM for Excel), TSV (for clipboard pasting into Sheets/Excel), and JSON.
 */

const GSE_COLUMNS = [
  { key: 'rank', label: '排名 (Rank)' },
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
  { key: 'pageVolumeInfo', label: '全局搜索量/CPC (Keywords Volume)' },
  { key: 'scrapedAt', label: '采集时间 (Scraped At)' }
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

function itemsToCsv(items) {
  const header = GSE_COLUMNS.map(col => escapeCsvCell(col.label)).join(',');
  const rows = items.map(item => {
    return GSE_COLUMNS.map(col => escapeCsvCell(item[col.key] ?? '')).join(',');
  });
  // \uFEFF ensures Excel interprets UTF-8 properly
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

function itemsToTsv(items) {
  const header = GSE_COLUMNS.map(col => escapeTsvCell(col.label)).join('\t');
  const rows = items.map(item => {
    return GSE_COLUMNS.map(col => escapeTsvCell(item[col.key] ?? '')).join('\t');
  });
  return [header, ...rows].join('\n');
}

function itemsToJson(items) {
  return JSON.stringify(items, null, 2);
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
    GSE_COLUMNS,
    itemsToCsv,
    itemsToTsv,
    itemsToJson,
    escapeCsvCell,
    escapeTsvCell
  };
} else {
  globalThis.GseExporter = {
    GSE_COLUMNS,
    itemsToCsv,
    itemsToTsv,
    itemsToJson,
    downloadFile,
    copyTextToClipboard
  };
}
