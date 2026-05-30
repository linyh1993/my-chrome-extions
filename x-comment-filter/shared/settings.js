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
      promoted_ad: true,
      text_keywords: true,
      probable_spam: true,
      mention_spam: true,
      emoji_spam: true,
      display_name_keywords: true,
      nickname_spam: true
    },
    blocklist: [],
    whitelist: [],
    textKeywords: [],
    displayNameKeywords: [
      '同城',
      '上门',
      '破处',
      '免费线下',
      '纯曰',
      '约炮',
      '兼职',
      '寻固炮',
      '点击主页',
      '固炮',
      '有关必回'
    ],
    panelUi: {
      hidden: false,
      collapsed: false
    }
  };

  const BUILTIN_DISPLAY_NAME_KEYWORDS = DEFAULTS.displayNameKeywords;

  function mergeDisplayNameKeywords(list) {
    const set = new Set([...(list || [])]);
    for (const kw of BUILTIN_DISPLAY_NAME_KEYWORDS) set.add(kw);
    return [...set];
  }

  function normalizeSettings(raw) {
    const merged = merge(DEFAULTS, raw || {});
    merged.rules = { ...DEFAULTS.rules, ...(merged.rules || {}) };
    merged.displayNameKeywords = mergeDisplayNameKeywords(
      merged.displayNameKeywords
    );
    return merged;
  }

  function merge(base, patch) {
    const out = { ...base, ...patch };
    if (patch.contexts) out.contexts = { ...base.contexts, ...patch.contexts };
    if (patch.rules) out.rules = { ...base.rules, ...patch.rules };
    if (patch.panelUi) out.panelUi = { ...base.panelUi, ...patch.panelUi };
    if (patch.textKeywords) out.textKeywords = [...(patch.textKeywords || [])];
    if (patch.displayNameKeywords) {
      out.displayNameKeywords = [...(patch.displayNameKeywords || [])];
    }
    return out;
  }

  function load() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULTS }, (data) => {
        resolve(normalizeSettings(data[STORAGE_KEY]));
      });
    });
  }

  function save(partial) {
    return load().then((current) => {
      const next = normalizeSettings(merge(current, partial));
      return new Promise((resolve) => {
        chrome.storage.sync.set({ [STORAGE_KEY]: next }, () => resolve(next));
      });
    });
  }

  function normalizeHandle(handle) {
    if (!handle) return '';
    return String(handle).replace(/^@/, '').trim().toLowerCase();
  }

  return {
    DEFAULTS,
    STORAGE_KEY,
    load,
    save,
    merge,
    normalizeSettings,
    normalizeHandle
  };
})();
