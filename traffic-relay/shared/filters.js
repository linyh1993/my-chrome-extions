/** URL 解析与 GET/POST + JSON/GraphQL 过滤 */

const TRACK_METHODS = new Set(['GET', 'POST']);

const DEFAULT_PATH_INCLUDES = ['/api/graphql', '/graphql', '/api/'];

function parseHttpPage(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return { hostname: hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function pathRulesForSite(site) {
  return site.pathIncludes?.length ? site.pathIncludes : DEFAULT_PATH_INCLUDES;
}

function urlMatchesPathRules(url, pathIncludes) {
  return pathIncludes.some((rule) => url.includes(rule));
}

function shouldTrackRequest(requestUrl, requestMethod, site) {
  if (!TRACK_METHODS.has((requestMethod || '').toUpperCase())) return false;

  let reqHost;
  try {
    reqHost = new URL(requestUrl).hostname;
  } catch {
    return false;
  }

  if (!RelayConfig.hostMatches(reqHost, site.hosts)) return false;
  return urlMatchesPathRules(requestUrl, pathRulesForSite(site));
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

function isJsonResponse(response) {
  const mime = getResponseMimeType(response);
  if (!mime) return false;
  const m = mime.toLowerCase().split(';')[0].trim();
  return m === 'application/json' || m.endsWith('+json') || m === 'text/json';
}
