/**
 * Relay Client Utility for Google SERP & SEO Extractor
 * Encapsulates standard RelayEnvelope construction and HTTP dispatch to local proxy-server (http://127.0.0.1:9090/relay).
 * Dual-compatible with Node.js tests, Browser Content Script, and Background Service Worker.
 */

const DEFAULT_RELAY_ENDPOINT = 'http://127.0.0.1:9090/relay';
const RELAY_TIMEOUT_MS = 5000;

/**
 * Construct standard RelayEnvelope DTO
 */
function createSerpEnvelope(serpData, options = {}) {
  const data = serpData || {};
  const normalizedQuery = (data.query || '').trim().toLowerCase();
  const sourceUrl = options.sourceUrl || data.sourceUrl || (typeof window !== 'undefined' ? window.location?.href : '') || '';

  // Day dimension date string (YYYY-MM-DD) based on local timezone
  const now = new Date();
  const searchDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const pageNumber = data.pageInfo?.pageNumber || 1;
  const dedupKey = `${normalizedQuery}#p${pageNumber}#${searchDate}`;

  // Enrich items with deduplication metadata
  const items = (data.items || []).map(item => ({
    ...item,
    query: normalizedQuery,
    page: item.page || pageNumber,
    searchDate,
    itemDedupKey: `${normalizedQuery}#${item.url}#${searchDate}`
  }));

  return {
    version: '1.0',
    relaySource: 'google-serp-extractor',
    timestamp: now.toISOString(),
    site: {
      id: 'google',
      label: 'Google SERP'
    },
    channel: 'dom_extracted',
    action: 'data',
    sourceUrl,
    payload: {
      query: normalizedQuery,
      searchDate,
      pageNumber,
      dedupKey,
      scrapedAt: now.toISOString(),
      pageInfo: data.pageInfo || { pageNumber, isFirstPage: pageNumber === 1 },
      resultStats: data.resultStats || null,
      pageVolumeInfo: data.pageVolumeInfo || '',
      totalFound: data.totalFound || items.length,
      aitdkReadyCount: data.aitdkReadyCount || 0,
      keReadyCount: data.keReadyCount || 0,
      collectedPages: data.collectedPages || [pageNumber],
      readiness: data.readiness || null,
      items,
      relatedKeywords: data.relatedKeywords || [],
      relatedProducts: data.relatedProducts || [],
      peopleAlsoAsk: data.peopleAlsoAsk || [],
      sponsoredAds: data.sponsoredAds || [],
      aiOverview: data.aiOverview || null,
      discussions: data.discussions || []
    }
  };
}

/**
 * Ping local proxy-server for health check
 */
async function pingRelay(endpointUrl = DEFAULT_RELAY_ENDPOINT, timeoutMs = 3000) {
  const pingEnvelope = {
    version: '1.0',
    relaySource: 'google-serp-extractor',
    timestamp: new Date().toISOString(),
    site: { id: 'system', label: 'System' },
    channel: 'system_ping',
    action: 'ping',
    sourceUrl: '',
    payload: { message: 'Ping test from google-serp-extractor' }
  };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Relay-Site': 'system',
        'X-Relay-Channel': 'system_ping'
      },
      body: JSON.stringify(pingEnvelope),
      signal: controller ? controller.signal : undefined
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        ok: true,
        status: res.status,
        message: data.message || '连接成功 (Server OK)'
      };
    }

    return {
      ok: false,
      status: res.status,
      message: `服务响应异常: HTTP ${res.status}`
    };
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    return {
      ok: false,
      message: isTimeout ? '连接超时 (Timeout 3s)' : `连接失败: ${err?.message || '无法连接到本地服务'}`
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Send full SERP envelope to local proxy-server
 */
async function sendSerpEnvelope(endpointUrl = DEFAULT_RELAY_ENDPOINT, envelope, timeoutMs = RELAY_TIMEOUT_MS) {
  if (!envelope) {
    return { ok: false, error: 'Envelope payload is required' };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Relay-Site': envelope.site?.id || 'google',
        'X-Relay-Channel': envelope.channel || 'dom_extracted'
      },
      body: JSON.stringify(envelope),
      signal: controller ? controller.signal : undefined
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return {
        ok: true,
        status: res.status,
        message: json.message || '数据已成功保存至本地数据库',
        details: json.details || null
      };
    }

    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status} ${res.statusText}`
    };
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    return {
      ok: false,
      error: isTimeout ? '请求超时 (5s)' : (err?.message || '网络请求失败')
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Module export for Node.js / tests & Global assignment for Extension runtime
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_RELAY_ENDPOINT,
    RELAY_TIMEOUT_MS,
    createSerpEnvelope,
    pingRelay,
    sendSerpEnvelope
  };
} else {
  globalThis.GseRelayClient = {
    DEFAULT_RELAY_ENDPOINT,
    RELAY_TIMEOUT_MS,
    createSerpEnvelope,
    pingRelay,
    sendSerpEnvelope
  };
}
