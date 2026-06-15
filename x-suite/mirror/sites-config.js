// X 专用：GraphQL 流量镜像配置
const WS_PROTOCOLS = new Set(['ws:', 'wss:']);

const SITES = [
  {
    id: 'x',
    label: 'X',
    hosts: ['x.com', 'twitter.com'],
    pathIncludes: ['/api/graphql'],
    webSocketPathIncludes: [],
    urlPatterns: [
      '*://*.x.com/*',
      '*://x.com/*',
      '*://*.twitter.com/*',
      '*://twitter.com/*'
    ]
  }
];

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
    return getSiteByHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

function urlMatchesPathRules(url, pathIncludes) {
  return pathIncludes.some((rule) => url.includes(rule));
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

function shouldTrackRequest(url, site) {
  if (!requestUrlMatchesSite(url, site)) return false;
  if (site.pathIncludes?.length > 0) {
    return urlMatchesPathRules(url, site.pathIncludes);
  }
  return !!site.jsonResponsesOnly;
}

function shouldTrackWebSocket(url, site) {
  try {
    const parsed = new URL(url);
    if (!WS_PROTOCOLS.has(parsed.protocol)) return false;
    if (!hostMatches(parsed.hostname, site.hosts)) return false;
    if (site.webSocketPathIncludes?.length > 0) {
      return urlMatchesPathRules(url, site.webSocketPathIncludes);
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
