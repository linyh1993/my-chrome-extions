/** @file 流量镜像设置（chrome.storage.sync） */
const MirrorSettings = (() => {
  const STORAGE_KEY = 'xsuite_mirror_settings';

  const DEFAULTS = {
    enabled: true,
    mirrorUrl: 'http://127.0.0.1:9090/mirror-traffic',
    pathIncludes: ['/api/graphql']
  };

  function merge(base, patch) {
    const out = { ...base, ...patch };
    if (patch.pathIncludes) out.pathIncludes = [...patch.pathIncludes];
    return out;
  }

  function normalize(raw) {
    const merged = merge(DEFAULTS, raw || {});
    merged.mirrorUrl = String(merged.mirrorUrl || DEFAULTS.mirrorUrl).trim();
    if (!merged.mirrorUrl) merged.mirrorUrl = DEFAULTS.mirrorUrl;
    merged.pathIncludes = (merged.pathIncludes || DEFAULTS.pathIncludes).filter(Boolean);
    if (!merged.pathIncludes.length) merged.pathIncludes = [...DEFAULTS.pathIncludes];
    merged.enabled = merged.enabled !== false;
    return merged;
  }

  function load() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULTS }, (data) => {
        resolve(normalize(data[STORAGE_KEY]));
      });
    });
  }

  function save(partial) {
    return load().then((cur) => {
      const next = normalize(merge(cur, partial || {}));
      return new Promise((resolve) => {
        chrome.storage.sync.set({ [STORAGE_KEY]: next }, () => resolve(next));
      });
    });
  }

  return { STORAGE_KEY, DEFAULTS, load, save, normalize };
})();
