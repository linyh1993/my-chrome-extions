/** 多站点复刻配置（chrome.storage.local） */
const RelayConfig = (() => {
  const STORAGE_KEY = 'relayConfig';

  const DEFAULT_MIRROR = 'http://127.0.0.1:9090/mirror-traffic';

  const DEFAULT_SITES = [
    {
      id: 'x',
      label: 'X / Twitter',
      hosts: ['x.com', 'twitter.com'],
      pathIncludes: ['/api/graphql'],
      enabled: true
    },
    {
      id: 'sif',
      label: 'SIF',
      hosts: ['sif.com'],
      pathIncludes: ['/api/'],
      enabled: true
    }
  ];

  function linesToList(value) {
    if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
    return String(value || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function slugFromLabel(label) {
    return String(label || 'site')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'site';
  }

  function normalizeSite(raw, index) {
    const label = String(raw?.label || '').trim() || `站点 ${index + 1}`;
    const id = String(raw?.id || slugFromLabel(label)).trim() || `site-${index + 1}`;
    return {
      id,
      label,
      hosts: linesToList(raw?.hosts),
      pathIncludes: linesToList(raw?.pathIncludes),
      enabled: raw?.enabled !== false
    };
  }

  function normalize(raw) {
    const mirrorUrl = String(raw?.mirrorUrl || DEFAULT_MIRROR).trim() || DEFAULT_MIRROR;
    let sites;

    if (Array.isArray(raw?.sites) && raw.sites.length) {
      sites = raw.sites.map(normalizeSite).filter((s) => s.hosts.length);
    } else if (raw?.pathIncludes && !raw?.sites) {
      sites = [
        normalizeSite(
          {
            id: 'custom',
            label: '自定义',
            hosts: ['*'],
            pathIncludes: raw.pathIncludes,
            enabled: true
          },
          0
        )
      ];
    } else {
      sites = DEFAULT_SITES.map((s, i) => normalizeSite(s, i));
    }

    return { mirrorUrl, sites };
  }

  function hostMatches(hostname, hosts) {
    const h = (hostname || '').toLowerCase();
    if (hosts.includes('*')) return true;
    return hosts.some((pattern) => {
      const p = pattern.toLowerCase();
      return h === p || h.endsWith('.' + p);
    });
  }

  function findSiteByHostname(hostname, config) {
    return (
      config.sites.find((site) => site.enabled && hostMatches(hostname, site.hosts)) || null
    );
  }

  function load(callback) {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      callback(normalize(data[STORAGE_KEY]));
    });
  }

  function save(config, callback) {
    chrome.storage.local.set({ [STORAGE_KEY]: normalize(config) }, callback);
  }

  return {
    STORAGE_KEY,
    DEFAULT_MIRROR,
    DEFAULT_SITES,
    normalize,
    normalizeSite,
    linesToList,
    hostMatches,
    findSiteByHostname,
    load,
    save
  };
})();
