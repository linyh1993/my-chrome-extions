// 多站点配置：新增网站时在此添加一项，并同步更新 manifest.json 中的 matches / host_permissions
const SITES = [
  {
    id: 'x',
    label: 'X',
    hosts: ['x.com', 'twitter.com'],
    pathIncludes: ['/api/graphql'],
    mirrorUrl: 'http://127.0.0.1:9090/mirror-traffic',
    urlPatterns: [
      '*://*.x.com/*',
      '*://x.com/*',
      '*://*.twitter.com/*',
      '*://twitter.com/*'
    ]
  },
  {
    id: 'sif',
    label: 'SIF',
    hosts: ['sif.com'],
    pathIncludes: ['/api/'],
    jsonResponsesOnly: true,
    mirrorUrl: 'http://127.0.0.1:9090/mirror-traffic',
    urlPatterns: [
      '*://www.sif.com/*',
      '*://*.sif.com/*',
      '*://sif.com/*'
    ]
  }
  // 示例：取消注释并修改后即可启用另一站点
  // {
  //   id: 'example',
  //   label: 'Example',
  //   hosts: ['example.com'],
  //   pathIncludes: ['/api/'],
  //   mirrorUrl: 'http://127.0.0.1:9090/mirror-traffic',
  //   urlPatterns: ['*://*.example.com/*', '*://example.com/*']
  // }
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

function getAllUrlPatterns() {
  const seen = new Set();
  const patterns = [];
  for (const site of SITES) {
    for (const p of site.urlPatterns) {
      if (!seen.has(p)) {
        seen.add(p);
        patterns.push(p);
      }
    }
  }
  return patterns;
}

function urlMatchesPathRules(url, pathIncludes) {
  return pathIncludes.some((rule) => url.includes(rule));
}

function requestUrlMatchesSite(url, site) {
  try {
    return hostMatches(new URL(url).hostname, site.hosts);
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
