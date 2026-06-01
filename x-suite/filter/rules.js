/** @file 过滤规则（与 DOM 无关，可复用于其他站点） */
const XcfRules = (() => {
  const RULE_ORDER = [
    'blocklist',
    'promoted_ad',
    'display_name_keywords',
    'nickname_spam',
    'text_keywords',
    'probable_spam',
    'mention_spam',
    'emoji_spam'
  ];

  const RULE_META = {
    blocklist: { id: 'blocklist', label: '屏蔽账号' },
    promoted_ad: { id: 'promoted_ad', label: '推广/广告' },
    text_keywords: { id: 'text_keywords', label: '评论含关键词' },
    probable_spam: { id: 'probable_spam', label: 'X 疑似垃圾区' },
    mention_spam: { id: 'mention_spam', label: '短句多 @ 提及' },
    emoji_spam: { id: 'emoji_spam', label: '纯表情/无意义符号' },
    display_name_keywords: { id: 'display_name_keywords', label: '昵称含关键词' },
    nickname_spam: { id: 'nickname_spam', label: '引流昵称关键词' }
  };

  const TEXT_RULES = new Set(['text_keywords', 'mention_spam', 'emoji_spam']);

  const KEYWORD_SETTINGS_KEY = {
    text_keywords: 'textKeywords',
    display_name_keywords: 'displayNameKeywords',
    nickname_spam: 'nicknameSpamKeywords',
    emoji_spam: 'emojiSpamKeywords',
    mention_spam: 'mentionSpamKeywords'
  };

  function isEmojiSpam(text) {
    const raw = (text || '').trim();
    if (!raw) return false;

    const compact = raw.replace(/\s/g, '');
    if (!compact) return false;

    const emojiRe = /\p{Extended_Pictographic}/gu;
    const emojis = (raw.match(emojiRe) || []).length;
    const alnum = (raw.match(/[\p{L}\p{N}]/gu) || []).length;

    if (alnum === 0 && emojis > 0) return true;
    if (compact.length <= 32 && emojis / compact.length >= 0.55) return true;
    const letters = (raw.match(/\p{L}/gu) || []).length;
    if (compact.length <= 20 && emojis >= 1 && letters <= 2) return true;
    return false;
  }

  /** 常见引流变体字统一后再做子串匹配 */
  function normalizeForKeywordMatch(text) {
    return String(text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/曰/g, '日')
      .replace(/約/g, '约')
      .replace(/誠/g, '诚')
      .replace(/處/g, '处')
      .replace(/費/g, '费')
      .replace(/純/g, '纯')
      .replace(/砲/g, '炮');
  }

  function findKeyword(blob, keywords) {
    const norm = normalizeForKeywordMatch(blob);
    for (const kw of keywords || []) {
      const k = normalizeForKeywordMatch(String(kw || '').trim());
      if (k && norm.includes(k)) return kw;
    }
    return null;
  }

  function nameBlob(meta) {
    return String(
      meta.profileBlob || `${meta.displayName || ''} ${meta.handle || ''}`
    )
      .normalize('NFKC')
      .trim();
  }

  function matchKeywordList(blob, keywords, ruleId, reason, labelPrefix) {
    const hit = findKeyword(blob, keywords);
    if (!hit) return null;
    return {
      ruleId,
      reason,
      label: `${labelPrefix}「${hit}」`,
      matchedKeyword: hit
    };
  }

  const implementations = {
    blocklist(meta, settings) {
      const h = XcfSettings.normalizeHandle(meta.handle);
      const list = (settings.blocklist || []).map(XcfSettings.normalizeHandle);
      if (h && list.includes(h)) {
        return {
          ruleId: 'blocklist',
          reason: '屏蔽账号',
          label: `用户 @${meta.handle || h}`
        };
      }
      return null;
    },

    promoted_ad(meta) {
      if (meta.isAd) {
        return { ruleId: 'promoted_ad', reason: '推广广告', label: '推广/广告' };
      }
      return null;
    },

    text_keywords(meta, settings) {
      return matchKeywordList(
        meta.text,
        settings.textKeywords,
        'text_keywords',
        '评论关键词',
        '关键词'
      );
    },

    display_name_keywords(meta, settings) {
      return matchKeywordList(
        nameBlob(meta),
        settings.displayNameKeywords,
        'display_name_keywords',
        '昵称关键词',
        '昵称'
      );
    },

    nickname_spam(meta, settings) {
      return matchKeywordList(
        nameBlob(meta),
        settings.nicknameSpamKeywords,
        'nickname_spam',
        '引流昵称',
        '昵称'
      );
    },

    probable_spam(meta) {
      if (meta.inProbableSpam) {
        return { ruleId: 'probable_spam', reason: 'X 垃圾区', label: 'X 垃圾区' };
      }
      return null;
    },

    mention_spam(meta, settings) {
      const kwHit = matchKeywordList(
        meta.text,
        settings.mentionSpamKeywords,
        'mention_spam',
        '提及关键词',
        '关键词'
      );
      if (kwHit) return kwHit;

      const raw = (meta.text || '').trim();
      if (!raw) return null;
      const mentions = (raw.match(/@[A-Za-z0-9_]{1,30}/g) || []).length;
      const compact = raw.replace(/\s/g, '');
      if (mentions >= 2 && compact.length > 0 && compact.length <= 100) {
        return { ruleId: 'mention_spam', reason: '多@提及', label: '多 @ 提及' };
      }
      return null;
    },

    emoji_spam(meta, settings) {
      const kwHit = matchKeywordList(
        meta.text,
        settings.emojiSpamKeywords,
        'emoji_spam',
        '表情关键词',
        '关键词'
      );
      if (kwHit) return kwHit;
      if (!isEmojiSpam(meta.text)) return null;
      return { ruleId: 'emoji_spam', reason: '纯表情', label: '纯表情' };
    }
  };

  function listEnabled(settings) {
    return RULE_ORDER.filter((id) => settings.rules?.[id] !== false);
  }

  function evaluate(meta, settings) {
    const h = XcfSettings.normalizeHandle(meta.handle);
    const wl = (settings.whitelist || []).map(XcfSettings.normalizeHandle);
    if (h && wl.includes(h)) return null;

    const hasText = Boolean((meta.text || '').trim());
    const hasProfile = Boolean(nameBlob(meta));
    for (const id of listEnabled(settings)) {
      if (!hasText && TEXT_RULES.has(id)) continue;
      if ((id === 'nickname_spam' || id === 'display_name_keywords') && !hasProfile) {
        continue;
      }
      const fn = implementations[id];
      if (!fn) continue;
      const hit = fn(meta, settings);
      if (hit) return hit;
    }
    return null;
  }

  function foldBarText(meta, match) {
    const tag = match?.label || match?.reason || '噪音';
    const who = meta.handle ? `@${meta.handle}` : '';
    return who ? `噪音 ${who} · ${tag}` : `噪音 · ${tag}`;
  }

  function needsTextForRule(ruleId) {
    return TEXT_RULES.has(ruleId);
  }

  function settingsKeyForRule(ruleId) {
    return KEYWORD_SETTINGS_KEY[ruleId] || null;
  }

  return {
    RULE_META,
    RULE_ORDER,
    KEYWORD_SETTINGS_KEY,
    evaluate,
    foldBarText,
    isEmojiSpam,
    needsTextForRule,
    settingsKeyForRule,
    findKeyword
  };
})();
