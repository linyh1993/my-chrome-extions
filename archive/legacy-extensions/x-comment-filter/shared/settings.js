/** @file 设置读写与默认值 */
const XcfSettings = (() => {
  const STORAGE_KEY = 'xcf_settings';
  const SPAM_KEYWORDS_URL = 'data/spam-keywords.txt';

  /** 与 spam-keywords.txt 同步的三类规则（正文/昵称/引流昵称） */
  const SHARED_BUILTIN_RULE_KEYS = [
    'textKeywords',
    'displayNameKeywords',
    'nicknameSpamKeywords'
  ];

  const KEYWORD_LIST_KEYS = [
    'textKeywords',
    'displayNameKeywords',
    'nicknameSpamKeywords',
    'emojiSpamKeywords',
    'mentionSpamKeywords'
  ];

  /** fetch 失败时的最小兜底（与 spam-keywords.txt 保持同步） */
  const FALLBACK_SPAM_KEYWORDS = [
    '免费日p',
    '免费曰p',
    '免费日',
    '免费曰',
    '纯曰',
    '纯日',
    '约炮',
    '可约',
    '互关必回'
  ];

  let spamKeywordsCache = null;
  let spamKeywordsPromise = null;

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
    displayNameKeywords: [],
    nicknameSpamKeywords: [],
    emojiSpamKeywords: [],
    mentionSpamKeywords: [],
    panelUi: {
      hidden: false,
      collapsed: false
    }
  };

  function parseKeywordLines(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const t = line.replace(/\uFEFF/g, '').trim();
      if (!t || t.startsWith('#')) continue;
      out.push(t);
    }
    return out;
  }

  function loadSpamKeywordsFromFile() {
    if (spamKeywordsPromise) return spamKeywordsPromise;
    spamKeywordsPromise = (async () => {
      try {
        const url = chrome.runtime.getURL(SPAM_KEYWORDS_URL);
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const text = await res.text();
        const parsed = parseKeywordLines(text);
        spamKeywordsCache = parsed.length ? parsed : [...FALLBACK_SPAM_KEYWORDS];
      } catch {
        spamKeywordsCache = [...FALLBACK_SPAM_KEYWORDS];
      }
      return spamKeywordsCache;
    })();
    return spamKeywordsPromise;
  }

  function ensureSpamKeywords() {
    return loadSpamKeywordsFromFile();
  }

  function getSpamKeywordsCore() {
    return spamKeywordsCache ? [...spamKeywordsCache] : [];
  }

  function builtinListFor(key) {
    if (SHARED_BUILTIN_RULE_KEYS.includes(key)) {
      return getSpamKeywordsCore();
    }
    return [];
  }

  function mergeKeywordList(userList, builtinList) {
    const set = new Set();
    for (const kw of userList || []) {
      const k = String(kw || '').trim();
      if (k) set.add(k);
    }
    for (const kw of builtinList || []) {
      const k = String(kw || '').trim();
      if (k) set.add(k);
    }
    return [...set];
  }

  function normalizeSettings(raw) {
    const merged = merge(DEFAULTS, raw || {});
    merged.rules = { ...DEFAULTS.rules, ...(merged.rules || {}) };
    for (const key of KEYWORD_LIST_KEYS) {
      const builtins = builtinListFor(key);
      if (builtins.length) {
        merged[key] = mergeKeywordList(merged[key], builtins);
      }
    }
    return merged;
  }

  function merge(base, patch) {
    const out = { ...base, ...patch };
    if (patch.contexts) out.contexts = { ...base.contexts, ...patch.contexts };
    if (patch.rules) out.rules = { ...base.rules, ...patch.rules };
    if (patch.panelUi) out.panelUi = { ...base.panelUi, ...patch.panelUi };
    for (const key of KEYWORD_LIST_KEYS) {
      if (patch[key]) out[key] = [...(patch[key] || [])];
    }
    return out;
  }

  async function load() {
    await ensureSpamKeywords();
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

  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    loadSpamKeywordsFromFile().catch(() => {});
  }

  return {
    DEFAULTS,
    STORAGE_KEY,
    SPAM_KEYWORDS_URL,
    SHARED_BUILTIN_RULE_KEYS,
    KEYWORD_LIST_KEYS,
    ensureSpamKeywords,
    getSpamKeywordsCore,
    parseKeywordLines,
    load,
    save,
    merge,
    normalizeSettings,
    normalizeHandle,
    mergeKeywordList
  };
})();
