/**
 * @file 平台注册中心 (Extensible Sites Registry)
 * 统一注册受支持的各平台规则，包括网络请求过滤规则、WebSocket 规则及 DOM 提取器映射。
 * 未来新增平台只需在此处增加一条规则对象，无需修改核心网络监听与中继代码。
 */
const SitesRegistry = (() => {
  const WS_PROTOCOLS = new Set(['ws:', 'wss:']);

  /**
   * 平台规则定义列表
   */
  const SITES = [
    {
      id: 'x',
      label: 'X (Twitter)',
      description: 'Twitter / X GraphQL API 与实时 WebSocket 流量',
      hosts: ['x.com', 'twitter.com'],
      urlPatterns: [
        '*://*.x.com/*',
        '*://x.com/*',
        '*://*.twitter.com/*',
        '*://twitter.com/*'
      ],
      network: {
        enabled: true,
        jsonOnly: true,
        pathIncludes: ['/i/api/graphql', '/api/graphql', '/i/api/2/'],
        webSocketPathIncludes: []
      },
      dom: {
        enabled: false,
        extractorId: null
      }
    },
    {
      id: 'reddit',
      label: 'Reddit',
      description: 'Reddit 帖子流、GraphQL API 与前端 Feed 提取',
      hosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'sh.reddit.com'],
      urlPatterns: [
        '*://*.reddit.com/*',
        '*://reddit.com/*'
      ],
      network: {
        enabled: true,
        jsonOnly: true,
        pathIncludes: ['/svc/shreddit/', 'gql.reddit.com', '/api/v1/', '/r/'],
        webSocketPathIncludes: []
      },
      dom: {
        enabled: true,
        extractorId: 'reddit'
      }
    }
  ];

  function getAllSites() {
    return SITES;
  }

  function getSiteById(id) {
    return SITES.find((s) => s.id === id) || null;
  }

  function hostMatches(hostname, hosts) {
    const h = (hostname || '').toLowerCase();
    return hosts.some((pattern) => {
      const p = pattern.toLowerCase();
      return h === p || h.endsWith('.' + p);
    });
  }

  function getSiteByHostname(hostname) {
    return SITES.find((site) => hostMatches(hostname, site.hosts)) || null;
  }

  function getSiteByUrl(url) {
    try {
      const parsed = new URL(url);
      return getSiteByHostname(parsed.hostname);
    } catch {
      return null;
    }
  }

  function getAllUrlPatterns() {
    const patterns = new Set();
    for (const site of SITES) {
      for (const p of site.urlPatterns || []) {
        patterns.add(p);
      }
    }
    return [...patterns];
  }

  function requestUrlMatchesSite(url, site) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return hostMatches(parsed.hostname, site.hosts);
    } catch {
      return false;
    }
  }

  function urlMatchesPathRules(url, pathIncludes) {
    if (!pathIncludes || pathIncludes.length === 0) return true;
    return pathIncludes.some((rule) => url.includes(rule));
  }

  function shouldTrackRequest(url, site) {
    if (!site?.network?.enabled) return false;
    if (!requestUrlMatchesSite(url, site)) return false;
    if (site.network.pathIncludes?.length > 0) {
      return urlMatchesPathRules(url, site.network.pathIncludes);
    }
    return !!site.network.jsonOnly;
  }

  function shouldTrackWebSocket(url, site) {
    if (!site?.network?.enabled) return false;
    try {
      const parsed = new URL(url);
      if (!WS_PROTOCOLS.has(parsed.protocol)) return false;
      if (!hostMatches(parsed.hostname, site.hosts)) return false;
      if (site.network.webSocketPathIncludes?.length > 0) {
        return urlMatchesPathRules(url, site.network.webSocketPathIncludes);
      }
      return true;
    } catch {
      return false;
    }
  }

  function getResponseMimeType(response) {
    if (response?.mimeType) return response.mimeType;
    const headers = response?.headers || {};
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'content-type') {
        return typeof value === 'string' ? value : String(value);
      }
    }
    return '';
  }

  function isJsonMimeType(mimeType) {
    if (!mimeType) return false;
    const m = mimeType.toLowerCase().split(';')[0].trim();
    return m === 'application/json' || m.endsWith('+json') || m === 'text/json';
  }

  function isJsonResponse(response) {
    return isJsonMimeType(getResponseMimeType(response));
  }

  return {
    getAllSites,
    getSiteById,
    getSiteByHostname,
    getSiteByUrl,
    getAllUrlPatterns,
    shouldTrackRequest,
    shouldTrackWebSocket,
    isJsonResponse,
    getResponseMimeType
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SitesRegistry;
}
