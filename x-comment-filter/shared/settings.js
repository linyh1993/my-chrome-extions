/** @file 设置读写与默认值 */
const XcfSettings = (() => {
  const STORAGE_KEY = 'xcf_settings';

  const DEFAULTS = {
    enabled: true,
    displayMode: XCF.DISPLAY_MODE.FOLD,
    contexts: {
      [XCF.CONTEXT.POST_THREAD]: true,
      [XCF.CONTEXT.TIMELINE]: false,
      [XCF.CONTEXT.ARTICLE]: false,
      [XCF.CONTEXT.SEARCH]: false
    },
    rules: {
      blocklist: true,
      emoji_spam: true,
      display_name_keywords: true
    },
    blocklist: [],
    whitelist: [],
    displayNameKeywords: [
      '同城',
      '上门',
      '破处',
      '免费线下',
      '纯曰',
      '约炮',
      '兼职'
    ]
  };

  function merge(base, patch) {
    const out = { ...base, ...patch };
    if (patch.contexts) out.contexts = { ...base.contexts, ...patch.contexts };
    if (patch.rules) out.rules = { ...base.rules, ...patch.rules };
    return out;
  }

  function load() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULTS }, (data) => {
        resolve(merge(DEFAULTS, data[STORAGE_KEY] || {}));
      });
    });
  }

  function save(partial) {
    return load().then((current) => {
      const next = merge(current, partial);
      return new Promise((resolve) => {
        chrome.storage.sync.set({ [STORAGE_KEY]: next }, () => resolve(next));
      });
    });
  }

  function normalizeHandle(handle) {
    if (!handle) return '';
    return String(handle).replace(/^@/, '').trim().toLowerCase();
  }

  return { DEFAULTS, STORAGE_KEY, load, save, merge, normalizeHandle };
})();
