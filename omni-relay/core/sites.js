/**
 * @file 平台规则声明与 URL 匹配器 (Sites Registry & Matcher)
 * 纯声明式配置，未来新增平台仅需在此处添加一个配置对象。
 */

export const SITES = [
  {
    id: 'x',
    label: 'X (Twitter)',
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
      wsPathIncludes: []
    },
    dom: {
      enabled: false
    }
  },
  {
    id: 'reddit',
    label: 'Reddit',
    hosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'sh.reddit.com'],
    urlPatterns: [
      '*://*.reddit.com/*',
      '*://reddit.com/*'
    ],
    network: {
      enabled: true,
      jsonOnly: true,
      pathIncludes: ['/svc/shreddit/', 'gql.reddit.com', '/api/v1/'],
      wsPathIncludes: []
    },
    dom: {
      enabled: true
    }
  }
];

export function getSiteById(id) {
  return SITES.find((s) => s.id === id) || null;
}

export function matchSiteByHostname(hostname) {
  const host = (hostname || '').toLowerCase();
  return SITES.find((site) =>
    site.hosts.some((h) => host === h || host.endsWith('.' + h))
  ) || null;
}

export function matchSiteByUrl(url) {
  try {
    return matchSiteByHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

export function getAllSiteUrlPatterns() {
  const patterns = new Set();
  for (const site of SITES) {
    for (const pattern of site.urlPatterns) {
      patterns.add(pattern);
    }
  }
  return [...patterns];
}

export function shouldTrackRequest(url, site) {
  if (!site?.network?.enabled) return false;
  const pathRules = site.network.pathIncludes;
  if (!pathRules || pathRules.length === 0) return true;
  return pathRules.some((rule) => url.includes(rule));
}

export function shouldTrackWebSocket(url, site) {
  if (!site?.network?.enabled) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return false;
    const rules = site.network.wsPathIncludes;
    if (!rules || rules.length === 0) return true;
    return rules.some((rule) => url.includes(rule));
  } catch {
    return false;
  }
}
